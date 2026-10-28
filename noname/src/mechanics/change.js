/**
 * 扩展机制 · 一次性变动拦截（武将【破惘长行】）
 * ==================================================================
 * 需求方规则（原文要点）：
 *   「有角色的体力/手牌要一次性变动大于 1 时，你可以蓄谋 1 张手牌 /
 *     使用 1 张蓄谋牌，令那个结算中大于 1 的每个变动分别变为 ±1。」
 *
 * 实现要点：
 *   ① **结算粒度**：一次技能发动 / 一张牌的完整结算 = 一个结算。
 *      引擎在技能 content 与用牌结算处打点（enterSettlement / exitSettlement），
 *      用深度计数支持嵌套。
 *   ② 一个结算内**只询问一次**是否发动（需求方确认）。
 *   ③ 每次「大于 1 的变动」单独询问改为 +1 还是 -1：
 *        -1 = 同向：少变一点（掉 2 血 → 掉 1 血）
 *        +1 = 反向：掉 2 血 → 回 1 血
 *   ④ 代价：体力变动 → 蓄谋 1 张手牌；手牌变动 → 使用 1 张蓄谋牌。
 *   ⑤ 不在任何结算内（例如弃牌阶段直接弃牌）时，该次变动自成一个结算。
 *
 * 本文件不 import 引擎模块，只依赖同目录的 xumou.js。
 */

import { xumouCardsOf, putXumou } from './xumou.js';

/** 提供本机制的技能 id */
const SKILL_ID = 'powangchangxing';

/** 进入一次结算（技能发动 / 用牌结算） */
export function enterSettlement(game) {
  if (!game) return;
  game._settleDepth = (game._settleDepth || 0) + 1;
  if (game._settleDepth === 1) game._changeCtx = { asked: false, active: false };
}

/** 结束一次结算 */
export function exitSettlement(game) {
  if (!game) return;
  game._settleDepth = Math.max(0, (game._settleDepth || 0) - 1);
  if (game._settleDepth === 0) game._changeCtx = null;
}

/** 场上是否有提供本机制的角色（存活） */
export function changeInterceptorOf(game) {
  if (!game) return null;
  return game.players.find((p) => p.alive && (p.skills || []).includes(SKILL_ID)) || null;
}

/**
 * 拦截一次「一次性变动」
 * ------------------------------------------------------------------
 * @param {Game} game
 * @param {'hp'|'hand'} kind 变动的种类
 * @param {number} delta 原始变动（正 = 增加，负 = 减少）
 * @returns {Promise<number>} 实际采用的变动（符号与 delta 同语义）：
 *   未发动 / 不满足条件 → 原值；
 *   同向（-1）→ 符号同 delta、绝对值 1；
 *   反向（+1）→ 符号与 delta 相反、绝对值 1。
 */
export async function adjustBigChange(game, kind, delta) {
  if (!game || Math.abs(delta) <= 1) return delta;
  if (game._changeBusy) return delta;                  // 代价结算自身不再递归
  const owner = changeInterceptorOf(game);
  if (!owner) return delta;

  const own = (game._settleDepth || 0) === 0;          // 无结算 → 自成结算
  const ctx = own
    ? { asked: false, active: false }
    : (game._changeCtx || (game._changeCtx = { asked: false, active: false }));

  if (!ctx.asked) {
    ctx.asked = true;
    const where = kind === 'hp' ? '体力' : '手牌';
    const cost = kind === 'hp' ? '蓄谋 1 张手牌' : '使用 1 张蓄谋牌';
    const payable = kind === 'hp'
      ? owner.hand.length > 0
      : xumouCardsOf(owner).length > 0;
    if (payable) {
      const ans = await owner.chooseOption({
        prompt: `【破惘长行】有角色的${where}即将一次性变动 ${Math.abs(delta)}，`
          + `是否${cost}发动？`,
        options: [{ key: 'yes', label: `发动（${cost}）` }, { key: 'no', label: '不发动' }],
      }).catch(() => 'no');
      if (ans === 'yes') ctx.active = await payCost(game, owner, kind);
    }
  }

  if (!ctx.active) return delta;

  const pick = await owner.chooseOption({
    prompt: `【破惘长行】把这次${kind === 'hp' ? '体力' : '手牌'}变动 `
      + `${delta > 0 ? '+' : ''}${delta} 改成？`,
    options: [
      { key: '-1', label: `-1（同向，只变 1 点）` },
      { key: '+1', label: `+1（反向，变 1 点）` },
    ],
  }).catch(() => '-1');

  const nd = pick === '+1' ? -Math.sign(delta) : Math.sign(delta);
  game.log(`【破惘长行】${owner.name} 将这次${kind === 'hp' ? '体力' : '手牌'}变动 `
    + `${delta > 0 ? '+' : ''}${delta} 改为 ${nd > 0 ? '+' : ''}${nd}`
    + `（${pick === '+1' ? '反向' : '同向'}）`);
  return nd;
}

/**
 * 支付发动代价
 * @returns {Promise<boolean>} 是否成功
 */
async function payCost(game, owner, kind) {
  game._changeBusy = true;
  try {
    if (kind === 'hp') {
      const got = await owner.chooseCards({
        prompt: '【破惘长行】：选择 1 张手牌蓄谋',
        position: 'h', min: 1, max: 1, cancelable: false,
      });
      const card = (got || [])[0];
      if (!card) return false;
      putXumou(owner, [card], owner);
      game.log(`【破惘长行】${owner.name} 为体力变动支付代价：蓄谋 1 张手牌`
        + `（${card.fullname || card.name}）`);
      return true;
    }

    const list = xumouCardsOf(owner);
    if (!list.length) return false;
    let card = list[list.length - 1];               // 后置入的先使用
    if (list.length > 1) {
      const idx = await owner.chooseOption({
        prompt: '【破惘长行】：使用 1 张蓄谋牌作为代价',
        options: list.map((c, i) => ({ key: String(i), label: c.fullname || c.name })),
      }).catch(() => String(list.length - 1));
      card = list[Number(idx)] || card;
    }
    const at = owner.xumou.indexOf(card);
    if (at >= 0) owner.xumou.splice(at, 1);
    card.zone = 'hand';
    game.log(`【破惘长行】${owner.name} 为手牌变动支付代价：使用 1 张蓄谋牌`
      + `（${card.fullname || card.name}）`);
    const targets = await game.pickTargetsForVirtual(owner, card).catch(() => []);
    await game.useCard(owner, card, targets);
    // 用完后若还留在手里（转化牌等情况），按弃牌处理
    const hi = owner.hand.indexOf(card);
    if (hi >= 0) {
      owner.hand.splice(hi, 1);
      card.zone = 'discard';
      game.toDiscard([card], { direct: true });
    }
    return true;
  } finally {
    game._changeBusy = false;
  }
}
