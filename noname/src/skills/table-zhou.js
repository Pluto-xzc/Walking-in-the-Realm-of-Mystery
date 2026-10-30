/**
 * 技能表：宙埃之世（势力「宙」）
 * ------------------------------------------------------------------
 * 小早川时一 —— 白芒的人生
 *   雾生雪（锁定技）
 *   自囚者
 *
 * 洁净室重写，规则以需求方 m08271 的文字与后续裁定为准。
 */
import { CARDS } from '../cards.js';
import { Card } from '../engine/card.js';
import { POISON, isPoisonNow } from '../mechanics/poison.js';

/** 把一张手牌翻开（明置）——明置后本回合内视为【毒】 */
async function revealOne(game, player, { prompt, filter } = {}) {
  if (!player || !player.alive) return null;
  const pool = player.getCards('h', filter);
  if (!pool.length) return null;
  const picked = await player.chooseCards({
    prompt: prompt || '请选择一张手牌明置',
    position: 'h',
    min: 1,
    max: 1,
    filter,
    cancelable: false,
  });
  const card = (picked && picked[0]) || pool[0];
  if (!card) return null;
  card.revealTurn = game.turnCount;
  await game.revealCards([card], player);
  return card;
}

export default {
  /* ================================================================
   * 雾生雪（锁定技）
   * ================================================================ */
  wushengxue: {
    id: 'wushengxue',
    name: '雾生雪',
    locked: true,
    type: 'trigger',
    trigger: 'cardUsedAfter',
    scope: 'global',
    desc: '锁定技，明置的牌在明置的回合内视为【毒】；有角色每回合首次使用转化的牌'
      + '结算后，其选择一项：①你选择获得之或恢复1点体力后，其视为使用原牌；'
      + '②直到其下次使用转化牌前，每回合开始时明置一张牌。',
    filter: (ctx) => {
      const card = ctx.event && ctx.event.card;
      const actor = ctx.event && ctx.event.player;
      if (!card || !actor || !card._convertFrom) return false;
      // 每名角色每回合首次
      const used = actor.flags && actor.flags.wushengxueTurn;
      return used !== ctx.game.turnCount;
    },
    async content(ctx) {
      const game = ctx.game;
      const owner = ctx.player;          // 技能拥有者（小早川时一）
      const actor = ctx.event.player;    // 使用转化牌的角色
      const card = ctx.event.card;
      const fromName = (card._convertFrom && card._convertFrom.name) || card.name;
      const fromText = (card._convertFrom && card._convertFrom.fullname)
        || (CARDS[fromName] && CARDS[fromName].fullname) || fromName;

      actor.flags.wushengxueTurn = game.turnCount;
      game.log(`【雾生雪】${actor.name} 使用的转化牌结算完毕（原牌【${fromText}】）`);

      const choice = await actor.chooseOption({
        prompt: `【雾生雪】：${owner.name} 的锁定技。请选择一项`,
        options: [
          { key: '1', label: `① ${owner.name} 获得原牌/回复1点体力，然后你视为使用【${fromText}】` },
          { key: '2', label: '② 直到你下次使用转化牌前，每回合开始时明置一张牌' },
        ],
        cancelable: false,
      });

      if (choice === '2') {
        actor.flags.wushengxueReveal = true;
        actor.flags.wushengxueOwner = owner.id;
        game.log(`【雾生雪】${actor.name} 选择②：此后每回合开始时明置一张牌`);
        return;
      }

      // ① 由技能拥有者二选一
      const pay = await owner.chooseOption({
        prompt: `【雾生雪】：选择获得原牌【${fromText}】，或回复 1 点体力`,
        options: [
          { key: 'take', label: `获得原牌【${fromText}】` },
          { key: 'heal', label: '回复 1 点体力' },
        ],
        cancelable: false,
      });

      if (pay === 'heal') {
        await owner.recover(1);
        game.log(`【雾生雪】${owner.name} 选择回复 1 点体力`);
      } else {
        const physical = (card.sourceCards && card.sourceCards[0])
          || (game.discardPile || []).find((c) => c && c.name === fromName)
          || card;
        game.discardPile = (game.discardPile || []).filter((c) => c !== physical);
        await owner.gain([physical], 'wushengxue');
        game.log(`【雾生雪】${owner.name} 获得了原牌 ${physical.fullname || physical.name}`);
      }

      // 其视为使用原牌
      const ghost = new Card(card.suit, card.number, fromName);
      ghost.virtual = true;
      game.log(`【雾生雪】${actor.name} 视为使用原牌【${fromText}】`);
      await game.useCard(actor, ghost);
    },
  },

  /* ================================================================
   * 自囚者
   * ================================================================ */
  ziqiuzhe: {
    id: 'ziqiuzhe',
    name: '自囚者',
    type: 'trigger',
    trigger: 'drawEnd',
    scope: 'global',
    desc: '每名角色每回合限一次，有角色摸牌后，你可令其直到下次流失体力前，'
      + '每次获得牌时须明置其中一张。',
    filter: (ctx) => {
      const drawer = ctx.event && ctx.event.player;
      if (!drawer || !drawer.alive) return false;
      return (drawer.flags && drawer.flags.ziqiuzheTurn) !== ctx.game.turnCount;
    },
    async content(ctx) {
      const game = ctx.game;
      const owner = ctx.player;                       // 技能拥有者
      const drawer = ctx.event.player;                // 摸牌的人
      drawer.flags.ziqiuzheTurn = game.turnCount;
      drawer.flags.ziqiuActive = true;
      game.log(`【自囚者】${owner.name} 令 ${drawer.name} 此后每次获得牌须明置其中一张`
        + '（直到下次流失体力）');
    },
  },

  /* ================================================================
   * 雾生雪 ② 的兑现：被标记的角色每回合开始时明置一张牌
   * ================================================================ */
  wushengxue_reveal: {
    id: 'wushengxue_reveal',
    name: '雾生雪',
    sub: true,
    locked: true,
    type: 'trigger',
    trigger: 'turnStart',
    scope: 'global',
    desc: '（雾生雪②的结算：被标记的角色每回合开始时明置一张牌）',
    filter: (ctx) => {
      const p = ctx.event && ctx.event.player;
      return !!(p && p.alive && p.flags && p.flags.wushengxueReveal);
    },
    async content(ctx) {
      const game = ctx.game;
      const p = ctx.event.player;
      const card = await revealOne(game, p, { prompt: '【雾生雪】②：选择一张手牌明置' });
      if (!card) {
        // 没有手牌：标记保留，等他下次有牌再明置
        return;
      }
      game.log(`【雾生雪】${p.name} 明置了 ${card.fullname || card.name}`);
    },
  },
};

export { isPoisonNow, POISON };
