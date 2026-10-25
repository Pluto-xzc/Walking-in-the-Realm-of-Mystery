/**
 * 核心引擎 · Game 方法集 · 牌与技能结算
 * ------------------------------------------------------------------
 * 由 src/engine.js 拆分而来。每张牌的 resolveXxx，以及技能发动 useSkill。
 * 本文件导出普通对象字面量，方法会被混入 Game.prototype，内部 this 即 Game 实例。
 */

import { CARDS, SUITS, EQUIP_SLOTS } from '../cards.js';
import { SKILLS } from '../skills.js';
import { markAngyangUsed, isAngyangUsed, applyEnchantMod, isLinkedCard, cascadeGainLinked, cannotRespond, tickZhanfaOnTao } from '../mechanics.js';
import { ZONE, EQUIP_SLOT_MAP_SHORT } from './zones.js';
import { Card } from './card.js';

export default {
async resolveSha(player, card, targets) {
  for (const target of targets) {
    if (!target.alive) continue;
    await this.checkSkills('targetConfirm', { player, card, target, source: player, noShan: false });

    // 流离等转移
    const redir = await this.checkRedirect(player, card, target);
    const realTarget = redir || target;
    if (!realTarget.alive) continue;

    const needShan = this.needShanCount(player, card);
    let dodged = false;
    for (let i = 0; i < needShan; i++) {
      const r = await this.askShan(realTarget, player, card);
      if (!r) break;
      if (i === needShan - 1) dodged = true;
    }

    if (dodged) {
      this.log(`${realTarget.name} 打出【闪】抵消了【杀】`);
      /*
       * 「被闪后仍可造成伤害」类技能（装备技优先）
       * ----------------------------------------------------------------
       * 【贯石斧】：被【闪】抵消时，可弃两张牌令此【杀】依然造成伤害。
       * 【青龙偃月刀】：被【闪】抵消时，可再使用一张【杀】。
       *
       * 这些技能挂在 shaDodged 时机，通过 ev.forceHit 表达
       *「虽然被闪，但依然命中」。
       *
       * ⚠️ 历史 bug：这里原先无条件 `continue`，**完全没有读取 forceHit**，
       *    导致贯石斧弃了两张牌却依然没造成伤害（玩家实测反馈）。
       *    现在必须先把 shaDodged 的结算收尾，再判断 forceHit。
       */
      const dodgedEv = { player, card, target: realTarget, source: player, forceHit: false };
      await this.checkSkills('shaDodged', dodgedEv);

      if (dodgedEv.forceHit && realTarget.alive) {
        // 技能令此【杀】依然命中 → 正常造成伤害
        this.log(`【${card.fullname}】依然对 ${realTarget.name} 造成伤害`);
        await realTarget.damage(this.shaDamage(player), player, 'sha', card);
        this.clearJiu(player);
        this.toDiscard(card.sourceCards && card.sourceCards.length ? card.sourceCards : [card]);
        continue;
      }

      this.toDiscard(card.sourceCards && card.sourceCards.length ? card.sourceCards : [card]);
      // 这张【杀】已结算完（被闪避），酒意不再保留
      // 参考无名杀 jiu2 挂在 useCardAfter 上：此牌结算完就清
      this.clearJiu(player);
      continue;
    }

    await realTarget.damage(this.shaDamage(player), player, 'sha', card);
    // 造成伤害时若酒意已用掉，上面 doDamage 已清；若因免疫/防止等原因
    // 没走到伤害结算，这里兜底清除，避免酒意残留到后续的【杀】
    this.clearJiu(player);
  }
},

needShanCount(player, card) {
  let n = 1;
  for (const sid of player.skills) {
    const sk = SKILLS[sid];
    if (sk && sk.mod && sk.mod.shanRequired) n = sk.mod.shanRequired(n);
  }
  // 【附魔】：牌上附魔的技能也能改这个数值
  if (card) {
    n = applyEnchantMod(card, 'shanRequired', n, SKILLS);
  }
  return n;
},

shaDamage(player) {
  let n = 1;
  return n;
},

async askShan(target, source, card) {
  /*
   * 【跳过牌的询问】：对其使用牌其**不可响应**
   * ----------------------------------------------------------------
   * 需求方给定：「当角色 A 被跳过了『牌的询问』，则对其使用牌
   * 其不可响应」。因此这里直接判定为「没有闪」，不发起任何询问。
   */
  if (cannotRespond(target)) {
    this.log(`${target.name} 被跳过了牌的询问，无法响应【${card ? card.fullname : '杀'}】`);
    return false;
  }
  // 八卦阵
  const bagua = target.equips.equip2 && CARDS[target.equips.equip2.name].equipSkill === 'bagua_skill';
  if (bagua) {
    const wantBagua = target.isHuman
      ? await this.io.askBagua(target)
      : this.ai.shouldUseBagua(target);
    if (wantBagua) {
      const j = await target.judge('bagua');
      if (j.color === 'red') {
        this.log(`${target.name} 触发【八卦阵】，判定为红色，视为打出【闪】`);
        return true;
      }
    }
  }

  // 护驾（主公技）：由其他魏势力角色替你打出【闪】
  if (target.hasSkill('hujia') && target.isZhu) {
    const hasWei = this.players.some((p) => p !== target && p.alive
      && p.group === 'wei' && p.canUseAsShan());
    if (hasWei) {
      const ctx = { player: target, game: this, event: { card, source }, skill: SKILLS.hujia };
      const use = await this.io.askSkill(target, SKILLS.hujia, ctx);
      if (use) {
        const ok = await SKILLS.hujia.content(ctx);
        if (ok) {
          const helper = ctx.event.hujiaFrom;
          const hcard = ctx.event.hujiaCard;
          this.log(`${target.name} 发动【护驾】，${helper ? helper.name : '魏势力角色'}`
            + ` 代为打出【闪】${hcard ? `（${hcard.text}）` : ''}`);
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
    this.toCenter(picked);
    await this.emitCardResponded(target, picked[0], 'shan');
    this.log(`${target.name} 打出【闪】${asQingguo ? '（倾国）' : ''}`);
    return true;
  }
  if (this.ai.shouldRespondShan(target, source, card)) {
    const c = candidates[0];
    await target.loseCards([c]);
    this.toCenter(c);
    await this.emitCardResponded(target, c, 'shan');
    this.log(`${target.name} 打出【闪】${asQingguo ? '（倾国）' : ''}`);
    return true;
  }
  return false;
},

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
},

async resolveTao(player, targets) {
  const t = (targets && targets[0]) || player;
  await t.recover(1);
  /*
   * 【阵法技】默认时机②：**自己用【桃】回复体力**时术法 +1。
   * 注意要求是「自己用【桃】」，因此这里对**使用者**结算
   *（且必须确实是【桃】，急救之类的红色牌不算 —— 由调用方区分）。
   */
  tickZhanfaOnTao(player);
},

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
},

async askSha(player, opponent, reason = 'juedou') {
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

  // 提示语随来源变化，避免【南蛮入侵】错显为【决斗】
  const REASON_LABEL = {
    juedou: '【决斗】',
    nanman: '【南蛮入侵】',
    jiedao: '【借刀杀人】',
    sha: '响应【杀】',
  };
  const label = REASON_LABEL[reason] || '';

  if (player.isHuman) {
    const picked = await this.io.chooseCards(player, {
      prompt: `${label}：打出一张【杀】${viaSkill ? `（${SKILLS[viaSkill].name}）` : ''}`,
      position: 'he', min: 1, max: 1,
      filter: viaSkill === 'wusheng' ? (c) => c.color === 'red'
        : viaSkill === 'longdan' ? (c) => c.name === 'shan'
          : (c) => c.name === 'sha',
      cancelable: true,
    });
    if (!picked || !picked.length) return false;
    await player.loseCards(picked);
    this.toCenter(picked);
    await this.emitCardResponded(player, picked[0], reason);
    this.log(`${player.name} 打出【杀】${viaSkill ? `（${SKILLS[viaSkill].name}）` : ''}`);
    return true;
  }
  if (this.ai.shouldRespondSha(player, opponent)) {
    const c = cards[0];
    await player.loseCards([c]);
    this.toCenter(c);
    await this.emitCardResponded(player, c, reason);
    this.log(`${player.name} 打出【杀】${viaSkill ? `（${SKILLS[viaSkill].name}）` : ''}`);
    return true;
  }
  return false;
},

async resolveGuohe(player, targets) {
  const target = targets[0];
  if (!target || !target.alive) return;
  const cards = target.getCards('hej');
  if (!cards.length) return;
  const picked = await player.chooseCardFromPlayer(target, 'hej', `过河拆桥：弃置 ${target.name} 的一张牌`);
  if (picked && picked.length) {
    await target.loseCards(picked);
    // 拆牌是「弃置」不是「使用」，不进中央区
    this.toDiscard(picked, { direct: true });
    this.log(`${player.name} 弃置了 ${target.name} 的 ${picked[0].text}`);
  }
},

async resolveShunshou(player, targets) {
  const target = targets[0];
  if (!target || !target.alive) return;
  const cards = target.getCards('hej');
  if (!cards.length) return;
  const picked = await player.chooseCardFromPlayer(target, 'hej', `顺手牵羊：获得 ${target.name} 的一张牌`);
  if (picked && picked.length) {
    const c = picked[0];
    /*
     * 【横置牌】连带获得
     * ----------------------------------------------------------------
     * 需求方给定：横置的牌被其他角色获得时，
     * **一并获得**原持有者手牌中其余的横置牌。
     * 必须在 loseCards/gain 之前取出连带部分。
     */
    const extra = isLinkedCard(c) ? await cascadeGainLinked(player, target, c) : [];
    await target.loseCards(picked);
    // 按无名杀规则：获得的牌一律进入**手牌**，即使是装备牌也不自动装备。
    // 参考 noname card/standard.js shunshou → player.gainPlayerCard() → gain()
    await player.gain(picked.concat(extra), 'gain2');
    if (c.type === 'equip') {
      this.log(`${player.name} 获得了 ${target.name} 的【${c.fullname}】（进入手牌）`);
    } else {
      this.log(`${player.name} 获得了 ${target.name} 的 ${c.text}`);
    }
  }
},

async resolveWugu(player) {
  const alive = this.players.filter((p) => p.alive);
  const pool = [];
  for (let i = 0; i < alive.length; i++) {
    const c = this.takeFromDeckTop(1)[0];
    if (c) pool.push(c);
  }
  if (!pool.length) return;
  this.log(`【五谷丰登】亮出 ${pool.map((c) => c.text).join('、')}`);

  // ② 从使用者开始，按座位顺序
  const order = this.orderFrom(player, alive);

  const taken = new Set();
  for (const p of order) {
    if (!p.alive) continue;
    const avail = pool.filter((c) => !taken.has(c));
    if (!avail.length) break;

    let pick;
    if (avail.length === 1) {
      // 只剩一张 → 直接获得，不询问（对应无名杀 buttons.length > 1 判断）
      pick = avail[0];
    } else if (p.isHuman) {
      const picked = await this.io.chooseCards(p, {
        prompt: '五谷丰登：选择一张牌',
        position: 'list', min: 1, max: 1,
        cardList: avail, cancelable: false,
      });
      pick = (picked && picked[0]) || avail[0];
    } else {
      pick = this.ai.pickBestCard(avail) || avail[0];
    }

    taken.add(pick);
    await p.gain([pick], 'gain2');
    this.log(`${p.name} 从【五谷丰登】中取走了 ${pick.text}`);
  }

  // ④ 剩余的牌进弃牌堆
  for (const c of pool) {
    if (!taken.has(c)) { c.zone = ZONE.DISCARD; this.toDiscard(c); }
  }
  this.emit();
},

orderFrom(start, list = null) {
  const all = (list || this.players).filter((p) => p.alive);
  if (!all.length) return [];
  const sorted = all.slice().sort((a, b) => a.seat - b.seat);
  const i = sorted.indexOf(start);
  if (i < 0) return sorted;
  return [...sorted.slice(i), ...sorted.slice(0, i)];
},

async resolveTaoyuan(player) {
  for (const p of this.players.filter((x) => x.alive)) {
    if (p.isDamaged()) await p.recover(1);
  }
},

async resolveAoe(player, card, respondName) {
  const needSha = respondName === 'sha';
  for (const target of this.players.filter((p) => p.alive && p !== player)) {
    if (!target.alive) continue;
    /*
     * 目标限制（如折桠【星火尽染寒】）
     * ----------------------------------------------------------------
     * 群体锦囊不再是「全部其他角色」，而是「**符合条件的**全部其他角色」。
     * 不符合条件的角色直接跳过，不参与响应、也不受伤。
     */
    if (!this.canTargetByLimits(player, target, card)) {
      this.log(`${target.name} 不符合本回合的目标限制，不受【${card.fullname}】影响`);
      continue;
    }
    // 免疫（藤甲）
    if (this.isImmune(target, card)) {
      this.log(`${target.name} 免疫了【${card.fullname}】`);
      continue;
    }
    let has = false;
    if (needSha) {
      has = await this.askSha(target, player, card.name);
    } else {
      has = await this.askShan(target, player, card);
    }
    if (!has) {
      await target.damage(1, player, card.name, card);
    }
  }
},

async resolveJiu(player) {
  if (player.hp <= 0) {
    // 濒死自救：只回血，**不产生酒意**
    player.hp += 1;
    this.log(`${player.name} 使用【酒】回复 1 点体力（不产生酒意）`);
    this.emit();
    return;
  }
  player.storage.jiu = (player.storage.jiu || 0) + 1;
  player.storage.jiuTurn = this.turnCount;   // 记录生效回合
  player.addFlag('jiuUsed', (player.flags.jiuUsed || 0) + 1);
  this.log(`${player.name} 使用【酒】，本回合下一张【杀】伤害 +1`);
  this.emit();
},

jiuActive(player) {
  if (!player || !(player.storage.jiu > 0)) return false;
  if (player.storage.jiuTurn !== this.turnCount) return false;
  return true;
},

clearJiu(player, force = false) {
  if (!player) return;
  if (!(player.storage.jiu > 0)) return;
  // 扩展接口：带 jiuSustain 的角色，酒意不因「用掉」而消失
  if (!force && player.hasFlag && player.hasFlag('jiuSustain')) return;
  player.storage.jiu = 0;
  delete player.storage.jiuTurn;
},

async resolveHuogong(player, targets) {
  const target = targets && targets[0];
  if (!target || !target.alive) return;
  if (!target.countCards('h')) {
    this.log(`${target.name} 没有手牌，【火攻】无效`);
    return;
  }

  // ① 目标展示一张手牌
  let shown;
  const hs = target.getCards('h');
  if (hs.length === 1) {
    // 只有一张 → 直接展示，不询问（对应无名杀 countCards === 1 分支）
    shown = hs[0];
  } else if (target.isHuman) {
    const picked = await this.io.chooseCards(target, {
      prompt: '【火攻】：请选择一张手牌展示',
      position: 'h', min: 1, max: 1, cancelable: false,
    });
    shown = (picked && picked[0]) || hs[0];
  } else {
    // AI 目标：随机展示一张（同无名杀的 set('ai') 逻辑）
    shown = this.ai.pickHuogongShow(target) || hs[0];
  }
  await this.showCards([shown], target, 1200);
  this.log(`${target.name} 因【火攻】展示了 ${shown.text}`);

  // ② 使用者弃一张同花色手牌（可选）
  const suitName = (SUITS[shown.suit] && SUITS[shown.suit].name) || shown.suit;
  const sameSuit = player.getCards('h', (c) => c.suit === shown.suit);
  if (!sameSuit.length) {
    this.log(`${player.name} 没有${suitName}手牌，【火攻】未造成伤害`);
    // 未受伤 → 加「火攻2」标记
    this._markHuogongFail(target);
    return;
  }

  let discard = null;
  if (player.isHuman) {
    const picked = await this.io.chooseCards(player, {
      prompt: `【火攻】：可弃置一张${suitName}手牌，对其造成 1 点火焰伤害`,
      position: 'h', min: 1, max: 1,
      filter: (c) => c.suit === shown.suit,
      cancelable: true,
    });
    discard = (picked && picked[0]) || null;
  } else {
    discard = this.ai.shouldHuogongDiscard(player, target) ? sameSuit[0] : null;
  }

  if (!discard) {
    this.log(`${player.name} 放弃弃牌，【火攻】未造成伤害`);
    this._markHuogongFail(target);
    return;
  }

  // 注意：这里必须用 discard(cards) —— 直接把**已选定的牌**弃置。
  // 不能调 discardCards([card])：那个方法的第一个参数是「数量」，
  // 传数组会再去询问玩家选牌，导致实际没弃掉（历史 bug：
  // 玩家弃了牌但牌还在手上）。
  await player.discard([discard]);
  this.log(`${player.name} 弃置 ${discard.text}，对 ${target.name} 造成火焰伤害`);
  await target.damage(1, player, 'huogong', null, 'fire');
},

_markHuogongFail(target) {
  target.flags.huogong2 = this.turnCount;
  this.emit();
},

async resolveTiesuo(player, targets) {
  const list = (targets && targets.length) ? targets : [player];
  for (const t of list) {
    if (!t || !t.alive) continue;
    t.isChained = !t.isChained;
    this.log(`${t.name} ${t.isChained ? '横置' : '重置'}（铁索连环）`);
  }
  this.emit();
},

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
        this.toDiscard(shas[0]);
        const vc = new Card(shas[0].suit, shas[0].number, 'sha');
        this.log(`${holder.name} 对 ${victim.name} 使用【杀】`);
        await this.resolveSha(holder, vc, [victim]);
      } else has = false;
    }
  }
  if (!has) {
    // 交出武器 —— 按无名杀规则：武器进入**使用者的手牌**，
    // 不会自动装备（原实现误用了 equipCard2，导致直接被装到自己身上）。
    // 参考 noname card/standard.js jiedao: player.gain(cards, target, ...)
    await this.transferEquipToHand(player, weapon, holder);
    this.log(`${holder.name} 未出【杀】，【${weapon.fullname}】交给 ${player.name}`);
  }
},

async transferEquipToHand(receiver, card, from) {
  // 先从原持有者装备区摘除
  for (const p of this.players) {
    for (const k of Object.keys(p.equips)) {
      if (p.equips[k] === card) p.equips[k] = null;
    }
    const ji = p.judges.indexOf(card);
    if (ji >= 0) p.judges.splice(ji, 1);
    const hi = p.hand.indexOf(card);
    if (hi >= 0) p.hand.splice(hi, 1);
  }
  this._removeFromPiles(card);
  // 进入接收者手牌
  card.zone = ZONE.HAND;
  card.owner = receiver;
  // ⚠️ 虚拟牌（如【剪辑高手】视为使用的牌）是普通对象，
  //    没有 Card 类的方法，因此必须判空调用，
  //    否则会抛 "checkRevealLost is not a function"。
  if (typeof card.checkRevealLost === 'function') {
    card.checkRevealLost(receiver);
  }
  receiver.hand.push(card);
  // 更新装备者的武器相关状态（攻击范围会随之失效）
  if (from) from.equips.equip1 = null;
  this.emit();
},

async equipCard2(player, card) {
  const sub = CARDS[card.name].subtype;

  // 装备区被废除时无法装备
  if (player.isEquipSlotDisabled(sub)) {
    this.log(`${player.name} 的${EQUIP_SLOT_MAP_SHORT[sub] || sub}区已被废除，无法装备【${card.fullname}】`);
    await player.gain([card], 'gain2');
    return false;
  }

  const old = player.equips[sub];
  if (old && old !== card) {
    player.equips[sub] = null;
    this.toDiscard(old); old.zone = 'discard';
  }
  // 从原持有者的各区域移除（装备区 / 手牌 / 判定区）
  const SLOT_KEYS = EQUIP_SLOTS.map((s) => s.key);
  for (const p of this.players) {
    for (const k of SLOT_KEYS) {
      if (p.equips[k] === card) p.equips[k] = null;
    }
    const hi = p.hand.indexOf(card);
    if (hi >= 0) p.hand.splice(hi, 1);
    const ji = p.judges.indexOf(card);
    if (ji >= 0) p.judges.splice(ji, 1);
  }
  player.equips[sub] = card;
  card.zone = 'equip';
  card.owner = player;
  this.emit();
  return true;
},

async useSkill(player, skillId) {
  const sk = SKILLS[skillId];
  if (!sk || sk.type !== 'active') return;
  const ctx = { player, game: this, event: {}, skill: sk };
  if (sk.filter && !sk.filter(ctx)) return;

  // 限定技 / 昂扬技：已用状态下不能再次发动，
  // 直到昂扬技被「激昂」条件重置（见 tryResetAngyang）。
  if ((sk.limited || sk.angyang) && isAngyangUsed(player, skillId)) {
    this.log(`【${sk.name}】已发动过，需要满足激昂条件才能重置`);
    return;
  }

  player.flags[`skill_${skillId}`] = (player.flags[`skill_${skillId}`] || 0) + 1;
  this.log(`${player.name} 发动【${sk.name}】`);
  // 昂扬技：发动后标记为已用（可被激昂重置）
  if (sk.angyang) markAngyangUsed(player, skillId);
  await sk.content(ctx);
  this.emit();
}
};
