/**
 * 核心引擎 · Game 方法集 · 出牌与装备
 * ------------------------------------------------------------------
 * 由 src/engine.js 拆分而来。useCard 主流程、虚拟牌、可用性判定、无懈可击、装备的穿上与替换。
 * 本文件导出普通对象字面量，方法会被混入 Game.prototype，内部 this 即 Game 实例。
 */

import { CARDS } from '../cards.js';
import { noteSuitUsed } from '../skills.js';
import { isIgnited, isDetached } from '../mechanics.js';
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
  await this.checkSkills('cardUsedOrResponded', ev);
  // 「成为牌的目标」按每个目标分别触发
  for (const t of (targets || [])) {
    await this.checkSkills('cardTargeted', { player, card, target: t, targets });
  }
  return ev;
},

async emitCardResponded(player, card, reason = '') {
  const ev = { player, card, reason, kind: 'respond' };
  this.useEvents.push({ ...ev, turn: this.turnCount });
  await this.checkSkills('cardResponded', ev);
  await this.checkSkills('cardUsedOrResponded', ev);
  return ev;
},

async useCard(player, card, targets) {
  const def = CARDS[card.name];
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

  // ⑤ 朱雀羽扇：可将普通【杀】当火【杀】使用
  //    由调用方通过 card.useFire = true 表明意图（UI 询问 / AI 决策）。
  //    这里补全属性，使后续伤害结算按火焰处理。
  if (card.name === 'sha' && !card.nature && this.canUseAsFireSha(player)) {
    const wantFire = card.useFire === true
      || (card.useFire === undefined && this.ai && this.ai.wantFireSha
        && this.ai.wantFireSha(player, targets));
    if (wantFire) {
      card.nature = 'fire';
      this.log(`${player.name} 发动【朱雀羽扇】，此【杀】视为火【杀】`);
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
    // 装备区被废除时不消耗这张牌，退回手牌
    if (player.isEquipSlotDisabled(def.subtype)) {
      this.log(`${player.name} 的${EQUIP_SLOT_MAP_SHORT[def.subtype] || def.subtype}区已被废除，【${card.fullname}】无法装备`);
      if (!player.hand.includes(card)) {
        card.zone = 'hand';
        card.owner = player;
        player.hand.push(card);
      }
      this.emit();
      return;
    }
    await this.emitCardUsed(player, card, targets);
    await this.equipCard(player, card);
    return;
  }

  // 移除实体牌，并置入中央区（本回合处理区）
  // 中央区的牌同时算作弃牌堆的一部分，回合结束后归档。
  if (card.sourceCards && card.sourceCards.length) {
    await player.loseCards(card.sourceCards);
    this.toCenter(card.sourceCards);
  } else if (player.getCards('he').includes(card)) {
    await player.loseCards([card]);
    this.toCenter([card]);
  }

  // 记录出杀次数
  if (card.name === 'sha') player.addFlag('usedShaThisTurn', (player.flags.usedShaThisTurn || 0) + 1);

  await this.emitCardUsed(player, card, targets);
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
    default:
      if (def.type === 'equip') { await this.equipCard(player, card); return; }
      break;
  }

  this.toDiscard(card.sourceCards && card.sourceCards.length ? card.sourceCards : [card]);
  this.emit();

  // ⑩ 使用牌后（结算完毕）——【同步索敌攻击】在此检查全场变化
  await this.emitCardUsedAfter(player, card, targets);
},

async emitCardUsedAfter(player, card, targets = []) {
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
  const alive = this.players.filter((p) => p.alive);
  const others = alive.filter((p) => p !== player);

  switch (card.name) {
    case 'sha':
      // 需要有攻击范围内的目标（或本回合无距离限制）
      return others.some((p) => this.cardNoDistance(player, card)
        || player.inAttackRange(p));
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
  if (def.type === 'equip') return [];
  // 无目标类（桃/酒/无中生有等）
  const selfOnly = ['tao', 'jiu', 'wuzhong', 'wugu', 'taoyuan', 'shandian'];
  if (selfOnly.includes(card.name)) return [player];
  const cands = this.players.filter((p) => p.alive && p !== player
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
  return true;
},

_removeFromPiles(card) {
  const di = this.discardPile.indexOf(card);
  if (di >= 0) this.discardPile.splice(di, 1);
  const ci = this.centerZone.indexOf(card);
  if (ci >= 0) this.centerZone.splice(ci, 1);
},

async checkWuxie(source, card, targets) {
  let nullified = false;
  let guard = 0;
  // 记录本张牌上打出的所有无懈，供后续技能查询
  const wuxieChain = [];

  while (guard++ < 10) {
    let someone = false;
    for (const p of this.players) {
      if (!p.alive) continue;
      const wuxies = p.getCards('he', (c) => c.name === 'wuxie');
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
          filter: (c) => c.name === 'wuxie', cancelable: true,
        })) || [];
      } else {
        picked = [wuxies[0]];
      }
      if (!picked.length) continue;

      await p.loseCards(picked);
      this.toCenter(picked);

      const wuxieCard = picked[0];
      wuxieChain.push(wuxieCard);
      nullified = !nullified;

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
