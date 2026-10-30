/**
 * 核心引擎 · Game 方法集 · 出牌与装备
 * ------------------------------------------------------------------
 * 由 src/engine.js 拆分而来。useCard 主流程、虚拟牌、可用性判定、无懈可击、装备的穿上与替换。
 * 本文件导出普通对象字面量，方法会被混入 Game.prototype，内部 this 即 Game 实例。
 */

import { CARDS } from '../cards.js';
import { noteSuitUsed } from '../skills.js';
import { isIgnited, isDetached, enterSettlement, exitSettlement } from '../mechanics.js';
import { ZONE, EQUIP_SLOT_MAP_SHORT } from './zones.js';

export default {
async emitCardUsed(player, card, targets = []) {
  const ev = {
    player, card, targets: targets || [], kind: 'use',
  };
  // 本回合「使用过牌」标记（【无我入春时】给护甲时要用）
  if (player.addFlag) player.addFlag('usedCardThisTurn', 1);
  // 本回合「成为过牌的目标」标记（按每个目标分别记录）
  for (const t of (targets || [])) {
    if (t && t !== player && t.addFlag) t.addFlag('beenTargetedThisTurn', 1);
  }

  /*
   * 【连招技】
   * ----------------------------------------------------------------
   * 必须在把本次使用压入历史**之前**检查，
   * 否则 getLastUsedCard 取到的就是当前这张牌本身。
   * 对照无名杀：技能在 useCard 时机用 getHistory("useCard") 的倒数第二条。
   */
  await this.checkSkills('comboCheck', ev);
  this.useEvents.push({ ...ev, turn: this.turnCount });

  await this.checkSkills('cardUsed', ev);
  /*
   * 转化生效
   * ----------------------------------------------------------------
   * 转化技在 `cardUsed` 时机只负责**声明**「这张牌视为哪张牌」
   *（把目标牌名挂在 `card._convertTo` 上），真正的替换在这里统一做：
   * 技能不必碰引擎的结算细节，也不会有谁漏改 fullname / type。
   */
  this.applyUseConvert(card);
  await this.checkSkills('cardUsedOrResponded', ev);
  // 「成为牌的目标」按每个目标分别触发
  for (const t of (targets || [])) {
    await this.checkSkills('cardTargeted', { player, card, target: t, targets });
  }
  return ev;
},

/* ============================================================
 * 转化（「视为使用另一张牌」）
 * ============================================================ */

/**
 * 把 `card._convertTo` 声明的转化应用到这张牌上
 * ------------------------------------------------------------------
 * 技能只要设置 `card._convertTo = '某牌名'`，这里统一负责：
 * 记住原牌名（结算后还原）、替换牌名与全部牌面信息。
 * @returns {boolean} 是否真的发生了转化
 */
applyUseConvert(card) {
  const to = card && card._convertTo;
  if (!to || to === card.name) return false;
  const toDef = CARDS[to];
  if (!toDef) {
    delete card._convertTo;
    return false;
  }
  card._convertFrom = { name: card.name, fullname: card.fullname };
  card.name = to;
  card.fullname = toDef.fullname || to;
  card.type = toDef.type;
  card.subtype = toDef.subtype;
  card.delayed = !!toDef.delayed;
  delete card._convertTo;
  this.log(`【转化】${card._convertFrom.fullname} 视为【${card.fullname}】使用`);
  return true;
},

/**
 * 结算结束后把牌名还原
 * ------------------------------------------------------------------
 * 被转化使用的**实体牌**还是原来那张（弃牌堆里必须显示原来的牌名），
 * 所以还原要发生在「本次使用完全结束」之后，由外层 useCard 的 finally 调用。
 */
restoreConvertedCard(card) {
  const from = card && card._convertFrom;
  if (!from) return;
  const def = CARDS[from.name] || {};
  card.name = from.name;
  card.fullname = from.fullname || from.name;
  card.type = def.type;
  card.subtype = def.subtype;
  card.delayed = !!def.delayed;
  delete card._convertFrom;
},

/**
 * 使用一张牌时「不需要玩家选目标」的情形，直接给出目标
 * ------------------------------------------------------------------
 * 技能「视为使用一张牌」时也要走这套判断，因此做成引擎方法共用。
 * @returns {Player[]|null} null = 需要玩家自己选
 */
defaultTargetsFor(player, card) {
  const def = CARDS[card.name] || {};
  if (def.type === 'equip') return [];
  if (def.respondOnly) return [];
  // 延时锦囊：使用时不选目标（判定阶段自己结算）
  if (def.delayed) return [];
  // 只对自己生效：桃 / 酒 / 无中生有 / 洞烛先机 / 树上开花 / 挟令 / 舌战群儒 …
  if (def.selfOnly) return [player];
  // 群体牌：结算时自行遍历全场，不需要预先指定目标
  //（南蛮/万箭只打「其他角色」，故没有 allPlayers 字段，需单独列出）
  if (def.allPlayers || card.name === 'nanman' || card.name === 'wanjian') return [];
  // 需要选目标的牌交给调用方
  return null;
},

/**
 * 转化后重新确定目标
 * ------------------------------------------------------------------
 * 转化的牌需要目标、而原来的目标又不适用时（如【桃】转化成了【杀】），
 * 按新牌重新选一次；不需要目标的牌返回空数组。
 */
async retargetAfterConvert(player, card, targets) {
  const fixed = this.defaultTargetsFor(player, card);
  if (fixed) return fixed;
  const ok = (targets || []).filter((t) => t === player
    || this.canBeTargeted(t, card));
  if (ok.length) return ok;
  return this.pickTargetsForVirtual(player, card);
},

async emitCardResponded(player, card, reason = '') {
  const ev = { player, card, reason, kind: 'respond' };
  this.useEvents.push({ ...ev, turn: this.turnCount });
  await this.checkSkills('cardResponded', ev);
  await this.checkSkills('cardUsedOrResponded', ev);
  return ev;
},

/*
 * 使用一张牌
 * ==================================================================
 * 拆成两层：
 *   useCard      —— 外层壳子，只负责**结算后把被转化的牌复原**；
 *   useCardCore  —— 真正的使用与结算流程。
 * 分开的原因：转化技（如【双星伴生之人】）会临时改掉 `card.name`，
 * 但那张**实体牌**本身没变（它仍然是手牌里那张【桃】），
 * 所以结算一结束就必须还原，否则牌堆里会留下一张假的【杀】。
 */
async useCard(player, card, targets) {
  enterSettlement(this);          // 【破惘长行】以「一张牌的结算」为界
  // UI 钩子：使用牌时画出「发起者 → 每个目标」的黄线（引擎不关心实现）
  if (typeof this.io?.showCardTargets === 'function') {
    try { this.io.showCardTargets(player, targets || []); } catch (e) { /* 纯视觉效果，失败不影响对局 */ }
  }
  try {
    return await this.useCardCore(player, card, targets);
  } finally {
    this.restoreConvertedCard(card);
    exitSettlement(this);
  }
},

async useCardCore(player, card, targets) {
  let def = CARDS[card.name];
  if (!def) return;

  /*
   * 结算前快照
   * ----------------------------------------------------------------
   * 【同步索敌攻击】需要「这张牌结算后，有没有其他角色的体力或
   * 手牌数减少」。因此在**任何结算发生之前**记录全场的
   * （体力, 手牌数），结算完再比对。
   * 快照挂在 card 上，由 cardUsedAfter 时机读取。
   */
  card._snapBefore = this.snapshotVitals();

  // ---- 引擎层合法性校验（防止 UI/AI 绕过规则）----

  /*
   * ⓪【调离】：被调离的角色**不能使用牌**
   * （需求方给定规则；无名杀无此机制）
   */
  if (isDetached(player)) {
    this.log(`${player.name} 处于调离状态，不能使用牌`);
    return;
  }

  // ① 已装备的牌不能被再次使用（三国杀原版机制）
  //    装备区的牌只能被弃置/获得，不能作为手牌打出。
  const isEquipped = Object.values(player.equips).some((c) => c === card)
    || (card.sourceCards || []).some((c) => Object.values(player.equips).some((e) => e === c));
  if (isEquipped) {
    this.log(`【${card.fullname}】已在装备区，无法再次使用`);
    return;
  }

  /* 【寒门志】：本回合不能使用或打出牌 */
  if (player.flags && player.flags.cannotUseCardTurn) {
    this.log(`${player.name} 本回合不能使用或打出牌（寒门志）`);
    return;
  }

  /* 【塔伊兹育罗斯】：用牌前须弃一张牌或失去 1 点体力 */
  if (player.flags && player.flags.tayiziyuluosiCost) {
    if (!await this.payTayiziyuluosiCost(player)) {
      this.log(`${player.name} 未支付【塔伊兹育罗斯】的代价，不能使用牌`);
      return;
    }
  }

  // ② 装备区被废除时不能装备
  if (def.type === 'equip' && player.isEquipSlotDisabled(def.subtype)) {
    this.log(`装备区已被废除，无法装备【${card.fullname}】`);
    return;
  }

  /*
   * ③ 【杀】次数限制
   * ----------------------------------------------------------------
   * 官方规则：**只有在自己的出牌阶段内**才有「每回合限一次【杀】」的限制。
   * 出牌阶段之外（如回合结束时的技能视为使用【杀】、
   * 其他角色回合中触发的效果）**没有次数限制**。
   *
   * 例：卡达【剪辑高手】在**回合结束时**视为使用【杀】，
   *     此时不在出牌阶段内，因此不该受次数限制。
   *
   * 另：技能可临时赋予「本回合无次数限制」（如【星火尽染寒】）。
   *     【点燃】的牌本身也**无次数限制**。
   */
  if (card.name === 'sha') {
    const ignitedFree = isIgnited(card);      // 【点燃】：无次数限制
    const inMyPlayPhase = this.isInPlayPhase(player);
    if (inMyPlayPhase && !ignitedFree) {
      const used = player.flags.usedShaThisTurn || 0;
      const noLimit = this.shaUnlimited(player)
        || (player.flags && player.flags.shaNoLimitThisTurn);
      if (!noLimit && used >= 1) {
        this.log(`${player.name} 本回合已使用过【杀】，无法再次使用`);
        return;
      }
    }
  }
  // ④ 目标合法性
  if (targets && targets.length) {
    for (const t of targets) {
      if (t !== player && !this.canBeTargeted(t, card)) {
        this.log(`【${card.fullname}】无法指定 ${t.name} 为目标`);
        return;
      }
      // 技能施加的目标限制（如【星火尽染寒】只允许手牌/体力不小于自己的角色）
      if (t !== player && !this.canTargetByLimits(player, t, card)) {
        this.log(`【${card.fullname}】无法指定 ${t.name} 为目标`
          + `（不满足本回合的目标限制）`);
        return;
      }
    }
  }

  // ⑤ 属性杀转化（朱雀羽扇）：可将普通【杀】改为火【杀】或雷【杀】
  //    由调用方通过 card.useElement 表明意图（UI 询问 / AI 决策）。
  if (card.name === 'sha' && !card.nature) {
    const opts = this.elementShaOptions(player) || [];
    if (opts.length) {
      const want = card.useElement
        || (card.useFire === true ? 'fire' : undefined)
        || (card.useElement === undefined && this.ai && this.ai.wantFireSha
          && opts.includes('fire') && this.ai.wantFireSha(player, targets) ? 'fire' : undefined);
      if (want && opts.includes(want)) {
        card.nature = want;
        this.log(`${player.name} 发动【朱雀羽扇】，此【杀】视为${want === 'fire' ? '火' : '雷'}【杀】`);
      }
    }
  }

  this.log(`${player.name} 使用【${card.fullname}】${card.sourceCards && card.sourceCards.length ? `（${card.sourceCards.map((c) => c.text).join('、')}）` : ''}`);

  // ============================================================
  // 装备牌：走独立路径，**不经过中央区/弃牌堆**
  // 参考无名杀 content.js 的 equip() / replaceEquip()：
  //   - 装备牌从手牌直接移入装备区
  //   - 只有被顶掉的【旧装备】才进弃牌堆
  //   - 新装备本身绝不进入处理区
  // ============================================================
  if (def.type === 'equip') {
    // 从手牌移除（如果是从手牌使用的）
    if (card.sourceCards && card.sourceCards.length) {
      await player.loseCards(card.sourceCards);
    } else if (player.getCards('he').includes(card)) {
      await player.loseCards([card]);
    }
    /*
     * 【护心镜】可以「对其他角色使用」：给他装上去（顶掉原来的防具）。
     * 其余装备只能装给自己。
     */
    const equipTo = def.usableOnOther && targets && targets.length && targets[0] !== player
      ? targets[0]
      : player;
    // 装备区被废除时不消耗这张牌，退回手牌
    if (equipTo.isEquipSlotDisabled(def.subtype)) {
      this.log(`${equipTo.name} 的${EQUIP_SLOT_MAP_SHORT[def.subtype] || def.subtype}区已被废除，【${card.fullname}】无法装备`);
      if (!player.hand.includes(card)) {
        card.zone = 'hand';
        card.owner = player;
        player.hand.push(card);
      }
      this.emit();
      return;
    }
    await this.emitCardUsed(player, card, targets);
    await this.equipCard(equipTo, card);
    return;
  }

  // 移除实体牌，并置入中央区（本回合处理区）
  // 中央区的牌同时算作弃牌堆的一部分，回合结束后归档。
  if (card.sourceCards && card.sourceCards.length) {
    // 【毒】「被转化牌而离开手牌区」→ 标记后才能触发失去体力
    for (const s of card.sourceCards) s._leavingAsSource = true;
    await player.loseCards(card.sourceCards);
    this.toCenter(card.sourceCards);
  } else if (player.getCards('he').includes(card)) {
    await player.loseCards([card]);
    this.toCenter([card]);
  }

  // 记录出杀次数（**转化之后**再记，见下面的⑥）
  await this.emitCardUsed(player, card, targets);
  this.emit();

  /*
   * ⑥ 转化后的收尾
   * ----------------------------------------------------------------
   * 【双星伴生之人】等技能会在 `cardUsed` 时机把这张牌「视为」另一张牌
   * 使用（转化）。转化会连带改变这张牌的类型、目标与合法性，因此这里
   * 统一处理三件事：
   *   1. 刷新 def（类型可能已经从基本牌变成锦囊牌）；
   *   2. 转化后若**根本无法使用**（需求方所谓「非法」），本次使用不产生
   *      任何效果，牌直接进弃牌堆；
   *   3. 需要目标的牌，若原目标不再适用，则按新牌重新选目标。
   * 外层 useCard 的 finally 负责把牌名还原成实体牌本来的样子。
   */
  if (card._convertFrom) {
    def = CARDS[card.name] || def;
    if (!this.cardUsableNow(player, card)) {
      this.log(`【${card.fullname}】当前无法使用，本次使用未产生效果`);
      this.toDiscard(card.sourceCards && card.sourceCards.length
        ? card.sourceCards : [card]);
      this.emit();
      await this.emitCardUsedAfter(player, card, targets);
      return;
    }
    targets = await this.retargetAfterConvert(player, card, targets);
  }

  // 记录出杀次数（转化成的【杀】也计入次数）
  if (card.name === 'sha') {
    player.addFlag('usedShaThisTurn', (player.flags.usedShaThisTurn || 0) + 1);
  }

  // 无懈可击检查（锦囊；「星神赐福」不能被无懈，见下）
  if (def.type === 'trick' && !def.respondOnly) {
    const nullified = await this.checkWuxie(player, card, targets);
    if (nullified) {
      this.log(`【${card.fullname}】被【无懈可击】抵消`);
      /* 【闪闪】当无懈用掉时，抵消者获得被抵消的牌 */
      if (card._ssTaker && card._ssTaker.alive) {
        await card._ssTaker.gain([card], 'gain2');
      } else {
        this.toDiscard(card.sourceCards && card.sourceCards.length ? card.sourceCards : [card]);
      }
      return;
    }
  }

  /*
   * 【金蝉脱壳】：目标可以弃置此牌令该牌对自己无效（不是无懈，无法被反制）。
   * 只有「本来有目标、且全部被抵消」才算结算结束；
   * 群体锦囊/只对自己的牌本来就可以不带目标（如万箭齐发、无中生有），
   * 不能因为 targets 为空就判定为「目标全部消失」。
   */
  const targetsBeforeJinchan = targets || [];
  targets = await this.filterJinchan(player, card, targets);
  if (targetsBeforeJinchan.length && (!targets || !targets.length)) {
    this.log(`【${card.fullname}】的目标全部消失，结算结束`);
    this.toDiscard(card.sourceCards && card.sourceCards.length ? card.sourceCards : [card]);
    this.emit();
    return;
  }
  targets = targets || [];

  /*
   * 【IX】—— 对一张正在结算的牌使用，令其无效。
   * 「星神赐福」不能被【无懈可击】抵消，但可以被 IX 压掉；
   * 被 IX 压掉的赐福牌，其目标仍然算「成为过星神赐福的目标」。
   */
  if (await this.askIX(player, card, targets)) {
    this.toDiscard(card.sourceCards && card.sourceCards.length ? card.sourceCards : [card]);
    this.emit();
    return;
  }

  /* 【迷思】：目标可以扣置并声明牌名，被质疑时按真假结算 */
  let misiExtra = 0;
  if (player.flags && player.flags.misiTimes) {
    const r = await this.misiDeclare(player, card);
    misiExtra = r.extra || 0;
  }

  // 结算
  switch (card.name) {
    case 'sha': await this.resolveSha(player, card, targets); break;
    case 'tao': await this.resolveTao(player, targets); break;
    case 'juedou': await this.resolveJuedou(player, targets, card); break;
    case 'guohe': await this.resolveGuohe(player, targets); break;
    case 'shunshou': await this.resolveShunshou(player, targets); break;
    case 'wuzhong': await player.draw(2); break;
    case 'wugu': await this.resolveWugu(player); break;
    case 'taoyuan': await this.resolveTaoyuan(player); break;
    case 'nanman': await this.resolveAoe(player, card, 'sha'); break;
    case 'wanjian': await this.resolveAoe(player, card, 'shan'); break;
    case 'jiedao': await this.resolveJiedao(player, targets); break;
    /* 延时锦囊：必须指定目标，**绝不能默认给自己**
     *（【闪电】是唯一可以给自己的，它是使用者的自我判定）
     * 历史坑：原来写成 `else addJudgeCard(player)`，
     * 导致【兵粮寸断】/【乐不思蜀】在没有目标时错误地贴到自己身上。 */
    case 'shandian':
      await this.addJudgeCard(player, card);
      return;
    case 'lebu':
    case 'bingliang': {
      if (!targets || !targets.length) {
        this.log(`【${card.fullname}】需要指定一名其他角色为目标`);
        // 退回手牌，不消耗
        if (!player.hand.includes(card)) {
          card.zone = ZONE.HAND;
          card.owner = player;
          player.hand.push(card);
        }
        this.emit();
        return;
      }
      await this.addJudgeCard(targets[0], card);
      return;
    }
    /* ---------- 风林火山 ---------- */
    case 'jiu': await this.resolveJiu(player); return;
    case 'huogong': await this.resolveHuogong(player, targets); break;
    case 'tiesuo': await this.resolveTiesuo(player, targets); break;
    /* ---------- 扩展牌（四副牌堆） ---------- */
    case 'zhujin': await this.resolveZhujin(player, targets); break;
    case 'dongzhu': await this.resolveDongzhu(player); break;
    case 'zengbing': await this.resolveZengbing(player, targets); break;
    case 'shushangkaihua': await this.resolveShushangkaihua(player); break;
    case 'shuiyan': await this.resolveShuiyan(player, targets); break;
    case 'xieling': await this.resolveXieling(player); break;
    case 'shezhan': await this.resolveShezhan(player); break;
    case 'diaobing': await this.resolveDiaobing(player); break;
    case 'chuqi': await this.resolveChuqi(player, targets); break;
    case 'huoshaolianying': await this.resolveHuoshaolianying(player); break;
    case 'yuanjiao': await this.resolveYuanjiao(player); break;
    /* ---------- 轮换牌（卡包） ---------- */
    case 'hanmenzhi': await this.resolveHanmenzhi(player); break;
    case 'zhengshangji': await this.resolveZhengshangji(player); break;
    case 'yuliangyi': await this.resolveYuliangyi(player, targets[0]); break;
    case 'fulei': await this.addJudgeCard(player, card); return;
    default:
      if (def.type === 'equip') { await this.equipCard(player, card); return; }
      if (def.type === 'blessing') { await this.resolveBlessing(player, card, targets); return; }
      break;
  }

  /* 【迷思】声明成功时额外结算一次 */
  if (misiExtra > 0) {
    this.log(`【迷思】${card.fullname} 额外结算一次`);
    switch (card.name) {
      case 'sha': await this.resolveSha(player, card, targets); break;
      case 'juedou': await this.resolveJuedou(player, targets, card); break;
      case 'guohe': await this.resolveGuohe(player, targets); break;
      case 'shunshou': await this.resolveShunshou(player, targets); break;
      case 'huogong': await this.resolveHuogong(player, targets); break;
      default: break;
    }
  }
  /* 【迷思】被质疑且声明不符 → 质疑者摸一张 */
  if (this._misiDrawAfter && this._misiDrawAfter.alive) {
    await this._misiDrawAfter.draw(1);
    this._misiDrawAfter = null;
  }

  this.toDiscard(card.sourceCards && card.sourceCards.length ? card.sourceCards : [card]);
  this.emit();

  // ⑩ 使用牌后（结算完毕）——【同步索敌攻击】在此检查全场变化
  await this.emitCardUsedAfter(player, card, targets);
},

async emitCardUsedAfter(player, card, targets = []) {
  /*
   * 【界乱击】结算完毕
   * ----------------------------------------------------------------
   * 璐米欧儿【黑白乱舞】用弃牌发动的那张【万箭齐发】结算结束后：
   *   · 若此牌**没有造成过伤害** → 使用者摸「目标数」张牌。
   * 伤害次数由 resolveAoe 写在 card.luanjiDamaged 上（见 g-resolve.js）。
   * 只在确实出自【界乱击】时才触发（card.luanjiFrom）。
   */
  if (card && card.luanjiFrom) {
    await this.checkSkills('luanjiAfter', {
      player,
      card,
      targets: targets || [],
      luanjiDamaged: card.luanjiDamaged || 0,
    });
  }

  await this.checkSkills('cardUsedAfter', {
    player,
    card,
    targets: targets || [],
    _snapBefore: card && card._snapBefore,
  });

  /*
   * 【结算中出现过的花色】记录
   * ----------------------------------------------------------------
   * 白金磷子【怯懦的琴键】的「仄」需要一个「本回合结算中出现过的
   * 花色」集合。这里在每次牌结算完毕后记录其花色。
   */
  if (card && card.suit) {
    this._resolvedSuits = this._resolvedSuits || [];
    if (!this._resolvedSuits.includes(card.suit)) {
      this._resolvedSuits.push(card.suit);
    }
    // 「同一结算」块内也累积记录（供「仄」封锁）
    this.noteBlockSuit(card.suit);
  }

  /*
   * 【前行的决心】「已受伤时，每个花色首次使用后从牌堆底摸一张」
   * 注意只在**使用者自己**满足条件时生效。
   */
  await noteSuitUsed(player, card, this);
},

snapshotVitals() {
  const map = {};
  for (const p of this.players) {
    map[p.id] = { hp: p.hp, hand: p.countCards('h') };
  }
  return map;
},

anyOtherSuffered(self, snap) {
  if (!snap) return false;
  for (const p of this.players) {
    if (p === self) continue;
    const before = snap[p.id];
    if (!before) continue;
    if (p.hp < before.hp) return true;
    if (p.countCards('h') < before.hand) return true;
  }
  return false;
},

cardUsableNow(player, card) {
  if (!card) return false;
  const def = CARDS[card.name];
  if (!def) return false;
  /*
   * 只能作为响应使用的牌（【闪】【无懈可击】）永远不算「可用」
   * ----------------------------------------------------------------
   * 这里问的是「现在能不能主动使用这张牌」。
   * 这个判断被三处依赖：【前行的决心】、【剪辑高手】，
   * 以及转化后「这张牌现在能不能用」的合法性检查。
   */
  if (def.respondOnly) return false;
  const alive = this.players.filter((p) => p.alive);
  const others = alive.filter((p) => p !== player);

  switch (card.name) {
    case 'sha': {
      // 出牌阶段内还要看次数（转化出来的【杀】同样受次数限制）
      if (this.isInPlayPhase(player) && !isIgnited(card)) {
        const used = player.flags.usedShaThisTurn || 0;
        const noLimit = this.shaUnlimited(player)
          || (player.flags && player.flags.shaNoLimitThisTurn);
        if (!noLimit && used >= 1) return false;
      }
      // 需要有攻击范围内的目标（或本回合无距离限制）
      return others.some((p) => this.cardNoDistance(player, card)
        || player.inAttackRange(p));
    }
    case 'tao':
      return player.hp < player.maxHp || player.hp <= 0;
    case 'juedou':
    case 'guohe':
    case 'shunshou':
    case 'huogong':
      return others.length > 0;
    case 'jiedao':
      // 需要场上有武器，且该武器持有者能打到别人
      return alive.some((p) => p.equips && p.equips.equip1)
        && others.length > 0;
    case 'lebu':
    case 'bingliang':
    case 'shandian':
      return true;
    case 'nanman':
    case 'wanjian':
    case 'wugu':
    case 'taoyuan':
      return others.length > 0 || card.name !== 'nanman';
    case 'tiesuo':
      return alive.length > 0;
    case 'jiu':
      return true;
    default:
      if (def.type === 'equip') return true;
      return true;
  }
},

async doJianjiLoop(player) {
  const MAX_ROUNDS = 8;      // 防止死循环
  for (let round = 0; round < MAX_ROUNDS; round++) {
    const usable = this.centerZone.filter((c) => this.cardUsableNow(player, c));
    const hand = player.getCards('h');
    if (!usable.length || !hand.length) return;

    // ---- ① 选一张手牌（颜色需未被用过）----
    const used = player.flags.jianjiUsed || {};
    const pickA = await this.io.chooseCards(player, {
      prompt: `剪辑高手：选择一张手牌置入弃牌堆`
        + `（本回合已用颜色：${Object.keys(used).map((c) => (c === 'red' ? '红' : '黑')).join('、') || '无'}）`,
      position: 'h', min: 1, max: 1, cancelable: true,
      filter: (c) => !used[c.color],
    });
    if (!pickA || !pickA.length) return;
    const A = pickA[0];

    // ---- ② 选中央区一张可用的牌 B ----
    const pickB = await this.io.chooseCards(player, {
      prompt: '剪辑高手：选择中央区一张牌，视为你使用之',
      position: 'center', min: 1, max: 1, cancelable: true,
      cardList: usable,
    });
    if (!pickB || !pickB.length) {
      // 取消第二段：不弃牌，整个流程结束
      return;
    }
    const B = pickB[0];

    // 记颜色用量
    used[A.color] = true;
    player.addFlag('jianjiUsed', used);

    // ---- ③ 把 A 置入弃牌堆（不经过中央区）----
    await player.loseCards([A]);
    this.toDiscard([A], { direct: true });
    this.log(`${player.name} 发动【剪辑高手】，将 ${A.text} 置入弃牌堆，`
      + `视为使用中央区的 ${B.fullname}`);

    // ---- ④ 视为使用 B（等价于「用 A 转化为 B 使用」→ 触发二技能）----
    //    B 本身仍留在中央区（它是被「参照」的牌，不是消耗品）
    const ghost = this.makeVirtualCard(B);
    ghost.sourceCards = [A];
    ghost.jianjiFrom = true;
    await this.useCard(player, ghost, await this.pickTargetsForVirtual(player, ghost));

    // ---- ⑤ 类型相同 → 重复；花色相同 → 摸一张 ----
    const sameType = this.cardTypeOf(A) === this.cardTypeOf(B);
    const sameSuit = A.suit === B.suit;
    if (sameSuit) {
      await player.draw(1);
      this.log(`【剪辑高手】${A.text} 与 ${B.fullname} 花色相同（${A.suitLabel}），摸一张牌`);
    }
    if (!sameType) {
      this.log(`【剪辑高手】${A.text} 与 ${B.fullname} 类型不同，流程结束`);
      return;
    }
    this.log(`【剪辑高手】类型相同，可继续发动`);
  }
},

cardTypeOf(card) {
  const def = CARDS[card.name] || {};
  if (def.type === 'equip') return `equip:${def.subtype || ''}`;
  if (def.delayed) return 'delay';
  return def.type || '';
},

makeVirtualCard(base) {
  const def = CARDS[base.name] || {};
  return {
    name: base.name,
    fullname: base.fullname || def.fullname || base.name,
    suit: base.suit,
    number: base.number,
    color: base.color,
    type: def.type,
    subtype: def.subtype,
    nature: base.nature || def.nature,
    zone: 'center',
    text: base.text,
    isVirtual: true,
  };
},

async pickTargetsForVirtual(player, card) {
  const def = CARDS[card.name] || {};
  const fixed = this.defaultTargetsFor(player, card);
  if (fixed) return fixed;
  if (def.type === 'equip') return [];
  const cands = this.players.filter((p) => p.alive
    && !(def.notSelf && p === player)
    && this.canBeTargeted(p, card) && this.canTargetByLimits(player, p, card));
  if (!cands.length) return [];
  return this.io.chooseTargets(player, {
    prompt: `【${card.fullname}】请选择目标`,
    candidates: cands, min: 1, max: 1,
  });
},

async equipCard(player, card) {
  const sub = CARDS[card.name].subtype;

  // 装备区被废除时无法装备（预留机制）
  if (player.isEquipSlotDisabled(sub)) {
    const slotName = (EQUIP_SLOT_MAP_SHORT[sub] || sub);
    this.log(`${player.name} 的${slotName}区已被废除，无法装备【${card.fullname}】`);
    // 牌退回手牌，不弃置
    if (!player.hand.includes(card)) {
      card.zone = 'hand';
      card.owner = player;
      player.hand.push(card);
    }
    this.emit();
    return false;
  }

  // 只有【同槽位的旧装备】才进弃牌堆（顶掉规则）
  // 参考无名杀 replaceEquip()：仅替换相同 subtype 的装备。
  const old = player.equips[sub];
  if (old && old !== card) {
    await player.loseCards([old]);
    player.equips[sub] = null;
    this.toDiscard(old);
    old.zone = 'discard';
    // 【白银狮子】/【天机图】离开装备区时的效果
    await this.checkBaiyinLose(player, old);
    await this.checkTianjiLose(player, old);
  }

  // 从「其他区域」移除这张牌，避免同一张牌同时存在于多处。
  // 注意：不能清掉 player.equips[sub] 本身，那是我们马上要写入的槽位。
  const hi = player.hand.indexOf(card);
  if (hi >= 0) player.hand.splice(hi, 1);
  for (const p of this.players) {
    const j = p.judges.indexOf(card);
    if (j >= 0) p.judges.splice(j, 1);
    // 从任何人的装备区移除（顺手牵羊等来源），但不碰当前要装备的槽位
    for (const k of Object.keys(p.equips)) {
      if (p.equips[k] === card && !(p === player && k === sub)) p.equips[k] = null;
    }
  }

  // 最后确认这张牌不在任何弃牌/中央区（装备牌不应出现在那里）
  this._removeFromPiles(card);

  player.equips[sub] = card;
  card.zone = 'equip';
  card.owner = player;
  this.log(`${player.name} 装备了【${card.fullname}】`);
  this.emit();

  /*
   * 【天机图】进入装备区：必须弃置一张「其他」牌。
   * 若除了天机图之外没有别的牌，则可以弃置 0 张。
   */
  if (card.name === 'tianjitu') {
    const others = player.getCards('he').filter((c) => c !== card);
    if (others.length) {
      const picked = await player.chooseCards({
        prompt: '【天机图】：弃置一张其他牌',
        position: 'he', min: 1, max: 1, cancelable: false,
        filter: (c) => c !== card,
      });
      if (picked && picked.length) await player.discard(picked);
    } else {
      this.log(`${player.name} 除【天机图】外没有其他牌，无需弃置`);
    }
  }
  return true;
},

_removeFromPiles(card) {
  const di = this.discardPile.indexOf(card);
  if (di >= 0) this.discardPile.splice(di, 1);
  const ci = this.centerZone.indexOf(card);
  if (ci >= 0) this.centerZone.splice(ci, 1);
},

/* ============================================================
 * 【无懈可击】/【闪闪】询问
 * ------------------------------------------------------------
 * 【闪闪】可以当【无懈可击】打出，且抵消成功后**获得被抵消的牌**。
 * ============================================================ */
async checkWuxie(source, card, targets) {
  let nullified = false;
  let guard = 0;
  // 记录本张牌上打出的所有无懈，供后续技能查询
  const wuxieChain = [];

  while (guard++ < 10) {
    let someone = false;
    for (const p of this.players) {
      if (!p.alive) continue;
      const wuxies = p.getCards('he', (c) => c.name === 'wuxie' || c.name === 'shanshan');
      if (!wuxies.length) continue;

      // 目标描述：无懈的目标是「牌」而非角色
      const targetCard = wuxieChain.length ? wuxieChain[wuxieChain.length - 1] : card;

      let want = false;
      if (p.isHuman) {
        want = await this.io.askWuxie(p, source, targetCard, nullified);
      } else {
        want = this.ai.shouldWuxie(p, source, targetCard, nullified);
      }
      if (!want) continue;

      let picked;
      if (p.isHuman) {
        picked = (await this.io.chooseCards(p, {
          prompt: `打出【无懈可击】抵消【${targetCard.fullname}】`,
          position: 'he', min: 1, max: 1,
          filter: (c) => c.name === 'wuxie' || c.name === 'shanshan', cancelable: true,
        })) || [];
      } else {
        // 优先用真【无懈可击】，【闪闪】留作底牌
        picked = [wuxies.slice().sort((a, b) => (a.name === 'wuxie' ? -1 : 1) - (b.name === 'wuxie' ? -1 : 1))[0]];
      }
      if (!picked.length) continue;

      await p.loseCards(picked);
      this.toCenter(picked);

      const wuxieCard = picked[0];
      wuxieChain.push(wuxieCard);
      const before = nullified;
      nullified = !nullified;
      // 【闪闪】：抵消成功后获得被抵消的牌
      if (!before && nullified && wuxieCard.name === 'shanshan') {
        card._ssTaker = p;
        this.log(`【闪闪】令 ${p.name} 获得了 ${targetCard.text}`);
      }

      // 归类为「打出」，并记录其目标为「牌」
      await this.emitCardResponded(p, wuxieCard, 'wuxie');
      this.useEvents[this.useEvents.length - 1].targetCard = targetCard;

      this.log(`${p.name} 打出【无懈可击】${nullified ? '抵消' : '反抵消'}`
        + `【${targetCard.fullname}】`);
      this.emit();
      someone = true;
      break;
    }
    if (!someone) break;
  }
  card.wuxieChain = wuxieChain;
  return nullified;
}
};
