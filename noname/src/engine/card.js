/**
 * 核心引擎 · Card 类：一张牌
 * ------------------------------------------------------------------
 * 由 src/engine.js 拆分而来。牌面信息、可见性（明置 / 展示）、文本输出。
 */

import { CARDS, SUITS, numberLabel } from '../cards.js';
import { nextId } from './zones.js';

export class Card {
  constructor(suit, number, name) {
    const def = CARDS[name] || {};
    this.id = nextId();
    this.suit = suit;
    this.number = number;
    this.name = name;
    this.type = def.type;
    this.subtype = def.subtype;
    this.color = SUITS[suit] ? SUITS[suit].color : 'black';
    this.label = def.label || name;
    this.fullname = def.fullname || name;
    this.delayed = !!def.delayed;
    this.nature = null;       // 'fire' | 'thunder'
    this.zone = 'deck';       // 见 ZONE 常量
    this.owner = null;
    this.virtual = false;     // 视为牌
    this.sourceCards = [];    // 视为牌对应的实体牌

    /* ------------------------------------------------------------------
     * 可见性 / 明置
     * ------------------------------------------------------------------
     * 两种机制本质不同，务必区分（火攻的「展示」不是「明置」）：
     *
     *   明置（revealed）—— 持续状态
     *     牌翻开并**保持**公开，其他角色可随时观看。
     *     由技能赋予/取消，是牌的一个属性。
     *     失去明置的三种情况：
     *       ① 被主动暗置
     *       ② 被原持有者以外的角色获得（如顺手牵羊拿走）
     *       ③ 移动到手牌区以外的区域
     *
     *   展示（shown）—— 瞬时动作
     *     在结算过程中翻开给所有人看一次，随后自动合上。
     *     如火攻：展示一张手牌，看完就恢复暗置。
     *     不改变牌的持久状态。
     * ------------------------------------------------------------------ */
    this.revealed = false;    // 是否处于明置状态
    this.revealOwner = null;  // 明置时的归属者（换手即失去明置）

    /**
     * 属性（null / 'fire' / 'thunder'）
     * ------------------------------------------------------------------
     * 用于属性伤害与界面标识。
     * 【朱雀羽扇】会把普通【杀】转成火【杀】：那时会把此字段设为 'fire'，
     * 界面据此显示「火」角标（见 ui.buildCardNode）。
     * 若不设置，则回退到卡牌定义里的 nature（目前只有【火攻】）。
     */
    this.nature = null;
  }

  /**
   * 这张牌对 viewer 是否可见（内容能被看到）
   * ------------------------------------------------------------------
   * 判据是对「牌实际所在的位置」而不是 owner 字段 ——
   * owner 只表示"最后经手的人"，可能因为各种技能转移而滞后。
   *
   * 可见规则：
   *   - 在 viewer 自己手里 → 可见
   *   - 不在任何人手里（装备区/判定区/弃牌堆/牌堆/中央区）→ 公开可见
   *   - 在别人手里 → 只有明置才可见
   */
  isVisibleTo(viewer) {
    if (!viewer) return true;
    const g = viewer.game;
    if (!g) return this.owner === viewer;
    // ① 是否在 viewer 自己手里
    if (viewer.hand && viewer.hand.includes(this)) return true;
    // ② 是否在**别人**手里（手牌区）
    for (const p of g.players) {
      if (p === viewer) continue;
      if (p.hand && p.hand.includes(this)) {
        // 在别人手里 → 只有明置可见
        return this.revealed;
      }
    }
    // ③ 不在任何人手里 → 公开区域，可见
    return true;
  }

  /** 赋予明置状态 */
  setRevealed(on, by = null) {
    this.revealed = !!on;
    this.revealOwner = on ? (by || this.owner) : null;
    return this;
  }

  /**
   * 检查是否应当失去明置状态
   * 在牌发生移动后调用。
   */
  checkRevealLost(newOwner) {
    if (!this.revealed) return false;
    // ① 离开手牌区 → 失去明置（装备区/弃牌堆的牌本来就是公开的）
    if (this.zone !== ZONE.HAND) {
      this.revealed = false;
      this.revealOwner = null;
      return true;
    }
    // ② 被原持有者以外的角色获得 → 失去明置
    if (this.revealOwner && newOwner && newOwner !== this.revealOwner) {
      this.revealed = false;
      this.revealOwner = null;
      return true;
    }
    return false;
  }

  get suitLabel() { return SUITS[this.suit] ? SUITS[this.suit].label : '?'; }
  get numberText() { return numberLabel(this.number); }

  /** 卡牌完整描述 */
  get text() { return `${this.suitLabel}${this.numberText} ${this.fullname}`; }

  toString() { return this.text; }
}

/* ============================================================
 * 玩家
 * ============================================================ */
