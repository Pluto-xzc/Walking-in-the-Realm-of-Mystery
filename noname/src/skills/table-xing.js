/**
 * 星际开拓 · 娜塔莎
 * ====================================================================
 * 【爱，救护与抉择】
 *   每回合开始时，当前回合角色可展示并交给娜塔莎任意张手牌；
 *   若如此做，其本回合使用的前三张牌：
 *     · 与交出的牌**同颜色** → 无次数限制（【杀】【酒】的次数限制解除）
 *     · 与交出的牌**不同花色** → 结算后，其与娜塔莎各摸一张
 *                              （当前回合角色就是娜塔莎时只摸一张）
 *
 * 【仁慈的背面】
 *   回合技。你受到伤害后，可观看牌堆顶的一张牌，然后可将一张手牌
 *   当作那张牌不受距离、次数限制的使用；
 *     · 若你因此未造成伤害 → 摸两张牌并弃置一张牌
 *     · 未使用牌 → 回复 1 点体力
 *
 * 需求方的两点澄清：
 *   ① 「同颜色」以交出的牌为准（交♡♤ → 红、黑都算同色）；
 *      「不同花色」即他不曾交出的那些花色（交♡♤ → ♦♧ 算不同花色）。
 *   ② 「前三张」按顺序数，不论是否触发效果，用满三张后不再生效。
 */

import { Card } from '../engine/card.js';
import { CARDS } from '../cards.js';
import { beginPreach, preachState, preachDesc } from '../mechanics/preach.js';

export const NATASHA_SKILL_IDS = ['aijihuyujueze', 'rencidibeimian'];

const SUIT_CN = { spade: '♠', heart: '♡', club: '♧', diamond: '♦' };

/** 找场上的娜塔莎（技能拥有者） */
function findOwner(game, owner) {
  if (owner && owner.alive) return owner;
  return game.players.find((p) => p.alive && p.skills.includes('aijihuyujueze')) || null;
}

/** 「未造成伤害」的兑现：摸两张，然后弃置一张 */
async function noDamage(game, player) {
  await player.draw(2);
  const pool = player.getCards('h');
  if (pool.length) {
    const dis = await player.chooseCards({
      prompt: '【仁慈的背面】：未造成伤害，弃置一张牌',
      position: 'h', min: 1, max: 1, cancelable: false,
    });
    if (dis && dis.length) await player.discard(dis);
  }
  game.log(`【仁慈的背面】${player.name} 未造成伤害，摸两张并弃置一张`);
}

export default {

/* ==================================================================
 * 一技能：爱，救护与抉择
 * ================================================================ */
aijihuyujueze: {
  id: 'aijihuyujueze',
  name: '爱，救护与抉择',
  desc: '每回合开始时，当前回合角色可展示并交给你任意张手牌，若如此做，'
    + '其本回合使用的前三张：同颜色的牌无次数限制；不同花色的牌在结算后，'
    + '你与其各摸一张牌（当前回合角色为你则仅摸一张）。',
  type: 'trigger',
  trigger: 'turnStart',
  scope: 'global',
  filter(ctx) {
    const { game, player, event } = ctx;
    const donor = event && event.player;
    if (!donor || !donor.alive) return false;
    const owner = findOwner(game, player);
    if (!owner) return false;
    // 已经交过（本回合）就不重复问
    if (preachState(game, donor)) return false;
    return donor.countCards('h') > 0;
  },
  async content(ctx) {
    const { game, player, event } = ctx;
    const donor = event.player;
    const owner = findOwner(game, player);
    if (!owner) return;

    const picked = await donor.chooseCards({
      prompt: `【爱，救护与抉择】：可展示并交给 ${owner.name} 任意张手牌`
        + '（不交则跳过）',
      position: 'h', min: 0, max: Math.max(1, donor.countCards('h')),
      cancelable: true,
    });
    if (!picked || !picked.length) {
      game.log(`【爱，救护与抉择】${donor.name} 没有交出牌`);
      return;
    }

    // 展示（revealCards(cards, by)）
    game.revealCards(picked, donor);
    game.log(`【爱，救护与抉择】${donor.name} 展示了 `
      + `${picked.map((c) => c.fullname || c.name).join('、')}（`
      + `${picked.map((c) => SUIT_CN[c.suit] || c.suit).join('')}）并交给 ${owner.name}`);

    await donor.loseCards(picked, 'h');
    if (owner !== donor) await owner.gain(picked);
    else for (const c of picked) if (!donor.hand.includes(c)) donor.hand.push(c);

    beginPreach(game, donor, owner, picked);
    game.log(`【爱，救护与抉择】${donor.name} 本回合的前三张牌生效：`
      + `${preachDesc(preachState(game, donor))}`);
  },
},

/* ==================================================================
 * 二技能：仁慈的背面
 * ================================================================ */
rencidibeimian: {
  id: 'rencidibeimian',
  name: '仁慈的背面',
  desc: '回合技。你受到伤害后，可观看牌堆顶的一张牌，然后可将一张手牌'
    + '当作那张牌不受距离、次数限制的使用之；若你因此未造成伤害（未使用牌也算），'
    + '则你摸两张牌并弃置一张牌；未使用牌，则你回复 1 点体力。',
  type: 'trigger',
  trigger: 'damageEnd',
  usable: 1,
  filter(ctx) {
    const p = ctx.player;
    return !!(p && p.alive);
  },
  async content(ctx) {
    const { game, player } = ctx;

    const top = game.deck[game.deck.length - 1];
    if (!top) return;
    const topName = top.fullname || (CARDS[top.name] && CARDS[top.name].fullname) || top.name;
    game.log(`【仁慈的背面】${player.name} 观看了牌堆顶的 ${top.text || topName}`);

    const hand = player.getCards('h');
    let picked = null;
    if (hand.length) {
      picked = await player.chooseCards({
        prompt: `【仁慈的背面】：可将一张手牌当作【${topName}】使用（不选则回复 1 点体力）`,
        position: 'h', min: 1, max: 1, cancelable: true,
      });
    }

    if (!picked || !picked.length) {
      /* 未使用牌 → 需求方 m09431 裁定：「没用也算作没造成伤害」，
       * 所以「摸两张弃一张」与「回复 1 点体力」两条都兑现。 */
      await noDamage(game, player);
      await player.recover(1);
      game.log(`【仁慈的背面】${player.name} 没有使用牌，视为未造成伤害，`
        + '摸两张弃一张，并回复 1 点体力');
      return;
    }

    /* 把这张手牌当作牌堆顶那张牌使用（复制花色点数与牌名） */
    const source = picked[0];
    const ghost = new Card(top.suit, top.number, top.name);
    ghost.fullname = topName;
    if (top.nature) ghost.nature = top.nature;
    if (top.cisha) ghost.cisha = top.cisha;
    ghost.noDistance = true;              // 不受距离限制
    ghost.shaNoLimit = true;              // 不受次数限制
    ghost.sourceCards = [source];

    await player.loseCards([source], 'h');

    /* 目标：交给引擎按牌面规则挑（群体牌自动全场，单体牌问玩家） */
    const targets = await game.pickTargetsForVirtual(player, ghost);
    if (!targets || !targets.length) {
      // 没有合法目标 → 视为未使用牌（同样算「未造成伤害」）
      if (!player.hand.includes(source)) player.hand.push(source);
      source.zone = 'h';
      await noDamage(game, player);
      await player.recover(1);
      game.log(`【仁慈的背面】${player.name} 没有合法目标，视为未使用牌，`
        + '摸两张弃一张并回复 1 点体力');
      return;
    }

    const before = game.damageSerial || 0;
    await game.useCard(player, ghost, targets);
    const dealt = (game.damageSerial || 0) > before;

    if (!dealt) await noDamage(game, player);
  },
},

};
