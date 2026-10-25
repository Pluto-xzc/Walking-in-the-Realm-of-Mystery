/**
 * 核心引擎 · Game 类：对局主体
 * ------------------------------------------------------------------
 * 由 src/engine.js 拆分而来。本文件只放构造函数与静态成员；
 * 其余方法按职责拆分在 g-*.js，由本文件在末尾混入 Game.prototype。
 * 这样 `class Game` 只有一个身份，`instanceof Game` 与 `new Game()` 不受影响。
 */

import { SKILLS } from '../skills.js';
import { zhinangCards } from '../mechanics.js';

export class Game {
  constructor() {
    this.players = [];
    this.deck = [];
    this.discardPile = [];
    /**
     * 中央区（本回合处理区）
     * ------------------------------------------------------------------
     * 语义（与弃牌堆的关系）：
     *   - 本回合打出的牌先进中央区
     *   - 中央区的牌【同时算作弃牌堆的一部分】（两处都能检索到）
     *   - 当前角色回合彻底结束后，中央区的牌移入弃牌堆，中央区清空
     *     （此后只能在弃牌堆找到）
     *
     * 对应无名杀的 processing（处理区），但额外保留「当回合」这一维度，
     * 以便技能区分「刚打出的牌」与「历史上的牌」。
     */
    this.centerZone = [];
    this.logs = [];
    this.turnCount = 0;
    this.phaseNumber = 0;
    this.currentPlayer = null;
    this.io = null;        // 由 UI 注入
    this.ai = null;        // 由 AI 模块注入
    this.over = false;
    this.onUpdate = () => {};
    this.pendingChoice = null;

    /**
     * 技能表引用
     * ------------------------------------------------------------------
     * 供 mechanics.js 等外部模块按 id 查技能定义
     *（昂扬技的重置需要读 skill.angyang）。
     */
    this.skillsRef = SKILLS;

    /**
     * 额定回合 / 轮次
     * ------------------------------------------------------------------
     * _turnIsRated：当前回合是否为额定回合（额外回合为 false）
     * roundCount  ：轮次（1 号位开始新一轮时 +1），供「额定回合」相关技能用
     */
    this._turnIsRated = true;
    this.roundCount = 1;

    /** 【点燃】的弃置计数（每满 2 张结算一次） */
    this._ignitedDiscardCount = 0;

    /**
     * 仁区（官方机制）
     * ------------------------------------------------------------------
     * 参考无名杀 `_status.renku` / `lib.commonArea.renku`：
     *   一个存于场上、用于**存放牌的公共区域**，其中的牌对所有角色可见。
     *   规则：① 至多 6 张；② 超过 6 张时，**最先置入**的牌进入弃牌堆。
     */
    this.renku = [];

    /**
     * 智囊牌（官方机制）
     * ------------------------------------------------------------------
     * 牌的一类标签。本项目按需求方指定为 3 张：
     *   【无中生有】【过河拆桥】【无懈可击】
     * 技能可通过 setZhinangCards / addZhinangCard 增减。
     */
    this.zhinangTricks = zhinangCards(null).slice();

    /* 展示中（瞬时公开，区别于明置） */
    this.showingCards = [];
    this.showingBy = null;

    /* 事件序列（供「使用/打出」分类与技能时机使用） */
    this.useEvents = [];
  }

  static get STAGE_ORDER() {
    return {
      targetConfirm: 1,     // ① 指定目标时 / ③ 指定目标后
      targeted: 2,          // ② 成为目标时
      comboCheck: 3,        // ★ 连招技：与上一张牌的连续性判定（早于「使用牌时」）
      cardTargeted: 4,      // ④ 成为目标后
      cardUsed: 5,          // ⑤ 使用牌时
      damageBegin: 6,       // ⑥⑦ 造成/受到伤害时
      damageEnd: 8,         // ⑧⑨ 造成/受到伤害后
      cardUsedAfter: 10,    // ⑩ 使用牌后
      cardResolved: 11,     // ⑪ 结算后
      failedSave: 12,       // ★ 失救时点（濒死结算结束、即将阵亡）
      hiddenReveal: 13,     // ★ 隐匿登场（触发「隐匿技」的效果）
    };
  }
}
