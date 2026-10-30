/**
 * 核心引擎 · Game 方法集 · 回合流程
 * ------------------------------------------------------------------
 * 由 src/engine.js 拆分而来。runGame / runTurn、四个阶段、额定回合与命运回合。
 * 本文件导出普通对象字面量，方法会被混入 Game.prototype，内部 this 即 Game 实例。
 */

import { CARDS } from '../cards.js';
import { SKILLS } from '../skills.js';
import { checkDetachAutoReturn, markRatedTurnStarted, destinyTurnOrder, hasDestinyTurn, tickShifa, checkMoRoundEnd, resetMoRound, resolveXumou, xumouCardsOf, isHidden, exitHidden, tickZhanfaRoundEnd, resetOccupyRound } from '../mechanics.js';
import { ZONE } from './zones.js';
import { applyExcaliburWeaponSlot } from '../skills/table-guan.js';

export default {
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

  /*
   * 技能授予的「命运回合」
   * ----------------------------------------------------------------
   * 技能可以声明 `mod: { destinyTurn: true }`，持有者开局即拥有命运回合。
   */
  for (const p of this.players) {
    const granted = (p.skills || []).some((sid) => {
      const sk = SKILLS[sid];
      return !!(sk && sk.mod && sk.mod.destinyTurn);
    });
    if (granted) p.destinyTurn = true;
  }

  /*
   * 【无穷之锁】开局方向
   * ----------------------------------------------------------------
   * 需求方明确：**游戏开始时**选择一次（不是回合开始时）。
   * 只有拥有该技能的角色需要选；AI 默认左侧。
   */
  for (const p of this.players) {
    if (!p.skills.includes('wuqiongzhisuo')) continue;
    let side = 'left';
    if (p.isHuman) {
      const r = await this.io.chooseOption(p,
        '【无穷之锁】：游戏开始时选择你的攻击范围方向',
        [{ key: 'left', label: '左（上家）' }, { key: 'right', label: '右（下家）' }],
      ).catch(() => null);
      side = r === 'right' ? 'right' : 'left';
    }
    if (!p.storage) p.storage = {};
    p.storage.attackSide = side;
    this.log(`【无穷之锁】${p.name} 的攻击范围为${side === 'left' ? '左' : '右'}侧`);
  }

  /*
   * 【Excalibur(伪)】武器栏废除
   * ----------------------------------------------------------------
   * 需求方：「自己的武器栏不能使用，取而代之的是默认的攻击范围 +1，是永续效果」。
   * 武器栏废除后，装备【武器】会被 engine 拒绝（见 equipCard），
   * 攻击范围 +1 由技能 mod 提供。具体实现在 skills/table-guan.js，
   * 抽成函数是为了让回归测试可以直接调用。
   */
  applyExcaliburWeaponSlot(this);
  this.emit();

  // 初始手牌
  for (const p of this.players) {
    const cards = this.takeFromDeckTop(4);
    await p.gain(cards);
  }
  this.log('每名角色获得 4 张起始手牌');
  this.emit();

  // ---- 行动顺序 ----
  // 主公（1 号位）先手，然后按座位号依次行动。
  // 若主公不存在（异常情况），则从 0 号位开始。
  const lord = this.players.find((p) => p.identity === 'zhu') || this.players[0];
  const startIdx = this.players.indexOf(lord);
  let guard = 0;
  let step = 0;
  let ratedDone = 0;              // 本轮已执行的额定回合数
  const ratedTotal = () => this.players.filter((p) => p.alive).length;
  while (!this.over && guard++ < 500) {
    const p = this.players[(startIdx + step) % this.players.length];
    step++;
    if (!p.alive) continue;
    await this.runTurn(p);
    if (this.over) break;

    /* 【岚】：当前回合结束后，目标获得一个额外回合 */
    if (this._pendingExtraTurns && this._pendingExtraTurns.length) {
      const extra = this._pendingExtraTurns.shift();
      if (extra && extra.alive && !this.over) {
        this.log(`【岚】${extra.name} 开始额外回合`);
        extra.extraTurn = true;
        await this.runTurn(extra);
        if (this.over) break;
      }
    }

    /*
     * 【命运回合】
     * ----------------------------------------------------------------
     * 需求方给定：**所有角色的额定回合均执行后**，于**轮次结束前**，
     * 拥有命运回合的角色**按座次顺序**，每人依次开始一个额外回合。
     *
     * 判定：`runTurn` 会把额外回合标记为非额定（_turnIsRated=false），
     * 因此这里只统计**额定回合**的数量；凑满一轮（= 存活人数）
     * 之后插入命运回合，再进入下一轮。
     */
    if (this._turnIsRated) {
      ratedDone++;
      if (ratedDone >= ratedTotal()) {
        ratedDone = 0;

        /*
         * 【入魔】每轮结算
         * ----------------------------------------------------------------
         * 需求方/无名杀规则：「每轮结束时，若本轮你未造成过伤害，
         * 你失去 1 点体力。」必须在**开启新一轮之前**结算。
         */
        await checkMoRoundEnd(this);
        if (this.over) break;
        resetMoRound(this);           // 新一轮重新开始统计伤害

        /*
         * 【阵法技】默认时机①：每轮结束后术法 +1
         * 【占用】体力区的「每轮最多 1 点」计数也要在新一轮重置
         */
        tickZhanfaRoundEnd(this);
        resetOccupyRound(this);

        this.roundCount = (this.roundCount || 1) + 1;
        await this.runDestinyTurns();
        if (this.over) break;
      }
    }
  }
  if (!this.over) this.endGame('draw', '平局');
  this.emit();
},

async runDestinyTurns() {
  const list = destinyTurnOrder(this);
  if (!list.length) return [];
  this.log(`—— 轮次结束前，开始命运回合（${list.map((p) => p.name).join('、')}）——`);
  this.emit();
  const done = [];
  for (const p of list) {
    if (this.over) break;
    if (!p.alive || !hasDestinyTurn(p)) continue;
    // 标记为额外回合 → 不算额定回合
    p.extraTurn = true;
    await this.runTurn(p);
    done.push(p);
  }
  return done;
},

async runTurn(player) {
  this.turnCount++;
  this.currentPlayer = player;
  this._inCurrentTurn = true;      // 期间弃置的牌保留在中央区
  player.clearFlags();
  player.storage.rendeCount = 0;

  /*
   * 翻面（反面向上）：跳过其整个回合，跳过之后翻回正面
   * ----------------------------------------------------------------
   * 参考无名杀：`isTurnedOver` 为真时跳过回合，`turnOver()` 翻回。
   */
  if (player.isTurnedOver) {
    player.isTurnedOver = false;
    this.log(`—— ${player.name} 反面向上，跳过其回合（翻回正面）——`);
    // 仍要维护额定回合/轮次计数，否则会影响命运回合的判定
    this._turnIsRated = !player.extraTurn;
    if (player.extraTurn) player.extraTurn = false;
    markRatedTurnStarted(this, player);
    this.emit();
    this._inCurrentTurn = false;
    this.flushCenterZone();
    return;
  }

  /*
   * 【额定回合】标记
   * ----------------------------------------------------------------
   * 额定回合 = 在没有技能/牌影响下，每轮中该角色原本应执行的那个回合。
   * 由技能产生的**额外回合**（extraTurn）不算额定回合。
   *
   * 同时维护 roundCount（轮次）：从 1 号位开始新的一轮时 +1。
   */
  this._turnIsRated = !player.extraTurn;
  // 命运回合标记：extraTurn 会被清掉，技能需要能查到「本回合是不是命运回合」
  this.isDestinyTurn = !!player.extraTurn;
  if (player.extraTurn) player.extraTurn = false;   // 额外回合用完即清
  if (this._turnIsRated && player.id === 0) this.roundCount = (this.roundCount || 1);
  markRatedTurnStarted(this, player);

  this.log(`—— ${player.name} 的回合（第 ${this.turnCount} 回合）`
    + `${this._turnIsRated ? '' : '〔额外回合，非额定〕'}——`);
  this.emit();
  await this.io.sleep(300);

  await this.checkSkills('turnStart', { player });

  /*
   * 【隐匿】的「回合开始时登场」
   * ----------------------------------------------------------------
   * 需求方/无名杀规则：隐匿角色在其**回合开始时**登场
   *（另一条路径是「受到伤害时防止该伤害后登场」，见 doDamage）。
   */
  if (isHidden(player)) {
    this.log(`${player.name} 的回合开始，从隐匿状态登场`);
    await exitHidden(player);
  }

  /*
   * 【蓄谋】的准备阶段结算
   * ----------------------------------------------------------------
   * 需求方给定：目标的**准备阶段**时，按**后置入先使用**的顺序
   * 依次使用蓄谋牌；同名牌仅能使用 1 次；
   * 若某牌不能使用，则弃置所有剩余蓄谋牌。
   * （本项目把「准备阶段」对应为回合开始时机，先于判定阶段）
   */
  if (xumouCardsOf(player).length) {
    await resolveXumou(this, player);
    if (!player.alive || this.over) return;
  }

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

  /* 【挟令】攒下的额外阶段（回合结束时执行） */
  if (player.flags.xielingExtra && player.flags.xielingExtra.length) {
    await this.resolveXielingExtra(player);
    if (!player.alive || this.over) return;
  }

  await this.checkSkills('turnEnd', { player });

  /* ------------------------------------------------------------
   * 回合结束：清理本回合的临时状态
   * ------------------------------------------------------------
   * 【酒意】必须在这里清掉（force=true）。
   * 无名杀把酒意挂在临时技能上，`phaseAfter` 移除技能时
   * `onremove` 会 `delete storage.jiu`，所以酒意**绝不可能跨回合**。
   * 若不清理，就会变成「上回合喝的酒，下回合的杀还在加伤」——
   * 这不符合原版规则。
   * ------------------------------------------------------------ */
  this.clearJiu(player, true);

  /*
   * 【轮换牌】的「本回合」临时状态
   * ----------------------------------------------------------------
   * 寒门志（本回合不能使用牌）、塔伊兹育罗斯（用牌前付代价）、
   * 奥博洛斯（手牌上限 1 + 伤害后摸牌）、希佩（本回合伤害 -1）
   * 都是「本回合」效果的，回合结束时统一清掉。
   */
  for (const p of this.players) {
    if (!p.flags) continue;
    delete p.flags.cannotUseCardTurn;
    delete p.flags.tayiziyuluosiCost;
    delete p.flags.aoboluosi;
    delete p.flags.handLimitOverride;
    if (p.flags.handVisibleTo) delete p.flags.handVisibleTo;
  }
  this._damageMinusOneTurn = false;

  /*
   * 【调离】的自动调回
   * ----------------------------------------------------------------
   * 需求方给定：**未注明调回时间则默认为当前回合结束后调回**。
   * 因此在这里统一检查「到期自动调回」。
   */
  checkDetachAutoReturn(this);

  /*
   * 【施法】标记递减
   * ----------------------------------------------------------------
   * 需求方给定：发动时获得 X 个同名施法标记，
   * **每回合结束时移去 1 枚**，数量归零时结算该技能的效果。
   */
  await tickShifa(this, player);

  // ---- 回合彻底结束：中央区归档进弃牌堆 ----
  // 此后这些牌只能从弃牌堆检索到，中央区不再包含它们。
  this._inCurrentTurn = false;
  this.flushCenterZone();

  this.emit();
},

async phaseJudge(player) {
  this.log(`${player.name} 进入判定阶段`);
  for (const card of player.judges.slice()) {
    if (!player.judges.includes(card)) continue;
    player.judges.splice(player.judges.indexOf(card), 1);
    card.zone = ZONE.FLYING;
    this.emit();

    /* ============================================================
     * 判定**之前**先询问【无懈可击】
     * ============================================================
     * 参考无名杀 content.js executeDelayCardEffect：
     *   event.cancelled = false;
     *   await event.trigger('executeDelayCardEffect');   ← 无懈在此询问
     *   if (event.cancelled || event.nojudge) return;    ← 被抵消就跳过判定
     *
     * 被无懈后的处理按牌种区分：
     *   【闪电】     → 不判定，**直接移动到下家**（保留在场上）
     *   【乐不思蜀】 → 无效，**进入弃牌堆**
     *   【兵粮寸断】 → 无效，**进入弃牌堆**
     * ============================================================ */
    const cancelled = await this.askWuxieForJudge(player, card);
    if (cancelled) {
      this.log(`【${card.fullname}】被【无懈可击】抵消`);
      if (card.name === 'shandian') {
        // 闪电：不判定，直接传给下家
        await this.moveShandianToNext(player, card);
      } else {
        // 其他延时锦囊：无效并进入弃牌堆
        this.toDiscard(card);
        card.zone = ZONE.DISCARD;
        this.log(`【${card.fullname}】无效并进入弃牌堆`);
      }
      this.emit();
      continue;
    }

    if (card.name === 'lebu') {
      const j = await player.judge('lebu');
      if (j.suit !== 'heart') {
        player.addFlag('skipUse', true);
        this.log(`${player.name} 被【乐不思蜀】影响，跳过出牌阶段`);
      }
      this.toDiscard(card); card.zone = 'discard';
    } else if (card.name === 'bingliang') {
      // 兵粮寸断：判定不为梅花则跳过摸牌阶段
      const j = await player.judge('bingliang');
      if (j.suit !== 'club') {
        player.addFlag('skipDraw', true);
        this.log(`${player.name} 被【兵粮寸断】影响，跳过摸牌阶段`);
      }
      this.toDiscard(card); card.zone = 'discard';
    } else if (card.name === 'shandian') {
      const j = await player.judge('shandian');
      const spade29 = j.suit === 'spade' && j.number >= 2 && j.number <= 9;
      if (spade29) {
        this.toDiscard(card); card.zone = 'discard';
        await player.damage(3, null, 'shandian', null);
        if (!player.alive) return;
      } else {
        await this.moveShandianToNext(player, card);
      }
    } else if (card.name === 'fulei') {
      /*
       * 【浮雷】：判定为黑桃 → 受到 X 点雷电伤害
       * （X 为此【浮雷】判定出黑桃的次数，记在卡上）
       * 然后无论如何都移到下家的判定区。
       */
      const j = await player.judge('fulei');
      if (j.suit === 'spade') {
        card.fuleiSpades = (card.fuleiSpades || 0) + 1;
        const x = card.fuleiSpades;
        this.log(`【浮雷】判定为黑桃，${player.name} 受到 ${x} 点雷电伤害`);
        await player.damage(x, null, 'fulei', null, 'thunder');
        if (!player.alive) { this.toDiscard(card); card.zone = ZONE.DISCARD; return; }
      }
      await this.moveShandianToNext(player, card);
    }
    this.emit();
  }
},

async moveShandianToNext(player, card) {
  const alive = this.players.filter((p) => p.alive);
  const i = alive.indexOf(player);
  const next = alive[(i + 1) % alive.length];
  if (next && next !== player) {
    card.zone = ZONE.JUDGE;
    next.judges.push(card);
    this.log(`【${card.fullname}】移动到 ${next.name} 的判定区`);
  } else {
    this.toDiscard(card);
    card.zone = ZONE.DISCARD;
  }
},

async askWuxieForJudge(player, judgeCard) {
  // 场上无人持有无懈 → 直接跳过，避免无谓的询问
  const holders = this.players.filter(
    (p) => p.alive && p.getCards('h', (c) => c.name === 'wuxie').length > 0,
  );
  if (!holders.length) return false;

  // 借用锦囊的无懈流程：把「判定区的牌」当作无懈的目标牌
  const result = await this.checkWuxie(
    judgeCard, player, [player],
  );
  return !!result;
},

async phaseDraw(player) {
  // 兵粮寸断：判定失败会设置 skipDraw 标记
  if (player.hasFlag('skipDraw')) {
    this.log(`${player.name} 跳过摸牌阶段`);
    this.emit();
    return;
  }
  let num = 2;
  const ev = { player, num, drawDelta: 0, skipDraw: false };
  await this.checkSkills('drawPhaseBefore', ev);
  if (ev.skipDraw) { this.emit(); return; }
  num = Math.max(0, num + (ev.drawDelta || 0));
  this.log(`${player.name} 进入摸牌阶段，摸 ${num} 张牌`);
  await player.draw(num);
},

async phaseUse(player) {
  if (player.hasFlag('skipUse')) { this.log(`${player.name} 跳过出牌阶段`); return; }
  this.log(`${player.name} 进入出牌阶段`);

  // 标记「正处于出牌阶段」，供【杀】次数限制等判断使用
  // （官方规则：只有自己的出牌阶段内才限制【杀】的次数）
  this._inPlayPhase = true;

  // 出牌阶段开始时（如【星火尽染寒】在此发动）
  await this.checkSkills('phaseUseBegin', { player });
  if (!player.alive || this.over) { this._inPlayPhase = false; return; }

  this.emit();

  let guard = 0;
  while (guard++ < 60) {
    if (!player.alive || this.over) { this._inPlayPhase = false; return; }
    // 【挟令】等牌可以让出牌阶段提前结束
    if (player.hasFlag('endUsePhase')) {
      player.flags.endUsePhase = false;
      this.log(`${player.name} 提前结束了出牌阶段`);
      break;
    }
    const action = await this.io.chooseAction(player, this);
    if (action.type === 'end') break;
    if (action.type === 'use') {
      await this.useCard(player, action.card, action.targets);
    } else if (action.type === 'skill') {
      await this.useSkill(player, action.skill);
    }
  }
  this._inPlayPhase = false;
},

canTargetByLimits(source, target, card) {
  if (!source || !target) return true;
  for (const { skill, role } of this.collectTargetLimitSkills(source)) {
    const fn = skill.mod && skill.mod.targetLimit;
    if (typeof fn !== 'function') continue;
    let ok = true;
    try { ok = fn(card, source, target, { skill, role, game: this }); } catch { ok = true; }
    if (!ok) return false;
  }
  return true;
},

collectTargetLimitSkills(player) {
  const out = [];
  for (const sid of player.skills || []) {
    const sk = SKILLS[sid];
    if (sk && sk.mod && sk.mod.targetLimit) out.push({ skill: sk, role: 'self' });
  }
  for (const c of Object.values(player.equips || {}).filter(Boolean)) {
    const esid = CARDS[c.name] && CARDS[c.name].equipSkill;
    const sk = esid && SKILLS[esid];
    if (sk && sk.mod && sk.mod.targetLimit) out.push({ skill: sk, role: 'equip' });
  }
  return out;
},

hasUsedCardThisTurn(player) {
  return !!(player.flags && player.flags.usedCardThisTurn);
},

hasBeenTargetedThisTurn(player) {
  return !!(player.flags && player.flags.beenTargetedThisTurn);
},

isInPlayPhase(player) {
  if (!player) return false;
  if (this.currentPlayer !== player) return false;
  return this._inPlayPhase === true;
},

async phaseDiscard(player) {
  const ev = { player, skipDiscard: false };
  await this.checkSkills('discardPhaseBefore', ev);
  if (ev.skipDiscard) { this.log(`${player.name} 跳过弃牌阶段`); return; }

  const limit = Math.max(0, player.hp);
  /*
   * 「不计入手牌上限」的牌
   * ----------------------------------------------------------------
   * 带 gaintag 'suodi' 的牌（【同步索敌攻击】摸到的）不占手牌上限，
   * 因此计算超出量时要先把它们排除掉。
   */
  const noLimitCount = player.countNoLimitCards
    ? player.countNoLimitCards() : 0;
  const excess = Math.max(0, player.hand.length - noLimitCount - limit);
  if (excess <= 0) return;

  this.log(`${player.name} 需弃置 ${excess} 张牌（手牌上限 ${limit}`
    + `${noLimitCount ? `，另有 ${noLimitCount} 张不计入手牌上限` : ''}）`);

  // 「手牌与体力等价」：可用体力代替部分/全部弃牌
  const split = await player.chooseDiscardSplit(excess);
  if (split) {
    const { cards: nCards, hp: nHp } = split;
    if (nHp > 0) await player.payDiscardWithHp(nHp);
    if (!player.alive) return;
    if (nCards > 0) {
      await player.discardCards(nCards, 'h',
        `弃牌阶段：以体力代替 ${nHp} 张，还需弃置 ${nCards} 张手牌`);
    } else {
      this.log(`${player.name} 完全以体力完成了本次弃牌`);
    }
    return;
  }

  await player.discardCards(excess, 'h', `弃牌阶段：弃置 ${excess} 张手牌`);
}
};
