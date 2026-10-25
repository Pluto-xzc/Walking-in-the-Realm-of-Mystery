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
    this.maxHp = ch.hp;
    this.hp = ch.hp;
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

  inAttackRange(target) { return this.distanceTo(target) <= this.attackRange(); }

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
    return this.game.playerGain(this, cards, from);
  }

  async draw(n) {
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
    invalidateRevealed(cards);
    for (const c of (cards || [])) {
      if (c && c.horizontal) delete c.horizontal;
    }

    for (const c of (cards || [])) {
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
  }

  async discard(cards) {
    /*
     * 【横置牌】连带弃置
     * ----------------------------------------------------------------
     * 需求方给定：横置的牌被弃置时，**一并弃置手牌中其余的横置牌**。
     * 必须在真正弃置之前先取出连带部分（否则手牌已变）。
     */
    const list = (cards || []).filter(Boolean);
    const cascaded = [];
    for (const c of list) {
      if (!isLinkedCard(c)) continue;
      const extra = await cascadeDiscardLinked(this, c);
      cascaded.push(...extra);
    }
    const all = list.concat(cascaded);

    await this.loseCards(all);
    /*
     * 弃置不等同于「使用」，因此这些牌**不应进入中央区**。
     * 中央区（处理区）只放「本回合被使用/结算过的牌」，
     * 若把弃牌也塞进去，会出现「弃掉的牌居然出现在中央区」的怪现象
     *（实测【剪辑高手】弃掉的手牌就错误地出现在中央区）。
     */
    this.game.toDiscard(all, { direct: true });
    if (list.length) this.game.log(`${this.name} 弃置了 ${list.map((c) => c.text).join('、')}`);
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
    const before = this.hp;
    this.hp -= num;
    this.game.log(`${this.name} 失去了 ${num} 点体力（${this.hp}/${this.maxHp}）`);
    this.game.emit();
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
