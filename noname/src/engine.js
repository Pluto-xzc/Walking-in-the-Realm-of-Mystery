/**
 * 核心引擎：牌堆、玩家、事件、回合流程
 * ------------------------------------------------------------------
 * 设计对齐无名杀的核心概念，但大幅简化：
 *   - 事件（Event）：一次结算单元，含时机触发
 *   - 时机（timing）：damageBegin / damageEnd / judgeBefore ...
 *   - 异步：全部用 async/await，等待玩家输入即为 await
 *
 * 与无名杀的关键差异（有意为之）：
 *   - 不做步骤数组（step 机），统一用 async 函数
 *   - 不做 Promise 队列代理，直接用 await
 *   - 状态显式建模，便于调试与重放
 */

import { CARDS, DECK_LIST, SUITS, numberLabel } from './cards.js';
import { CHARACTERS } from './characters.js';
import { SKILLS } from './skills.js';

let uid = 0;
const nextId = () => ++uid;

/* ============================================================
 * 卡牌实例
 * ============================================================ */
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
    this.zone = 'deck';       // deck | hand | equip | judge | processing | discard
    this.owner = null;
    this.virtual = false;     // 视为牌
    this.sourceCards = [];    // 视为牌对应的实体牌
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
    this.hand = [];
    this.equips = { equip1: null, equip2: null, equip3: null, equip4: null };
    this.judges = [];

    this.flags = {};          // 回合内标记
    this.storage = {};        // 持久数据
    this.identity = null;     // zhu / zhong / fan / nei
    this.identityShown = false;
    this.isZhu = false;
    this.extraTurn = false;
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
    return this.game.playerGain(this, cards, from);
  }

  async draw(n) {
    const cards = this.game.takeFromDeckTop(n);
    await this.gain(cards, 'draw');
    this.game.log(`${this.name} 摸了 ${cards.length} 张牌`);
    await this.game.checkSkills('drawEnd', { player: this, num: cards.length });
    return cards;
  }

  async loseCards(cards, zone) {
    for (const c of cards) {
      const hi = this.hand.indexOf(c);
      if (hi >= 0) { this.hand.splice(hi, 1); c.zone = 'discard'; continue; }
      for (const k of ['equip1', 'equip2', 'equip3', 'equip4']) {
        if (this.equips[k] === c) {
          this.equips[k] = null; c.zone = 'discard';
          await this.game.checkSkills('equipLost', { player: this, card: c });
          continue;
        }
      }
      const ji = this.judges.indexOf(c);
      if (ji >= 0) { this.judges.splice(ji, 1); c.zone = 'discard'; }
    }
    if (this.hand.length === 0) {
      await this.game.checkSkills('handCardLost', { player: this });
    }
  }

  async discard(cards) {
    await this.loseCards(cards);
    for (const c of cards) this.game.discardPile.push(c);
    if (cards.length) this.game.log(`${this.name} 弃置了 ${cards.map((c) => c.text).join('、')}`);
  }

  async damage(num, source, skill, card) {
    return this.game.doDamage(this, num, source, skill, card);
  }

  async recover(num) {
    if (!this.alive) return;
    const before = this.hp;
    this.hp = Math.min(this.maxHp, this.hp + num);
    if (this.hp > before) this.game.log(`${this.name} 回复了 ${this.hp - before} 点体力（${this.hp}/${this.maxHp}）`);
    this.game.emit();
  }

  async loseHp(num) {
    if (!this.alive) return;
    this.hp -= num;
    this.game.log(`${this.name} 失去了 ${num} 点体力（${this.hp}/${this.maxHp}）`);
    this.game.emit();
    if (this.hp <= 0) await this.game.enterDying(this);
  }

  isDamaged() { return this.hp < this.maxHp; }

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

  async chooseToRespond({ prompt, pattern }) {
    const cards = this.getCards('h', (c) => this.matchFilter(c, pattern));
    if (!cards.length) return { bool: false, cards: [] };
    // AI 判断
    if (!this.isHuman) {
      const ai = this.game.ai;
      if (ai.shouldRespond(this, pattern, prompt)) {
        return { bool: true, cards: [cards[0]] };
      }
      return { bool: false, cards: [] };
    }
    const picked = await this.game.io.chooseCards(this, {
      prompt, position: 'h', min: 1, max: 1, filter: pattern, cancelable: true,
    });
    return picked && picked.length ? { bool: true, cards: picked } : { bool: false, cards: [] };
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
export class Game {
  constructor() {
    this.players = [];
    this.deck = [];
    this.discardPile = [];
    this.logs = [];
    this.turnCount = 0;
    this.phaseNumber = 0;
    this.currentPlayer = null;
    this.io = null;        // 由 UI 注入
    this.ai = null;        // 由 AI 模块注入
    this.over = false;
    this.onUpdate = () => {};
    this.pendingChoice = null;
  }

  emit() { this.onUpdate(); }

  log(text) {
    this.logs.push({ text, turn: this.turnCount });
    if (this.logs.length > 500) this.logs.shift();
    this.emit();
  }

  /* ---------------- 初始化 ---------------- */
  setup(playerChars, io, ai) {
    this.io = io;
    this.ai = ai;
    this.players = playerChars.map((c, i) => {
      const p = new Player(c.charId, i, c.isHuman);
      p.game = this;
      return p;
    });
    this.buildDeck();
    this.emit();
  }

  buildDeck() {
    this.deck = DECK_LIST.map(([suit, num, name]) => new Card(suit, num, name));
    this.shuffle(this.deck);
    this.discardPile = [];
  }

  shuffle(arr) {
    for (let i = arr.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [arr[i], arr[j]] = [arr[j], arr[i]];
    }
  }

  randomPick(arr) { return arr[Math.floor(Math.random() * arr.length)]; }

  /* ---------------- 牌堆操作 ---------------- */
  takeFromDeckTop(n) {
    const out = [];
    for (let i = 0; i < n; i++) {
      if (!this.deck.length) this.reshuffle();
      if (!this.deck.length) break;
      const c = this.deck.pop();
      c.zone = 'processing';
      out.push(c);
    }
    return out;
  }

  takeFromDeckBottom(n) {
    const out = [];
    for (let i = 0; i < n; i++) {
      if (!this.deck.length) this.reshuffle();
      if (!this.deck.length) break;
      const c = this.deck.shift();
      c.zone = 'processing';
      out.push(c);
    }
    return out;
  }

  putOnDeckTop(cards) { this.deck.push(...cards.slice().reverse()); }
  putOnDeckBottom(cards) { this.deck.unshift(...cards.slice().reverse()); }

  reshuffle() {
    if (!this.discardPile.length) return;
    this.log('牌堆已重洗');
    this.deck = this.discardPile.slice();
    this.discardPile = [];
    this.shuffle(this.deck);
  }

  /* ---------------- 摸牌 / 获得 ---------------- */
  async playerGain(player, cards, from) {
    for (const c of cards) {
      c.zone = 'hand';
      c.owner = player;
      player.hand.push(c);
    }
    this.emit();
  }

  /**
   * 触发技的「归属」判定
   *
   * 这是保证规则正确性的关键闸门：一个技能只能在「该技能的拥有者
   * 确实是这个事件的相关方」时才可能发动。
   *
   * 举例：
   *   - 天妒(judgeEnd)    → 只有判定者本人是郭嘉才触发
   *   - 奸雄(damageEnd)   → 只有受伤者本人是曹操才触发
   *   - 突袭(drawPhaseBefore) → 只有摸牌阶段的主角本人是张辽才触发
   *   - 铁骑(targetConfirm)   → 只有出【杀】的来源本人是马超才触发
   *
   * 定义 skill.scope 可显式指定归属字段；未指定则按时机使用默认值。
   */
  skillScopeMatches(skill, owner, event) {
    if (!event) return true;
    // 技能显式声明优先
    const scope = skill.scope;
    if (scope === 'any') return true;                  // 无归属限制（罕见）
    if (scope === 'global') return true;               // 全局监听
    if (scope === 'source') return event.source === owner;
    if (scope === 'target') return event.target === owner;
    if (scope === 'player') return event.player === owner;

    // 按时机推断默认归属
    switch (skill.trigger) {
      // 受到伤害 / 濒死 → 归属为受伤者
      case 'damageEnd':
      case 'damageBegin':
      case 'dying':
        return event.player === owner;

      // 判定相关 → 归属为判定者
      case 'judgeBefore':
      case 'judgeEnd':
        return event.player === owner;

      // 回合/阶段相关 → 归属为回合主角
      case 'turnStart':
      case 'turnEnd':
      case 'drawPhaseBefore':
      case 'discardPhaseBefore':
      case 'phaseUse':
        return event.player === owner;

      // 使用牌 → 归属为使用者
      case 'cardUsed':
        return event.player === owner;

      // 指定目标后 → 归属为【杀】的来源
      case 'targetConfirm':
        return event.source === owner;

      // 成为目标 → 归属为目标
      case 'targeted':
        return event.target === owner;

      // 【杀】被闪避 → 归属为来源
      case 'shaDodged':
        return event.source === owner || event.player === owner;

      // 失去牌 → 归属为失去者
      case 'equipLost':
      case 'handCardLost':
        return event.player === owner;

      // 摸牌结束 → 归属为摸牌者
      case 'drawEnd':
        return event.player === owner;

      // 询问响应类（护驾/激将/八卦）→ 由 content 内部自行处理
      case 'askForShan':
      case 'askForSha':
        return event.player === owner;

      default:
        return true;
    }
  }

  async checkSkills(timing, event) {
    for (const p of this.players) {
      if (!p.alive) continue;
      for (const sid of p.skills) {
        const sk = SKILLS[sid];
        if (!sk || sk.type !== 'trigger' || sk.trigger !== timing) continue;

        // ① 归属闸门：技能拥有者必须是事件相关方
        if (!this.skillScopeMatches(sk, p, event)) continue;

        // ② 装备技：必须确实装备着对应装备
        if (sk.equip && !this.playerHasEquipSkill(p, sid)) continue;

        // ③ 技能自身的 filter
        const ctx = { player: p, game: this, event, skill: sk };
        let ok = true;
        try { ok = sk.filter ? sk.filter(ctx) : true; } catch { ok = false; }
        if (!ok) continue;

        // ④ 询问是否发动
        const willUse = await this.io.askSkill(p, sk, ctx);
        if (willUse) {
          this.log(`${p.name} 发动【${sk.name}】`);
          await sk.content(ctx);
        }
      }
    }
    this.emit();
  }

  playerHasEquipSkill(p, sid) {
    const eqs = Object.values(p.equips).filter(Boolean);
    return eqs.some((c) => CARDS[c.name] && CARDS[c.name].equipSkill === sid);
  }

  /**
   * 统一查询：某角色能否成为该牌的目标
   * 集中处理 空城 / 谦逊 等限制，避免 AI 与引擎各写一份导致规则不一致。
   */
  canBeTargeted(player, card) {
    if (!player || !player.alive || !card) return false;
    // 空城：无手牌时不能成为【杀】或【决斗】的目标
    if (player.hasSkill('kongcheng') && player.countCards('h') === 0
      && (card.name === 'sha' || card.name === 'juedou')) return false;
    // 谦逊：不能成为【顺手牵羊】和【乐不思蜀】的目标
    if (player.hasSkill('qianxun')
      && (card.name === 'shunshou' || card.name === 'lebu')) return false;
    return true;
  }

  /** 【杀】是否无次数限制 */
  shaUnlimited(player) {
    if (player.hasSkill('paoxiao')) return true;
    return this.playerHasEquipSkill(player, 'zhuge_skill');
  }

  /** 使用锦囊是否无视距离限制（奇才） */
  trickNoDistance(player) {
    return player.hasSkill('qicai');
  }

  /**
   * 收集 mod 技能并依次应用
   *
   * 重要：mod 只应作用于「技能拥有者本人相关的计算」。
   * 因此本方法接受一个 scope 参数，指定参与计算的玩家集合：
   *   - applyModFor(player, name, ...args)  → 只应用 player 自己的 mod
   *   - applyModGlobal(name, ...args)       → 应用全场所有存活玩家的 mod（用于罕见全局修正）
   *
   * 之前实现把全场所有玩家的 mod 都套用，导致「马术 -1」对所有人生效，
   * 这是一个严重逻辑错误，已修正。
   */
  applyModFor(player, name, ...args) {
    if (!player || !player.alive) return args[args.length - 1];
    this._runMods([player], name, args);
    return args[args.length - 1];
  }

  /** 应用双方（如距离计算：自己 + 目标）的 mod */
  applyModForPair(a, b, name, ...args) {
    const list = [];
    if (a && a.alive) list.push(a);
    if (b && b.alive && b !== a) list.push(b);
    this._runMods(list, name, args);
    return args[args.length - 1];
  }

  /** 应用全场 mod（少用） */
  applyModGlobal(name, ...args) {
    this._runMods(this.players.filter((p) => p.alive), name, args);
    return args[args.length - 1];
  }

  _runMods(players, name, args) {
    for (const p of players) {
      // 武将技能
      for (const sid of p.skills) {
        const sk = SKILLS[sid];
        if (sk && sk.type === 'mod' && sk.mod && sk.mod[name]) {
          try {
            const r = sk.mod[name](...args);
            if (r !== undefined) args[args.length - 1] = r;
          } catch { /* 忽略单个技能异常 */ }
        }
      }
      // 装备技能
      for (const c of Object.values(p.equips).filter(Boolean)) {
        const esid = CARDS[c.name] && CARDS[c.name].equipSkill;
        const sk = esid && SKILLS[esid];
        if (sk && sk.mod && sk.mod[name]) {
          try {
            const r = sk.mod[name](...args);
            if (r !== undefined) args[args.length - 1] = r;
          } catch { /* 忽略 */ }
        }
      }
    }
  }

  /** 兼容旧调用：查找某技能是否对指定玩家生效 */
  playerHasModSkill(player, name) {
    for (const sid of player.skills) {
      const sk = SKILLS[sid];
      if (sk && sk.type === 'mod' && sk.mod && sk.mod[name]) return true;
    }
    for (const c of Object.values(player.equips).filter(Boolean)) {
      const esid = CARDS[c.name] && CARDS[c.name].equipSkill;
      const sk = esid && SKILLS[esid];
      if (sk && sk.mod && sk.mod[name]) return true;
    }
    return false;
  }

  /* ---------------- 伤害 ---------------- */
  async doDamage(target, num, source, skill, card) {
    if (!target.alive || this.over) return;

    const ev = {
      player: target, source, num: Math.max(0, num), skill, card,
      cards: card ? [card] : [], nature: (card && card.nature) || null,
      prevented: false,
    };

    // 免疫检查
    if (card) {
      const immune = this.isImmune(target, card);
      if (immune) {
        this.log(`${target.name} 因装备效果免疫了【${card.fullname}】`);
        return;
      }
    }

    // 藤甲：火焰伤害 +1
    for (const c of Object.values(target.equips).filter(Boolean)) {
      const esid = CARDS[c.name] && CARDS[c.name].equipSkill;
      const sk = esid && SKILLS[esid];
      if (sk && sk.mod && sk.mod.damageTaken && card) {
        ev.num = sk.mod.damageTaken(ev.num, card);
      }
    }
    // 华雄恃勇等
    if (source) {
      for (const sid of source.skills) {
        const sk = SKILLS[sid];
        if (sk && sk.mod && sk.mod.damageFromSha && card && card.name === 'sha') {
          ev.num = sk.mod.damageFromSha(ev.num, card);
        }
      }
    }
    // 裸衣
    if (source && source.hasFlag('luoyi') === this.turnCount && card
      && (card.name === 'sha' || card.name === 'juedou')) {
      ev.num += 1;
    }

    await this.checkSkills('damageBegin', ev);
    if (ev.prevented) { this.emit(); return; }
    ev.num = Math.max(0, ev.num);
    if (ev.num === 0) { this.emit(); return; }

    target.hp -= ev.num;
    this.log(`${target.name} 受到 ${ev.num} 点${ev.nature === 'fire' ? '火焰' : ev.nature === 'thunder' ? '雷电' : ''}伤害（${target.hp}/${target.maxHp}）${source ? `，来源：${source.name}` : ''}`);
    this.emit();

    await this.checkSkills('damageEnd', ev);

    if (target.hp <= 0) await this.enterDying(target, source);
  }

  isImmune(player, card) {
    for (const c of Object.values(player.equips).filter(Boolean)) {
      const esid = CARDS[c.name] && CARDS[c.name].equipSkill;
      const sk = esid && SKILLS[esid];
      if (sk && sk.mod && sk.mod.immunity) {
        try { if (sk.mod.immunity(card)) return true; } catch { /* 忽略 */ }
      }
    }
    return false;
  }

  /* ---------------- 濒死 ---------------- */
  async enterDying(player, source) {
    if (this.over) return;
    this.log(`${player.name} 濒死！`);
    this.emit();

    let guard = 0;
    while (player.hp <= 0 && guard++ < 20) {
      let saved = false;
      // 自己先用桃
      const order = [player, ...this.players.filter((p) => p !== player && p.alive)];
      for (const p of order) {
        if (player.hp > 0) break;
        // 找出可用的桃（含急救）
        let taoCards = p.getCards('he', (c) => c.name === 'tao');
        let viaSkill = null;
        if (!taoCards.length && p.hasSkill('jijiu')) {
          taoCards = p.getCards('he', (c) => c.color === 'red');
          viaSkill = 'jijiu';
        }
        if (!taoCards.length) continue;

        let use = false;
        if (p.isHuman) {
          const answers = await this.io.confirmDying(p, player, viaSkill, taoCards.length);
          use = answers;
        } else {
          // AI：队友濒死则救
          use = this.ai.shouldSave(p, player);
        }
        if (!use) continue;

        const card = p.isHuman
          ? (await this.io.chooseCards(p, {
            prompt: `对 ${player.name} 使用【桃】`,
            position: 'he', min: 1, max: 1,
            filter: (c) => (viaSkill ? c.color === 'red' : c.name === 'tao'),
            cancelable: true,
          })) || []
          : [taoCards[0]];
        if (!card.length) continue;

        await p.loseCards(card);
        this.discardPile.push(...card);
        const heal = (p.isZhu && p.hasSkill('jiuyuan') && p.group === 'wu' && p !== player) ? 2 : 1;
        player.hp += heal;
        this.log(`${p.name} 使用【桃】救助 ${player.name}${viaSkill ? '（急救）' : ''}${heal > 1 ? '（救援 +1）' : ''}`);
        this.emit();
        saved = true;
        break;
      }
      if (!saved) break;
    }

    if (player.hp <= 0) await this.killPlayer(player, source);
  }

  async killPlayer(player, source) {
    player.alive = false;
    player.hp = 0;
    this.log(`${player.name} 阵亡`);
    // 弃置所有牌
    const all = player.getCards('hej');
    for (const c of all) c.zone = 'discard';
    this.discardPile.push(...all);
    player.hand = [];
    player.equips = { equip1: null, equip2: null, equip3: null, equip4: null };
    player.judges = [];
    this.emit();

    // 奖惩
    if (source && source.alive) {
      if (player.identity === 'fan') {
        await source.draw(3);
        this.log(`${source.name} 击杀反贼，摸三张牌`);
      } else if (player.identity === 'zhong' && source.isZhu) {
        const others = source.getCards('hej');
        if (others.length) {
          for (const c of others) c.zone = 'discard';
          this.discardPile.push(...others);
          source.hand = [];
          source.equips = { equip1: null, equip2: null, equip3: null, equip4: null };
          source.judges = [];
          this.log(`${source.name} 误杀忠臣，弃置所有牌`);
        }
      }
    }

    this.checkGameOver();
  }

  checkGameOver() {
    const zhu = this.players.find((p) => p.identity === 'zhu');
    const alive = this.players.filter((p) => p.alive);
    if (!zhu || !zhu.alive) {
      const fanAlive = alive.filter((p) => p.identity === 'fan').length;
      const neiAlive = alive.filter((p) => p.identity === 'nei').length;
      if (neiAlive === 1 && alive.length === 1) {
        this.endGame('nei', '内奸');
      } else if (fanAlive > 0) {
        this.endGame('fan', '反贼');
      } else {
        this.endGame('nei', '内奸');
      }
      return;
    }
    const fanAlive = alive.filter((p) => p.identity === 'fan').length;
    const neiAlive = alive.filter((p) => p.identity === 'nei').length;
    if (fanAlive === 0 && neiAlive === 0) {
      this.endGame('zhu', '主公');
    }
  }

  endGame(winner, label) {
    if (this.over) return;
    this.over = true;
    this.winner = winner;
    this.winnerLabel = label;
    this.log(`游戏结束：${label}阵营胜利`);
    // 亮出所有身份
    for (const p of this.players) p.identityShown = true;
    this.emit();
  }

  /* ---------------- 判定 ---------------- */
  async doJudge(player, reason) {
    const card = this.takeFromDeckTop(1)[0];
    if (!card) return { card: null, suit: null, color: null };
    const ev = { player, card, reason, replaced: false };
    this.log(`${player.name} 判定：${card.text}`);
    this.emit();

    await this.checkSkills('judgeBefore', ev);
    await this.checkSkills('judgeEnd', ev);

    // 判定牌处理
    if (card.zone === 'processing') {
      this.discardPile.push(card);
      card.zone = 'discard';
    }
    this.emit();
    return { card: ev.card, suit: ev.card.suit, color: ev.card.color, number: ev.card.number };
  }

  /* ---------------- 决斗 ---------------- */
  async doJuedou(p1, p2) {
    let attacker = p2;
    let defender = p1;
    let turn = 0;
    this.log(`${p1.name} 与 ${p2.name} 决斗`);
    while (turn++ < 30) {
      const need = 1;
      const res = await this.io.askShaForJuedou(defender, this);
      if (!res) {
        await defender.damage(1, attacker, 'juedou');
        return;
      }
      [attacker, defender] = [defender, attacker];
    }
  }

  /* ---------------- 判定区 ---------------- */
  async addJudgeCard(player, card) {
    card.zone = 'judge';
    player.judges.push(card);
    this.log(`${player.name} 的判定区放入【${card.fullname}】`);
    this.emit();
  }

  /* ============================================================
   * 回合流程
   * ============================================================ */
  async runGame(playerChars, io, ai) {
    // 若尚未 setup 过（players 为空），则先装配
    if (!this.players.length) {
      await this.setup(playerChars, io, ai);
    } else {
      // 已 setup：仅确保 io/ai 绑定
      this.io = io || this.io;
      this.ai = ai || this.ai;
    }
    // 注意：开屏由入口（main.js）负责，引擎不再调用 showSplash。
    // 早期版本在此处 await showSplash()，但那时开屏已被入口关闭，
    // 导致 showSplash 返回的 Promise 永远不 resolve —— 表现为
    // 「选完武将后所有人没有手牌、界面毫无响应」。已移除。
    this.log('=== 游戏开始 ===');

    // 初始手牌
    for (const p of this.players) {
      const cards = this.takeFromDeckTop(4);
      await p.gain(cards);
    }
    this.log('每名角色获得 4 张起始手牌');
    this.emit();

    let guard = 0;
    let idx = 0;
    while (!this.over && guard++ < 500) {
      const p = this.players[idx % this.players.length];
      idx++;
      if (!p.alive) continue;
      await this.runTurn(p);
      if (this.over) break;
    }
    if (!this.over) this.endGame('draw', '平局');
    this.emit();
  }

  async runTurn(player) {
    this.turnCount++;
    this.currentPlayer = player;
    player.clearFlags();
    player.storage.rendeCount = 0;
    this.log(`—— ${player.name} 的回合（第 ${this.turnCount} 回合）——`);
    this.emit();
    await this.io.sleep(300);

    await this.checkSkills('turnStart', { player });

    // 判定阶段
    await this.phaseJudge(player);
    if (!player.alive || this.over) return;

    // 摸牌阶段
    await this.phaseDraw(player);
    if (!player.alive || this.over) return;

    // 出牌阶段
    await this.phaseUse(player);
    if (!player.alive || this.over) return;

    // 弃牌阶段
    await this.phaseDiscard(player);
    if (!player.alive || this.over) return;

    await this.checkSkills('turnEnd', { player });
    this.emit();
  }

  async phaseJudge(player) {
    this.log(`${player.name} 进入判定阶段`);
    for (const card of player.judges.slice()) {
      if (!player.judges.includes(card)) continue;
      player.judges.splice(player.judges.indexOf(card), 1);
      card.zone = 'processing';
      this.emit();

      if (card.name === 'lebu') {
        const j = await player.judge('lebu');
        if (j.suit !== 'heart') {
          player.addFlag('skipUse', true);
          this.log(`${player.name} 被【乐不思蜀】影响，跳过出牌阶段`);
        }
        this.discardPile.push(card); card.zone = 'discard';
      } else if (card.name === 'shandian') {
        const j = await player.judge('shandian');
        const spade29 = j.suit === 'spade' && j.number >= 2 && j.number <= 9;
        if (spade29) {
          this.discardPile.push(card); card.zone = 'discard';
          await player.damage(3, null, 'shandian', null);
          if (!player.alive) return;
        } else {
          // 移动到下家
          const alive = this.players.filter((p) => p.alive);
          const i = alive.indexOf(player);
          const next = alive[(i + 1) % alive.length];
          if (next && next !== player) {
            card.zone = 'judge';
            next.judges.push(card);
            this.log(`【闪电】移动到 ${next.name} 的判定区`);
          } else {
            this.discardPile.push(card); card.zone = 'discard';
          }
        }
      }
      this.emit();
    }
  }

  async phaseDraw(player) {
    let num = 2;
    const ev = { player, num, drawDelta: 0, skipDraw: false };
    await this.checkSkills('drawPhaseBefore', ev);
    if (ev.skipDraw) { this.emit(); return; }
    num = Math.max(0, num + (ev.drawDelta || 0));
    this.log(`${player.name} 进入摸牌阶段，摸 ${num} 张牌`);
    await player.draw(num);
  }

  async phaseUse(player) {
    if (player.hasFlag('skipUse')) { this.log(`${player.name} 跳过出牌阶段`); return; }
    this.log(`${player.name} 进入出牌阶段`);
    this.emit();

    let guard = 0;
    while (guard++ < 60) {
      if (!player.alive || this.over) return;
      const action = await this.io.chooseAction(player, this);
      if (action.type === 'end') break;
      if (action.type === 'use') {
        await this.useCard(player, action.card, action.targets);
      } else if (action.type === 'skill') {
        await this.useSkill(player, action.skill);
      }
    }
  }

  async phaseDiscard(player) {
    const ev = { player, skipDiscard: false };
    await this.checkSkills('discardPhaseBefore', ev);
    if (ev.skipDiscard) { this.log(`${player.name} 跳过弃牌阶段`); return; }

    const limit = Math.max(0, player.hp);
    const excess = player.hand.length - limit;
    if (excess > 0) {
      this.log(`${player.name} 需弃置 ${excess} 张牌（手牌上限 ${limit}）`);
      await player.discardCards(excess, 'h', `弃牌阶段：弃置 ${excess} 张手牌`);
    }
  }

  /* ============================================================
   * 使用牌
   * ============================================================ */
  async useCard(player, card, targets) {
    const def = CARDS[card.name];
    if (!def) return;

    // ---- 引擎层合法性校验（防止 UI/AI 绕过规则）----
    if (card.name === 'sha') {
      const used = player.flags.usedShaThisTurn || 0;
      if (!this.shaUnlimited(player) && used >= 1) {
        this.log(`${player.name} 本回合已使用过【杀】，无法再次使用`);
        return;
      }
    }
    // 目标合法性
    if (targets && targets.length) {
      for (const t of targets) {
        if (t !== player && !this.canBeTargeted(t, card)) {
          this.log(`【${card.fullname}】无法指定 ${t.name} 为目标`);
          return;
        }
      }
    }

    this.log(`${player.name} 使用【${card.fullname}】${card.sourceCards && card.sourceCards.length ? `（${card.sourceCards.map((c) => c.text).join('、')}）` : ''}`);

    // 移除实体牌
    if (card.sourceCards && card.sourceCards.length) {
      await player.loseCards(card.sourceCards);
      for (const c of card.sourceCards) { c.zone = 'processing'; }
    } else if (player.getCards('he').includes(card)) {
      await player.loseCards([card]);
      card.zone = 'processing';
    }

    // 记录出杀次数
    if (card.name === 'sha') player.addFlag('usedShaThisTurn', (player.flags.usedShaThisTurn || 0) + 1);

    await this.checkSkills('cardUsed', { player, card, targets });
    this.emit();

    // 无懈可击检查（锦囊）
    if (def.type === 'trick' && !def.respondOnly) {
      const nullified = await this.checkWuxie(player, card, targets);
      if (nullified) {
        this.log(`【${card.fullname}】被【无懈可击】抵消`);
        this.toDiscard(card.sourceCards && card.sourceCards.length ? card.sourceCards : [card]);
        return;
      }
    }

    // 结算
    switch (card.name) {
      case 'sha': await this.resolveSha(player, card, targets); break;
      case 'tao': await this.resolveTao(player, targets); break;
      case 'juedou': await this.resolveJuedou(player, targets); break;
      case 'guohe': await this.resolveGuohe(player, targets); break;
      case 'shunshou': await this.resolveShunshou(player, targets); break;
      case 'wuzhong': await player.draw(2); break;
      case 'wugu': await this.resolveWugu(player); break;
      case 'taoyuan': await this.resolveTaoyuan(player); break;
      case 'nanman': await this.resolveAoe(player, card, 'sha'); break;
      case 'wanjian': await this.resolveAoe(player, card, 'shan'); break;
      case 'jiedao': await this.resolveJiedao(player, targets); break;
      case 'lebu': case 'shandian':
        if (targets && targets.length) await this.addJudgeCard(targets[0], card);
        else await this.addJudgeCard(player, card);
        return;
      default:
        if (def.type === 'equip') { await this.equipCard(player, card); return; }
        break;
    }

    this.toDiscard(card.sourceCards && card.sourceCards.length ? card.sourceCards : [card]);
    this.emit();
  }

  toDiscard(cards) {
    for (const c of cards) {
      if (!c) continue;
      c.zone = 'discard';
      if (!this.discardPile.includes(c)) this.discardPile.push(c);
    }
  }

  async equipCard(player, card) {
    const sub = CARDS[card.name].subtype;
    const old = player.equips[sub];
    if (old) {
      await player.loseCards([old]);
      player.equips[sub] = null;
      this.discardPile.push(old);
      old.zone = 'discard';
    }
    player.equips[sub] = card;
    card.zone = 'equip';
    card.owner = player;
    this.log(`${player.name} 装备了【${card.fullname}】`);
    this.emit();
  }

  /* ---------------- 无懈可击 ---------------- */
  async checkWuxie(source, card, targets) {
    let nullified = false;
    let guard = 0;
    while (guard++ < 10) {
      let someone = false;
      for (const p of this.players) {
        if (!p.alive) continue;
        const wuxies = p.getCards('he', (c) => c.name === 'wuxie');
        if (!wuxies.length) continue;
        let use = false;
        if (p.isHuman) {
          use = await this.io.askWuxie(p, source, card, nullified);
        } else {
          use = this.ai.shouldWuxie(p, source, card, nullified);
        }
        if (!use) continue;
        const picked = p.isHuman
          ? (await this.io.chooseCards(p, {
            prompt: '使用【无懈可击】', position: 'he', min: 1, max: 1,
            filter: (c) => c.name === 'wuxie', cancelable: true,
          })) || []
          : [wuxies[0]];
        if (!picked.length) continue;
        await p.loseCards(picked);
        this.discardPile.push(...picked);
        nullified = !nullified;
        this.log(`${p.name} 使用【无懈可击】${nullified ? '抵消' : '反抵消'}【${card.fullname}】`);
        this.emit();
        someone = true;
        break;
      }
      if (!someone) break;
    }
    return nullified;
  }

  /* ---------------- 各牌结算 ---------------- */
  async resolveSha(player, card, targets) {
    for (const target of targets) {
      if (!target.alive) continue;
      if (!target.alive) continue;
      await this.checkSkills('targetConfirm', { player, card, target, source: player, noShan: false });

      // 流离等转移
      const redir = await this.checkRedirect(player, card, target);
      const realTarget = redir || target;
      if (!realTarget.alive) continue;

      const needShan = this.needShanCount(player);
      let dodged = false;
      for (let i = 0; i < needShan; i++) {
        const r = await this.askShan(realTarget, player, card);
        if (!r) break;
        if (i === needShan - 1) dodged = true;
      }

      if (dodged) {
        this.log(`${realTarget.name} 使用【闪】抵消了【杀】`);
        await this.checkSkills('shaDodged', { player, card, target: realTarget, source: player, forceHit: false });
        if (!realTarget) continue;
        this.toDiscard(card.sourceCards && card.sourceCards.length ? card.sourceCards : [card]);
        continue;
      }

      await realTarget.damage(this.shaDamage(player), player, 'sha', card);
    }
  }

  needShanCount(player) {
    let n = 1;
    for (const sid of player.skills) {
      const sk = SKILLS[sid];
      if (sk && sk.mod && sk.mod.shanRequired) n = sk.mod.shanRequired(n);
    }
    return n;
  }

  shaDamage(player) {
    let n = 1;
    return n;
  }

  async askShan(target, source, card) {
    // 八卦阵
    const bagua = target.equips.equip2 && CARDS[target.equips.equip2.name].equipSkill === 'bagua_skill';
    if (bagua) {
      const wantBagua = target.isHuman
        ? await this.io.askBagua(target)
        : this.ai.shouldUseBagua(target);
      if (wantBagua) {
        const j = await target.judge('bagua');
        if (j.color === 'red') {
          this.log(`${target.name} 触发【八卦阵】，判定为红色，视为使用【闪】`);
          return true;
        }
      }
    }

    // 护驾
    if (target.hasSkill('hujia') && target.isZhu) {
      const hasWei = this.players.some((p) => p !== target && p.alive && p.group === 'wei' && p.canUseAsShan());
      if (hasWei) {
        const ctx = { player: target, game: this, event: { card, source }, skill: SKILLS.hujia };
        const use = await this.io.askSkill(target, SKILLS.hujia, ctx);
        if (use) {
          const ok = await SKILLS.hujia.content(ctx);
          if (ok) {
            this.log(`${target.name} 发动【护驾】获得【闪】`);
            return true;
          }
        }
      }
    }

    // 倾国：黑色手牌当闪
    let candidates = target.getCards('h', (c) => c.name === 'shan');
    let asQingguo = false;
    if (!candidates.length && target.hasSkill('qingguo')) {
      candidates = target.getCards('h', (c) => c.color === 'black');
      asQingguo = candidates.length > 0;
    }
    if (!candidates.length) return false;

    if (target.isHuman) {
      const picked = await this.io.chooseCards(target, {
        prompt: `响应【杀】：打出一张【闪】${asQingguo ? '（倾国：黑色手牌）' : ''}`,
        position: 'h', min: 1, max: 1,
        filter: asQingguo ? (c) => c.color === 'black' : (c) => c.name === 'shan',
        cancelable: true,
      });
      if (!picked || !picked.length) return false;
      await target.loseCards(picked);
      this.discardPile.push(...picked);
      this.log(`${target.name} 打出【闪】${asQingguo ? '（倾国）' : ''}`);
      return true;
    }
    if (this.ai.shouldRespondShan(target, source, card)) {
      const c = candidates[0];
      await target.loseCards([c]);
      this.discardPile.push(c);
      this.log(`${target.name} 打出【闪】${asQingguo ? '（倾国）' : ''}`);
      return true;
    }
    return false;
  }

  async checkRedirect(source, card, target) {
    const liuli = SKILLS.liuli;
    if (!target.hasSkill('liuli') || !target.alive) return null;
    const alive = this.players.filter((p) => p.alive);
    const cands = alive.filter((p) => p !== target && p !== source && source && source.inAttackRange(p));
    if (!cands.length || target.countCards('he') === 0) return null;

    let use = false;
    if (target.isHuman) {
      use = await this.io.askSkill(target, liuli, { player: target, game: this, event: { card, source, target } });
    } else {
      use = this.ai.shouldUseLiuli(target, source, cands);
    }
    if (!use) return null;

    const ctx = { player: target, game: this, event: { card, source, target } };
    const ok = await liuli.content(ctx);
    if (ok && ctx.event.redirectTo) {
      this.log(`${target.name} 发动【流离】，目标转移为 ${ctx.event.redirectTo.name}`);
      return ctx.event.redirectTo;
    }
    return null;
  }

  async resolveTao(player, targets) {
    const t = (targets && targets[0]) || player;
    await t.recover(1);
  }

  async resolveJuedou(player, targets) {
    const target = targets[0];
    if (!target || !target.alive) return;
    let needSha = 1;
    for (const sid of player.skills) {
      const sk = SKILLS[sid];
      if (sk && sk.mod && sk.mod.juedouShaRequired) needSha = sk.mod.juedouShaRequired(needSha);
    }
    let attacker = target;      // 目标先出杀
    let defender = player;
    let guard = 0;
    while (guard++ < 30) {
      let ok = true;
      for (let i = 0; i < needSha; i++) {
        const r = await this.askSha(attacker, defender);
        if (!r) { ok = false; break; }
      }
      if (!ok) {
        await attacker.damage(1, defender, 'juedou');
        return;
      }
      [attacker, defender] = [defender, attacker];
    }
  }

  async askSha(player, opponent) {
    let cards = player.getCards('he', (c) => c.name === 'sha');
    let viaSkill = null;
    if (!cards.length && player.hasSkill('wusheng')) {
      cards = player.getCards('he', (c) => c.color === 'red');
      viaSkill = 'wusheng';
    }
    if (!cards.length && player.hasSkill('longdan')) {
      cards = player.getCards('he', (c) => c.name === 'shan');
      viaSkill = 'longdan';
    }
    if (!cards.length) return false;

    if (player.isHuman) {
      const picked = await this.io.chooseCards(player, {
        prompt: `【决斗】：打出一张【杀】${viaSkill ? `（${SKILLS[viaSkill].name}）` : ''}`,
        position: 'he', min: 1, max: 1,
        filter: viaSkill === 'wusheng' ? (c) => c.color === 'red'
          : viaSkill === 'longdan' ? (c) => c.name === 'shan'
            : (c) => c.name === 'sha',
        cancelable: true,
      });
      if (!picked || !picked.length) return false;
      await player.loseCards(picked);
      this.discardPile.push(...picked);
      this.log(`${player.name} 打出【杀】${viaSkill ? `（${SKILLS[viaSkill].name}）` : ''}`);
      return true;
    }
    if (this.ai.shouldRespondSha(player, opponent)) {
      const c = cards[0];
      await player.loseCards([c]);
      this.discardPile.push(c);
      this.log(`${player.name} 打出【杀】${viaSkill ? `（${SKILLS[viaSkill].name}）` : ''}`);
      return true;
    }
    return false;
  }

  async resolveGuohe(player, targets) {
    const target = targets[0];
    if (!target || !target.alive) return;
    const cards = target.getCards('hej');
    if (!cards.length) return;
    const picked = await player.chooseCardFromPlayer(target, 'hej', `过河拆桥：弃置 ${target.name} 的一张牌`);
    if (picked && picked.length) {
      await target.loseCards(picked);
      this.discardPile.push(...picked);
      this.log(`${player.name} 弃置了 ${target.name} 的 ${picked[0].text}`);
    }
  }

  async resolveShunshou(player, targets) {
    const target = targets[0];
    if (!target || !target.alive) return;
    const cards = target.getCards('hej');
    if (!cards.length) return;
    const picked = await player.chooseCardFromPlayer(target, 'hej', `顺手牵羊：获得 ${target.name} 的一张牌`);
    if (picked && picked.length) {
      await target.loseCards(picked);
      // 装备转手需重新装备
      const c = picked[0];
      if (c.type === 'equip') {
        await this.equipCard(player, c);
      } else {
        await player.gain(picked, 'gain2');
      }
      this.log(`${player.name} 获得了 ${target.name} 的 ${c.text}`);
    }
  }

  async resolveWugu(player) {
    const alive = this.players.filter((p) => p.alive);
    const pool = [];
    for (let i = 0; i < alive.length; i++) {
      const c = this.takeFromDeckTop(1)[0];
      if (c) pool.push(c);
    }
    const taken = new Set();
    for (const p of alive) {
      const avail = pool.filter((c) => !taken.has(c));
      if (!avail.length) break;
      let pick;
      if (p.isHuman && p === player) {
        const picked = await this.io.chooseCards(p, {
          prompt: '五谷丰登：选择一张牌', position: 'list', min: 1, max: 1,
          cardList: avail, cancelable: false,
        });
        pick = picked && picked[0];
      } else if (p.isHuman) {
        // 其他玩家（单机时不应该出现）
        pick = avail[0];
      } else {
        pick = this.ai.pickBestCard(avail);
      }
      if (!pick) pick = avail[0];
      taken.add(pick);
      await p.gain([pick], 'gain2');
    }
    for (const c of pool) if (!taken.has(c)) { c.zone = 'discard'; this.discardPile.push(c); }
    this.emit();
  }

  async resolveTaoyuan(player) {
    for (const p of this.players.filter((x) => x.alive)) {
      if (p.isDamaged()) await p.recover(1);
    }
  }

  async resolveAoe(player, card, respondName) {
    const needSha = respondName === 'sha';
    for (const target of this.players.filter((p) => p.alive && p !== player)) {
      if (!target.alive) continue;
      // 免疫（藤甲）
      if (this.isImmune(target, card)) {
        this.log(`${target.name} 免疫了【${card.fullname}】`);
        continue;
      }
      let has = false;
      if (needSha) {
        has = await this.askSha(target, player);
      } else {
        has = await this.askShan(target, player, card);
      }
      if (!has) {
        await target.damage(1, player, card.name, card);
      }
    }
  }

  async resolveJiedao(player, targets) {
    const [holder, victim] = targets;
    if (!holder || !victim) return;
    const weapon = holder.equips.equip1;
    if (!weapon) return;
    // 令 holder 对 victim 出杀
    let has = false;
    if (holder.isHuman) {
      const picked = await this.io.chooseCards(holder, {
        prompt: `借刀杀人：对 ${victim.name} 使用一张【杀】`,
        position: 'he', min: 1, max: 1, filter: (c) => c.name === 'sha', cancelable: true,
      });
      has = !!(picked && picked.length);
      if (has) {
        await holder.loseCards(picked);
        this.log(`${holder.name} 对 ${victim.name} 使用【杀】`);
        await this.resolveSha(holder, new Card('none', 0, 'sha'), [victim]);
      }
    } else {
      has = this.ai.shouldJiedaoSha(holder, victim);
      if (has) {
        const shas = holder.getCards('he', (c) => c.name === 'sha');
        if (shas.length) {
          await holder.loseCards([shas[0]]);
          this.discardPile.push(shas[0]);
          const vc = new Card(shas[0].suit, shas[0].number, 'sha');
          this.log(`${holder.name} 对 ${victim.name} 使用【杀】`);
          await this.resolveSha(holder, vc, [victim]);
        } else has = false;
      }
    }
    if (!has) {
      // 交出武器
      await player.gain([weapon], 'gain2');
      await this.equipCard2(player, weapon);
      this.log(`${holder.name} 未出【杀】，武器交给 ${player.name}`);
    }
  }

  async equipCard2(player, card) {
    const sub = CARDS[card.name].subtype;
    const old = player.equips[sub];
    if (old && old !== card) {
      player.equips[sub] = null;
      this.discardPile.push(old); old.zone = 'discard';
    }
    // 从原持有者装备区移除
    for (const p of this.players) {
      for (const k of ['equip1', 'equip2', 'equip3', 'equip4']) {
        if (p.equips[k] === card) p.equips[k] = null;
      }
    }
    player.equips[sub] = card;
    card.zone = 'equip';
    card.owner = player;
    this.emit();
  }

  /** 主动技 */
  async useSkill(player, skillId) {
    const sk = SKILLS[skillId];
    if (!sk || sk.type !== 'active') return;
    const ctx = { player, game: this, event: {}, skill: sk };
    if (sk.filter && !sk.filter(ctx)) return;
    player.flags[`skill_${skillId}`] = (player.flags[`skill_${skillId}`] || 0) + 1;
    this.log(`${player.name} 发动【${sk.name}】`);
    await sk.content(ctx);
    this.emit();
  }
}

export default { Game, Player, Card };