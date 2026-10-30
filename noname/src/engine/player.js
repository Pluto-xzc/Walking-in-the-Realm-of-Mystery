/**
 * 核心引擎 · Player 类：一名角色
 * ------------------------------------------------------------------
 * 由 src/engine.js 拆分而来。体力 / 手牌 / 装备 / 技能，以及需要玩家输入的动作。
 */

import { CARDS, EQUIP_SLOTS, makeEmptyEquips } from '../cards.js';
import { CHARACTERS } from '../characters.js';
import { SKILLS } from '../skills.js';
import {
  invalidateRevealed, isLinkedCard, cascadeDiscardLinked, cascadeGainLinked,
  isIgnited, noteIgnitedDiscard, applyEnchantMod, noteHpChange, cannotRespond,
  isInquirySkipped, SKIP_KINDS, OCCUPY_ZONES, occupierOf, isDetached,
  adjustBigChange, onHandLeave, isPoisonNow, leavesFaceUp,
} from '../mechanics.js';
import { nextId, ZONE } from './zones.js';

export class Player {
  constructor(charId, seat, isHuman = false) {
    const ch = CHARACTERS[charId];
    this.id = nextId();
    this.charId = charId;
    this.name = ch.name;
    this.title = ch.title || '';
    this.sex = ch.sex;
    this.group = ch.group;
    /*
     * 体力上限 / 初始体力分开
     * ----------------------------------------------------------------
     * 对照无名杀的角色信息：`hp` 是**初始体力**，`maxHp` 才是体力上限。
     * 绝大多数武将两者相同（3/3、4/4），只写 `hp` 即可；
     * 需要「开局不满血」的（如丰川祥子 4 上限、开局 3 血）才另写 `maxHp`。
     */
    const maxHp = typeof ch.maxHp === 'number' ? ch.maxHp : ch.hp;
    this.maxHp = maxHp;
    this.hp = Math.min(ch.hp, maxHp);
    this.seat = seat;
    this.isHuman = isHuman;
    this.alive = true;

    this.skills = [...ch.skills];
    /*
     * 拥有「隐匿技」的角色会在**游戏开始时**进入隐匿状态
     * ------------------------------------------------------------------
     * 无名杀依据（library/element/player.js 的 setCharacter）：
     *   if (info.hasHiddenSkill && !this.noclick) { hidden = true; ... }
     * 即「有隐匿技 → 开局即隐匿」。
     *
     * 这里只做标记，真正的 enterHidden 由 Game.setup / startGame 执行
     *（那时 game 引用才齐备）。
     */
    this.hasHiddenSkill = ch.skills.some(
      (sid) => SKILLS[sid] && SKILLS[sid].hiddenSkill === true);
    /*
     * 【命运回合】声明式授予
     * ------------------------------------------------------------------
     * 技能用 `mod: { destinyTurn: true }` 声明「拥有命运回合」，
     * 构造角色时直接落地，免去每个武将单独写初始化代码。
     */
    this.destinyTurn = ch.skills.some(
      (sid) => SKILLS[sid] && SKILLS[sid].mod && SKILLS[sid].mod.destinyTurn === true);

    this.hand = [];
    this.equips = makeEmptyEquips();
    /**
     * 被废除的装备区（预留，参考无名杀）
     * ------------------------------------------------------------------
     * 存放被废除的槽位 key 数组，例如 ['equip1'] 表示武器区被废除。
     * 被废除的槽位：不能装备新牌，原有牌失效但不弃置。
     * 标准包内不会用到，此处只把结构留好，供后续武将技能调用。
     */
    this.disabledEquips = [];
    this.judges = [];

    /**
     * 除外区（本扩新增机制）
     * ------------------------------------------------------------------
     * 被「除外」的牌移出游戏，存放于此。
     * 规则（按需求方给定）：
     *   · 仅**主人自己可见**具体内容，其他人只了解数量
     *   · 无数量限制
     *   · 主人死亡时全部进入弃牌堆
     *   · 每名角色的除外区**相互独立**
     * 具体操作见 mechanics.js 的 excludeCards / retrieveExcluded 等。
     */
    this.excluded = [];

    /**
     * 护甲值（参考无名杀 hujia）
     * ------------------------------------------------------------------
     * 无名杀规则原文：「和体力类似，每点护甲可抵挡1点伤害，但不影响手牌上限。」
     *
     * 结算位置：在伤害数值全部修改完成之后、扣体力之前。
     *   抵挡量 = min(最终伤害, 当前护甲)
     *   护甲 -= 抵挡量；实际扣血 = 伤害 - 抵挡量
     *   日志：「XX 的护甲抵挡了 N 点伤害」
     *
     * 与白银狮子的区别：白银狮子改的是**伤害数值**（第三级），
     * 护甲是在数值确定后**抵扣**，属于更靠后的一步。
     */
    this.hujia = 0;
    this.maxHujia = 0;        // 上限（多数情况等于初始护甲）

    /**
     * 【溢出体力】机制（本扩新增）
     * ------------------------------------------------------------------
     * 为 true 时，回复体力**溢出的部分会转为等量护甲**。
     */
    this.hpOverflow = false;

    /**
     * 【隐匿】状态
     * ------------------------------------------------------------------
     * 拥有「隐匿技」的角色初始为隐匿状态：
     *   · 不可见：武将牌、体力值、体力上限、**性别（视为「无」）**
     *   · 受到伤害时防止该伤害后登场；或其回合开始时登场
     *   · 重新隐匿会令角色重新进入隐匿状态
     * 注意（按需求方要求）：技能**不删除**，仍可正常发动，
     * 只是移入 hiddenSkills 记录，供「隐匿状态下可发动的技能」使用。
     */
    this.hidden = false;
    this.hiddenSkills = [];
    /** 隐匿状态下被隐藏的原始信息 */
    this.hiddenSnapshot = null;

    /**
     * 翻面状态（参考无名杀 isTurnedOver / turnOver）
     * ------------------------------------------------------------------
     * true = 武将牌**反面向上**。
     * 规则：反面向上时跳过其整个回合，跳过回合后翻回正面。
     */
    this.isTurnedOver = false;

    /**
     * 【占用】记录
     * ------------------------------------------------------------------
     * { zone: { by, part, untilTurn, untilDeath, roundConverted, ... } }
     * 同一区域仅能被一名角色占用（按最新占用适用）；
     * 未声明期限默认双方一人死亡时解除。
     */
    this.occupied = {};

    this.flags = {};          // 回合内标记
    this.storage = {};        // 持久数据
    this.identity = null;     // zhu / zhong / fan / nei
    this.identityShown = false;
    this.isZhu = false;
    this.extraTurn = false;
    /**
     * 横置状态（铁索连环）
     * true = 处于「横置」（连环状态）。
     * 受到属性伤害时，本次伤害会传导给其他横置角色，随后一并重置。
     */
    this.isChained = false;
  }

  /** 判断某个装备槽位是否已被废除 */
  isEquipSlotDisabled(slot) {
    return this.disabledEquips.includes(slot);
  }

  /** 废除/恢复装备区（供后续技能使用） */
  setEquipSlotDisabled(slot, disabled = true) {
    const has = this.disabledEquips.includes(slot);
    if (disabled && !has) this.disabledEquips.push(slot);
    if (!disabled && has) this.disabledEquips = this.disabledEquips.filter((s) => s !== slot);
    if (this.game) this.game.emit();
  }

  /* ------------ 查询 ------------ */
  countCards(zone = 'he', filter) {
    let cards = [];
    if (zone.includes('h')) cards = cards.concat(this.hand);
    if (zone.includes('e')) cards = cards.concat(Object.values(this.equips).filter(Boolean));
    if (zone.includes('j')) cards = cards.concat(this.judges);
    if (filter) cards = cards.filter((c) => (typeof filter === 'function' ? filter(c) : this.matchFilter(c, filter)));
    return cards.length;
  }

  getCards(zone = 'he', filter) {
    let cards = [];
    if (zone.includes('h')) cards = cards.concat(this.hand);
    if (zone.includes('e')) cards = cards.concat(Object.values(this.equips).filter(Boolean));
    if (zone.includes('j')) cards = cards.concat(this.judges);
    if (filter) cards = cards.filter((c) => (typeof filter === 'function' ? filter(c) : this.matchFilter(c, filter)));
    return cards;
  }

  /** 这张牌对 viewer 是否可见（Player 层便捷方法，等价于 Game.canSeeCard） */
  canSeeCard(card, viewer) {
    if (!viewer) return true;
    if (viewer === this) return true;
    return card.isVisibleTo(viewer);
  }

  matchFilter(card, filter) {
    if (!filter || typeof filter !== 'object') return true;
    if (filter.name && card.name !== filter.name) return false;
    if (filter.suit && card.suit !== filter.suit) return false;
    if (filter.color && card.color !== filter.color) return false;
    if (filter.type && card.type !== filter.type) return false;
    return true;
  }

  hasCard(filter) { return this.countCards('he', filter) > 0; }

  getEquip(subtype) { return this.equips[subtype]; }

  /** 攻击范围：武器范围，默认 1 */
  attackRange() {
    const w = this.equips.equip1;
    let range = w ? (CARDS[w.name].attackRange || 1) : 1;
    // 只应用自己技能的修正（如某些技能改攻击范围）
    range = this.game.applyModFor(this, 'attackRange', this, range);
    return Math.max(1, range);
  }

  /** 到目标的距离 */
  distanceTo(target) {
    if (this === target) return 0;
    /*
     * 【调离】：被调离的角色**不参与距离结算**
     * ----------------------------------------------------------------
     * 语义：调离者与被调离者之间不存在合法的距离关系，
     *       返回一个不可达值（99），使攻击范围判断必然失败。
     * 规则来源：需求方给定（无名杀无此机制，见 mechanics.js 的说明）。
     */
    if (isDetached(this) || isDetached(target)) return 99;

    const alive = this.game.players.filter((p) => p.alive);
    const i = alive.indexOf(this);
    const j = alive.indexOf(target);
    if (i < 0 || j < 0) return 99;
    const raw = Math.abs(i - j);
    let d = Math.min(raw, alive.length - raw);   // 环形距离

    // 进攻马：自己到他人的距离 -1（只应用自己的）
    const myHorse = this.equips.equip4;
    if (myHorse && CARDS[myHorse.name].distanceFrom) {
      d -= CARDS[myHorse.name].distanceFrom;
    }
    // 防御马：他人到自己的距离 +1（只应用目标的）
    const tHorse = target.equips.equip3;
    if (tHorse && CARDS[tHorse.name].distanceTo) {
      d += CARDS[tHorse.name].distanceTo;
    }
    // 技能修正：马术等只作用于拥有者
    d = this.game.applyModFor(this, 'distanceFrom', d);
    d = this.game.applyModFor(target, 'distanceTo', d);
    return Math.max(1, d);
  }

  /** 单侧攻击范围的方向（仅【无穷之锁】有意义） */
  rangeSide() {
    const s = this.storage && this.storage.attackSide;
    return s === 'right' ? 'right' : 'left';
  }

  /**
   * 单侧攻击范围的判定（【无穷之锁】）
   * ------------------------------------------------------------------
   * ① 选定侧的「范围值」= 攻击范围；**未选侧的范围为 0**。
   * ② 【-1马】让两个方向的距离都 -1，所以未选侧紧邻那位也会被拉进来
   *    （例：A B C 你 D E F —— 左1 无马只覆盖 C；左1 有 -1马 覆盖 B、C、D）。
   * ③ 武器给的范围允许绕圈找人，技能声明的范围不允许。
   */
  /**
   * 单侧攻击范围：范围内的角色
   * ------------------------------------------------------------------
   * 规则（需求方给定）：
   *   ① 范围是**单点**「从你手边数第 X 个角色」，X = 范围值。
   *   ② 【-1马】把这个单点向两侧各扩 1 格（第 0 个 = 未选侧紧邻那位）。
   *      例：A B C 你 D E F —— 左1 无马 = C；左1 有 -1马 = B、C、D。
   *   ③ 武器给的范围允许绕圈找人；技能自己声明的范围不允许。
   */
  inSideRange(target, side = this.rangeSide()) {
    if (this === target) return false;
    const alive = this.game.players.filter((p) => p.alive);
    const n = alive.length;
    const me = alive.indexOf(this);
    const idx = alive.indexOf(target);
    if (me < 0 || idx < 0) return false;
    const step = side === 'left' ? (me - idx + n) % n : (idx - me + n) % n;
    const i = step === n - 1 ? 0 : step;          // 第 0 个 = 未选侧紧邻
    return Math.abs(i - this.rangeValueX(n)) <= this.horseDistanceBonus();
  }

  /** 单侧范围内（某一侧）的存活角色 */
  sideRangeTargets(side = this.rangeSide()) {
    return this.game.players.filter((p) => p.alive && this.inSideRange(p, side));
  }

  /** 当前范围值 X（技能声明优先，否则取武器；不可绕圈的声明超界时返回 -1） */
  rangeValueX(n) {
    const declared = this.storage && this.storage.rangeX;
    if (Number.isFinite(declared) && declared > 0) {
      return declared <= n - 2 ? declared : -1;
    }
    const x = Math.max(1, this.attackRange());
    const m = n - 1;
    if (x <= n - 2 || m <= 1) return x;
    const k = ((x - 1) % m) + 1;                  // 武器绕圈
    return k === m ? 0 : k;
  }

  /** 【-1 马】给的距离减免（没有则 0） */
  horseDistanceBonus() {
    const h = this.equips && this.equips.equip4;
    return h && CARDS[h.name] && CARDS[h.name].distanceFrom ? 1 : 0;
  }

  inAttackRange(target) {
    if (this.hasSkill('wuqiongzhisuo')) return this.inSideRange(target);
    return this.distanceTo(target) <= this.attackRange();
  }

  canUseAsShan() {
    return this.countCards('h', (c) => c.name === 'shan') > 0;
  }

  hasSkill(id) { return this.skills.includes(id); }

  addFlag(k, v) { this.flags[k] = v; }
  hasFlag(k) { return !!this.flags[k]; }
  clearFlags() { this.flags = {}; }

  get handCount() { return this.hand.length; }

  /* ------------ 基础操作（由 Game 注入 game） ------------ */
  async gain(cards, anim, from) {
    /*
     * 【明置】失效
     * ----------------------------------------------------------------
     * 被「原牌以外的角色」获得后，失去明置状态。
     * 自己获得自己的牌（如从木牛流马取回）同样按需求方规则失去明置
     *（「被放入木牛流马」也算失去），因此这里统一清除。
     */
    invalidateRevealed(cards);
    const r = await this.game.playerGain(this, cards, from);
    /*
     * 【自囚者】被标记期间，每次获得牌都要明置其中一张。
     * 标记会在「下次流失体力」时由 loseHp 清掉。
     */
    if (this.flags && this.flags.ziqiuActive && this.alive && (cards || []).length) {
      const pool = this.getCards('h', (c) => (cards || []).includes(c) && !c.revealed);
      const pick = pool.length
        ? await this.chooseCards({
          prompt: '【自囚者】：从获得的牌里选一张明置',
          position: 'h', min: 1, max: 1, cardList: pool, cancelable: false,
        }).catch(() => null)
        : null;
      const card = (pick && pick[0]) || pool[0];
      if (card) {
        card.revealTurn = this.game.turnCount;
        await this.game.revealCards([card], this);
        this.game.log(`【自囚者】${this.name} 明置了 ${card.fullname || card.name}`);
      }
    }
    return r;
  }

  /** 【破惘长行】把「摸牌」反向改成「弃 1 张手牌」 */
  async discardOneByChange() {
    if (!this.hand.length) return null;
    const got = await this.chooseCards({
      prompt: '【破惘长行】：弃置 1 张手牌',
      position: 'h', min: 1, max: 1, cancelable: false,
    }).catch(() => null);
    const card = (got || [])[0] || this.hand[0];
    await this.discard([card]);
    return card;
  }

  async draw(n) {
    // 【破惘长行】一次性摸多张可由技能改为「摸 1」或「反向弃 1」
    if (n > 1) {
      const nd = await adjustBigChange(this.game, 'hand', n);
      if (nd < 0) {
        await this.discardOneByChange();
        return [];
      }
      n = nd;
    }
    const cards = this.game.takeFromDeckTop(n);
    await this.gain(cards, 'draw');
    this.game.log(`${this.name} 摸了 ${cards.length} 张牌`);
    await this.game.checkSkills('drawEnd', { player: this, num: cards.length });
    return cards;
  }

  /* ============================================================
   * 「手牌与体力等价」机制（本项目自定义，按用户给定规则实现）
   * ============================================================
   * 持有该机制的角色（通常是锁定技/状态技）在「摸牌 / 弃牌」时，
   * 可以选择改为不摸/不弃，而做等量的体力「增加 / 减小」。
   *
   * 结算要点（严格按用户规则）：
   *   ① 该结算「仅视为摸牌/弃牌」，**不视为回复体力**。
   *      因此不触发「回复体力」类时机与技能。
   *   ② 反之亦然：用体力换牌时，视为弃牌，不视为失去体力。
   *      因此【绝情】这类「伤害视为失去体力」的机制不参与，
   *      护甲与「空上限当护甲」也不会抵挡它（它不是伤害）。
   *   ③ 弃牌阶段的弃牌可以「一次性」用扣血/扣部分血 + 弃部分牌
   *      来凑够应弃数量。
   * ============================================================ */

  /** 该角色是否持有「手牌与体力等价」机制 */
  hasHpCardExchange() {
    if (this.flags && this.flags.hpCardExchange) return true;
    return this.hasSkill('hp_card_exchange');
  }

  /**
   * 「摸牌」改为「增加体力」
   * 只增加体力上限 AllowUp 内的部分；返回实际增加量。
   * 注意：仅视为摸牌，不视为回复体力 —— 故不走 recover()。
   */
  async drawAsHp(n) {
    if (!this.alive || n <= 0) return 0;
    const before = this.hp;
    this.hp = Math.min(this.maxHp, this.hp + n);
    const gained = this.hp - before;
    if (gained > 0) {
      this.game.log(`${this.name} 将 ${gained} 张摸牌改为增加 ${gained} 点体力`
        + `（视为摸牌；${this.hp}/${this.maxHp}）`);
      this.game.emit();
      // 仅视为摸牌：沿用 drawEnd 时机，num 记实际增加量
      await this.game.checkSkills('drawEnd', { player: this, num: gained, asHp: true });
    } else {
      this.game.log(`${this.name} 体力已满，改为增加体力的摸牌无效果`);
    }
    return gained;
  }

  /**
   * 将「体力」当作「弃牌」支付
   * 每 1 点体力抵 1 张应弃的牌；返回实际抵扣的牌数。
   * 不视为失去体力，因此不会触发濒死以外的伤害/流失相关机制。
   */
  async payDiscardWithHp(count) {
    if (!this.alive || count <= 0) return 0;
    const pay = Math.min(count, this.hp);
    if (pay <= 0) return 0;
    this.hp -= pay;
    this.game.log(`${this.name} 以 ${pay} 点体力代替弃置 ${pay} 张牌`
      + `（视为弃牌；${this.hp}/${this.maxHp}）`);
    this.game.emit();
    if (this.hp <= 0) await this.game.enterDying(this);
    return pay;
  }

  /**
   * 弃牌阶段的「等价支付」
   * ------------------------------------------------------------------
   * excess 张应弃牌，可拆分为：
   *   弃置 k 张手牌 + 扣 (excess - k) 点体力
   * AI 与玩家都可选择；不持有该机制时直接返回 null 表示不适用。
   *
   * @returns {Promise<{cards:number, hp:number}|null>}
   */
  async chooseDiscardSplit(excess) {
    if (!this.hasHpCardExchange() || excess <= 0) return null;
    const maxHpPay = Math.min(excess, Math.max(0, this.hp - 1)); // 至少保留 1 点体力
    if (maxHpPay <= 0) return null;
    const canDiscard = Math.min(excess, this.hand.length);
    // 可选的「扣体力数」范围：0 .. maxHpPay，且需满足 弃牌数 + 扣血数 = excess
    const minPay = Math.max(0, excess - canDiscard);
    if (maxHpPay < minPay) return null;   // 想全用体力也不够，无法凑齐

    if (!this.isHuman) {
      // AI：优先弃牌，体力不足时才用体力补
      const hpPay = minPay;
      return { cards: excess - hpPay, hp: hpPay };
    }

    const hpPay = await this.game.io.chooseHpPayment(this, excess, minPay, maxHpPay);
    return { cards: excess - (hpPay || 0), hp: hpPay || 0 };
  }

  async loseCards(cards, zone) {
    /*
     * 【明置】失效
     * ----------------------------------------------------------------
     * 需求方确认：被弃置 / 自己使用 / 被暗置 / 被别人获得 /
     * 被放入木牛流马 / 被除外 —— **都会**失去明置信息。
     * 这里在「牌离开手牌」的统一入口清除，避免遗漏某条路径。
     *
     * 【横置】同理：牌一旦离开手牌，横置状态也就不再有意义
     *（需求方规则里的横置只在「手牌中」成立）。
     */
    /*
     * 【毒】的快照必须在 invalidateRevealed 之前取。
     * 「正面朝上或作为转化牌离开手牌区」都会失去 1 点体力，
     * 而 invalidateRevealed 会把 revealed 清掉，之后就无法判断了。
     */
    const poisonLeaving = (cards || []).filter(
      (c) => c && this.hand.includes(c) && isPoisonNow(this.game, c) && leavesFaceUp(c),
    );

    invalidateRevealed(cards);
    for (const c of (cards || [])) {
      if (c && c.horizontal) delete c.horizontal;
    }

    /*
     * ⚠️ 先做一份快照再遍历。
     * ----------------------------------------------------------------
     * 循环体里的 `this.hand.splice()` 会**原地修改** this.hand。
     * 正常调用时 cards 是另一个数组，改 this.hand 不影响遍历；
     * 但只要 cards 恰好就是 this.hand 本身（别名调用），
     * 边遍历边 splice 就会跳过元素 —— 实测 `loseCards(p.hand)` 弃 3 张
     * 只会去掉 2 张，剩 1 张留在手里。
     * 用快照遍历可以从根上杜绝这类别名问题。
     */
    for (const c of (cards || []).slice()) {
      // 防御：跳过空项（调用方可能传入未找到的牌）
      if (!c) continue;
      const hi = this.hand.indexOf(c);
      if (hi >= 0) { this.hand.splice(hi, 1); c.zone = 'discard'; continue; }
      // 遍历全部槽位（含宝物 equip5），触发「失去装备」时机
      let lostEquip = false;
      for (const slot of EQUIP_SLOTS) {
        if (this.equips[slot.key] === c) {
          this.equips[slot.key] = null;
          c.zone = 'discard';
          lostEquip = true;
          break;
        }
      }
      if (lostEquip) {
        await this.game.checkSkills('equipLost', { player: this, card: c });
        // 白银狮子：失去时回复 1 点体力
        await this.game.checkBaiyinLose(this, c);
        continue;
      }
      const ji = this.judges.indexOf(c);
      if (ji >= 0) { this.judges.splice(ji, 1); c.zone = 'discard'; }
    }
    if (this.hand.length === 0) {
      await this.game.checkSkills('handCardLost', { player: this });
    }
    // 【毒】正面离开手牌区 → 失去体力
    if (poisonLeaving.length) await onHandLeave(this.game, this, poisonLeaving);
  }

  async discard(cards) {
    /*
     * 【破惘长行】一次性弃置多张时，可由技能改为
     *   · 只弃 1 张（-1）
     *   · 反向：改为摸 1 张（+1）
     */
    let picked = (cards || []).filter(Boolean);
    if (picked.length > 1) {
      const nd = await adjustBigChange(this.game, 'hand', -picked.length);
      if (nd > 0) { await this.draw(nd); return; }
      picked = picked.slice(0, -nd);
    }
    /*
     * 【横置牌】连带弃置
     * ----------------------------------------------------------------
     * 需求方给定：横置的牌被弃置时，**一并弃置手牌中其余的横置牌**。
     * 必须在真正弃置之前先取出连带部分（否则手牌已变）。
     */
    const list = picked;
    const cascaded = [];
    for (const c of list.slice()) {
      if (!isLinkedCard(c)) continue;
      const extra = await cascadeDiscardLinked(this, c);
      cascaded.push(...extra);
    }
    const all = list.concat(cascaded);

    /*
     * 【同一次弃置】的记账
     * ----------------------------------------------------------------
     * 璐米欧儿【黑白乱舞】要看「你有 2 张牌**被同时弃置**」。
     * 判定口径：同一次 `discard()` 调用里带的所有牌就是「同时被弃置」。
     * 在牌上打一个事务号 + 原主标记：
     *   _discardBatch  —— 同一批共享同一个号，用于事后成组
     *   _discardOwner  —— 这批牌原本属于谁（技能归属判定要用）
     * 连带弃置的横置牌也算进同一批（它们确实是同时被弃的）。
     */
    const batchId = (this.game._discardBatchSeq = (this.game._discardBatchSeq || 0) + 1);
    for (const c of all) {
      if (!c) continue;
      c._discardBatch = batchId;
      c._discardOwner = this;
    }

    await this.loseCards(all);
    /*
     * 弃置不等同于「使用」，因此这些牌**不应进入中央区**。
     * 中央区（处理区）只放「本回合被使用/结算过的牌」，
     * 若把弃牌也塞进去，会出现「弃掉的牌居然出现在中央区」的怪现象
     *（实测【剪辑高手】弃掉的手牌就错误地出现在中央区）。
     */
    this.game.toDiscard(all, { direct: true });
    if (list.length) this.game.log(`${this.name} 弃置了 ${list.map((c) => c.text).join('、')}`);

    /*
     * 弃置完成后的通知（供【黑白乱舞】一类「被弃置时」的技能）
     * ----------------------------------------------------------------
     * 「同时弃置」不是回合事件，时机体系里没有对应时点，
     * 因此由弃置入口**主动通知**，而不是挂在 checkSkills 的时机表上。
     */
    if (all.length) {
      await this.game.checkSkills('cardsDiscarded', {
        player: this,
        batch: all,
        batchId,
      });
    }
  }

  async damage(num, source, skill, card) {
    return this.game.doDamage(this, num, source, skill, card);
  }

  /**
   * 回复体力
   * ------------------------------------------------------------------
   * 【溢出体力】机制（本扩新增）：
   *   若持有该机制（`hpOverflow`），回复的**溢出值将变为等量护甲**。
   *   例：3/4 体力回复 3 点 → 回到 4/4，溢出的 2 点变成 2 点护甲。
   *
   * @param {number} num
   * @returns {Promise<number>} 实际回复的体力值
   */
  async recover(num) {
    if (!this.alive) return 0;
    // 【破惘长行】一次性变动大于 1 时可由技能改为 ±1
    if (num > 1) {
      const nd = await adjustBigChange(this.game, 'hp', num);
      if (nd < 0) { await this.loseHp(-nd); return 0; }
      num = nd;
    }
    const before = this.hp;
    this.hp = Math.min(this.maxHp, this.hp + num);
    const healed = this.hp - before;
    if (healed > 0) {
      this.game.log(`${this.name} 回复了 ${healed} 点体力（${this.hp}/${this.maxHp}）`);
    }

    // 【溢出体力】：把溢出的部分转为护甲
    const overflow = Math.max(0, num - healed);
    if (overflow > 0 && this.hpOverflow) {
      await this.changeHujia(overflow);
      this.game.log(`${this.name} 的【溢出体力】将 ${overflow} 点溢出回复`
        + `转为等量护甲（护甲 ${this.hujia}）`);
    }

    this.game.emit();
    // 【体力变化】记录
    if (healed > 0 && this.game.noteHpChange) {
      this.game.noteHpChange(this, 'recover', healed, before);
    }
    return healed;
  }

  /**
   * 调整护甲值（参考无名杀 changeHujia）
   * ------------------------------------------------------------------
   * @param {number} num   变化量（正数获得，负数失去）
   * @param {string} type  'gain' | 'lose' | 'damage' | 'null'
   * @param {number|true} limit 上限；传 true 表示上限 5
   *
   * 无名杀原文：
   *   changeHujia(num, type, limit) {
   *     if (limit === true) limit = 5;
   *     if (typeof limit == 'number' && this.hujia + num > limit)
   *       num = Math.max(0, limit - this.hujia);
   *     ...
   *   }
   */
  async changeHujia(num = 1, type = null, limit = null) {
    if (!this.alive) return 0;
    let n = num;
    if (limit === true) limit = 5;
    if (typeof limit === 'number' && this.hujia + n > limit) {
      n = Math.max(0, limit - this.hujia);
    }
    if (!type) {
      if (n > 0) type = 'gain';
      else if (n < 0) type = 'lose';
      else type = 'null';
    }
    // 失去时不能超过当前护甲
    if (n < 0 && -n > this.hujia) {
      n = -this.hujia;
      type = 'damage';
    }
    if (n > 0) {
      this.game.log(`${this.name} 获得了 ${n} 点护甲（${this.hujia} → ${this.hujia + n}）`);
    } else if (n < 0) {
      if (type === 'damage') {
        this.game.log(`${this.name} 的护甲抵挡了 ${-n} 点伤害`);
      } else {
        this.game.log(`${this.name} 失去了 ${-n} 点护甲`);
      }
    }
    this.hujia += n;
    this.maxHujia = Math.max(this.maxHujia, this.hujia);
    this.game.emit();
    return n;
  }

  /**
   * 重铸（参考无名杀 recast）
   * ------------------------------------------------------------------
   * 规则：把选定的牌置入弃牌堆，然后摸等量的牌。
   *
   * 无名杀实现要点：
   *   recast(cards) → loseToDiscardpile(cards) → draw(cards.length)
   *   日志格式：「XX 重铸了 ...」
   *
   * 目前【铁索连环】带有 recastable 标记，可以通过重铸来换取新牌。
   */
  async recast(cards) {
    const list = (Array.isArray(cards) ? cards : [cards]).filter(Boolean);
    if (!list.length) return;
    this.game.log(`${this.name} 重铸了 ${list.map((c) => c.text).join('、')}`);
    await this.loseCards(list);
    // 重铸是「置入弃牌堆」而非「使用」，不进中央区
    this.game.toDiscard(list, { direct: true });
    this.game.emit();
    await this.draw(list.length);
  }

  /**
   * 流失体力
   * @returns {Promise<boolean>} 是否因此进入了濒死状态
   */
  async loseHp(num) {
    if (!this.alive) return false;
    // 【破惘长行】一次性变动大于 1 时可由技能改为 ±1
    if (num > 1) {
      const nd = await adjustBigChange(this.game, 'hp', -num);
      if (nd > 0) {
        // 反向（把流失改成回复）不能突破体力上限
        if (this.hp >= this.maxHp) {
          this.game.log(`【破惘长行】${this.name} 已到体力上限`
            + `（${this.hp}/${this.maxHp}），本次回复实际为 0`);
        } else {
          await this.recover(nd);
        }
        return false;
      }
      num = -nd;
    }
    const before = this.hp;
    this.hp -= num;
    this.game.log(`${this.name} 失去了 ${num} 点体力（${this.hp}/${this.maxHp}）`);
    this.game.emit();
    // 【自囚者】「直到下次流失体力前」——流失体力即解除标记
    if (this.flags && this.flags.ziqiuActive) this.flags.ziqiuActive = false;
    // 【体力变化】记录（失去体力）
    if (this.game.noteHpChange) {
      this.game.noteHpChange(this, 'lose', num, before);
    }
    if (this.hp <= 0) {
      await this.game.enterDying(this);
      return true;        // 因本次流失体力而濒死
    }
    return false;
  }

  /**
   * 流失体力，但**不触发因本次流失而产生的濒死结算**
   * ------------------------------------------------------------------
   * 用于「流失体力后自行处理濒死」的技能，例如折桠【无我入春时】：
   *   「若发动此技能的『让你流失 1 点体力』导致你濒死，
   *     则你直接恢复体力值直到 1」
   * 这里的裁定是：**流失照样发生**，但那次流失所引发的
   * **濒死结算不执行**（不求桃、不阵亡），由调用方自行把体力补回。
   *
   * 同时挂在 Player 上（player.loseHpWithoutDying）与
   * Game 上（game.loseHpWithoutDying(player, n)），方便两种写法。
   *
   * @param {Player} player
   * @param {number} num
   * @returns {Promise<boolean>} 是否「本应进入濒死」（供调用方判断）
   */
  async loseHpWithoutDying(player, num = 1) {
    if (!player || !player.alive) return false;
    player.hp -= num;
    this.log(`${player.name} 失去了 ${num} 点体力（${player.hp}/${player.maxHp}）`);
    this.emit();
    return player.hp <= 0;   // 告知调用方「本应濒死」，但已跳过濒死结算
  }

  /** 便捷写法：game.loseHpWithoutDying(player, n) 等价于 player.loseHpWithoutDying(n) */
  loseHpNoDying(player, num = 1) {
    return player.loseHpWithoutDying(num);
  }

  isDamaged() { return this.hp < this.maxHp; }

  /*
   * 注意：`getRenku` / `toRenku` 是 **Game 层**的方法
   *（见下方 export class Game 内），不要在这里重复定义。
   */

  /**
   * 手牌中「不计入手牌上限」的张数
   * ------------------------------------------------------------------
   * 目前来源：【同步索敌攻击】摸到的牌（gaintag 含 'suodi'）。
   * 弃牌阶段计算超出量时会先把这些牌排除。
   */
  countNoLimitCards() {
    return this.countCards('h', (c) => (c.gaintag || []).includes('suodi'));
  }

  /** 该手牌是否不计入手牌上限 */
  isNoLimitCard(card) {
    return !!card && (card.gaintag || []).includes('suodi');
  }

  /* ------------ 玩家交互（异步） ------------ */
  async chooseOption({ prompt, options }) {
    return this.game.io.chooseOption(this, prompt, options);
  }

  async chooseCards({ prompt, position = 'he', min = 1, max = 1, filter, cancelable = true }) {
    return this.game.io.chooseCards(this, { prompt, position, min, max, filter, cancelable });
  }

  async chooseTargets({ prompt, candidates, min = 1, max = 1 }) {
    return this.game.io.chooseTargets(this, { prompt, candidates, min, max });
  }

  async chooseToDiscard({ prompt, position = 'he', filter }) {
    const cards = await this.game.io.chooseCards(this, {
      prompt, position, min: 1, max: 1, filter, cancelable: true,
    });
    return cards && cards.length ? { bool: true, cards } : { bool: false, cards: [] };
  }

  async discardCards(n, position, prompt) {
    const cards = await this.game.io.chooseCards(this, {
      prompt, position, min: n, max: n, cancelable: false,
    });
    if (!cards || cards.length < n) return false;
    await this.discard(cards);
    return true;
  }

  /**
   * 响应式打出一张牌（如【护驾】【激将】请他人代打）
   * ------------------------------------------------------------------
   * 注意：语义是「**打出**」，因此选定后必须真正把牌移出该角色手牌
   * 并置入中央区。早期实现只返回牌不移除，会造成同一个角色的【闪】
   * 被反复使用（重复使用漏洞）。
   *
   * @returns {{bool: boolean, cards: Card[]}}
   */
  async chooseToRespond({ prompt, pattern }) {
    const cards = this.getCards('h', (c) => this.matchFilter(c, pattern));
    if (!cards.length) return { bool: false, cards: [] };

    let chosen = [];
    if (!this.isHuman) {
      const ai = this.game.ai;
      if (ai.shouldRespond(this, pattern, prompt)) chosen = [cards[0]];
      else return { bool: false, cards: [] };
    } else {
      const picked = await this.game.io.chooseCards(this, {
        prompt, position: 'h', min: 1, max: 1, filter: pattern, cancelable: true,
      });
      if (!picked || !picked.length) return { bool: false, cards: [] };
      chosen = picked;
    }

    // 真正打出：移出手牌并进入中央区（回合结束后归档进弃牌堆）
    await this.loseCards(chosen);
    this.game.toCenter(chosen);
    this.game.log(`${this.name} 打出了 ${chosen.map((c) => c.text).join('、')}`);
    return { bool: true, cards: chosen };
  }

  /** 从其他玩家处选牌 */
  async chooseCardFromPlayer(target, position, prompt) {
    const cards = target.getCards(position);
    if (!cards.length) return null;
    if (!this.isHuman) {
      return [this.game.ai.pickBestCard(cards)];
    }
    const picked = await this.game.io.chooseCards(this, {
      prompt, position, min: 1, max: 1, cancelable: true, fromPlayer: target,
    });
    return picked && picked.length ? picked : null;
  }

  async chooseCardFromList(cards, prompt) {
    if (!cards.length) return null;
    if (!this.isHuman) return this.game.ai.pickBestCard(cards);
    const picked = await this.game.io.chooseCards(this, {
      prompt, position: 'list', min: 1, max: 1, cancelable: true, cardList: cards,
    });
    return picked && picked.length ? picked[0] : null;
  }

  /** 观星：调整牌序 */
  async arrangeCards(cards, prompt) {
    if (!this.isHuman) {
      return { top: cards, bottom: [] };
    }
    return this.game.io.arrangeCards(this, cards, prompt);
  }

  async judge(reason) {
    return this.game.doJudge(this, reason);
  }
}

/* ============================================================
 * 游戏主体
 * ============================================================ */
