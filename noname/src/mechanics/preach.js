/**
 * 【爱，救护与抉择】的「交牌 → 本回合前三张」记账
 * ====================================================================
 * 需求方给的解释：
 *   「同颜色」= 与他交出的牌颜色相同（交♡♤ → 红、黑都能触发）
 *   「不同花色」= 与他交出的牌花色都不同（交♡♤ → ♦♧ 算不同花色）
 *
 * 因此交出的牌定义了两个集合：颜色集合、花色集合。
 * 之后该角色本回合使用的前三张牌，每张：
 *   · 颜色命中集合  → 该牌无次数限制（【杀】【酒】的次数限制解除）
 *   · 花色不在集合  → 结算后，其与技能拥有者各摸一张（拥有者就是其本人时只摸一张）
 *
 * 记账集中在引擎的 useCardCore 里做一次（见 preachTicket），
 * 技能只在 cardUsedAfter 里领结果，避免两处各自计数导致错位。
 */

export const PREACH_KEY = 'natashaPreach';

/** 取某人的交牌记录；回合不对就视为没有 */
export function preachState(game, player) {
  const st = player && player.flags && player.flags[PREACH_KEY];
  if (!st) return null;
  if (st.turn !== game.turnCount) return null;
  return st;
}

/**
 * 记下「谁交了哪些牌」。
 * @param {Player} donor 交牌的人（当前回合角色）
 * @param {Player} owner 技能拥有者（收牌的人）
 * @param {Card[]} cards 交出的牌
 */
export function beginPreach(game, donor, owner, cards) {
  const colors = [...new Set(cards.map((c) => c.color).filter(Boolean))];
  const suits = [...new Set(cards.map((c) => c.suit).filter(Boolean))];
  donor.flags[PREACH_KEY] = {
    turn: game.turnCount,
    ownerId: owner.id,
    colors,
    suits,
    used: 0,
  };
}

/**
 * 领一张票：给「本回合使用的第 N 张牌」记账，并算出这张牌享受什么。
 * 超过 3 张就不再有票（返回 null）。
 *
 * @returns {null | {index:number, free:boolean, draw:boolean, ownerId:number}}
 *   free = 颜色命中 → 无次数限制
 *   draw = 花色不在集合 → 结算后各摸一张
 */
export function preachTicket(game, player, card) {
  const st = preachState(game, player);
  if (!st || !card) return null;
  if (st.used >= 3) return null;
  st.used += 1;
  const color = card.color;
  const suit = card.suit;
  return {
    index: st.used,
    free: !!color && st.colors.includes(color),
    draw: !!suit && !st.suits.includes(suit),
    ownerId: st.ownerId,
  };
}

/** 给 UI / 日志用的一行说明 */
export function preachDesc(st) {
  if (!st) return '';
  const colorText = st.colors.map((c) => (c === 'red' ? '红' : '黑')).join('、') || '无';
  const suitText = st.suits.map((s) => ({ spade: '♠', heart: '♡', club: '♧', diamond: '♦' }[s] || s)).join('') || '无';
  return `已交牌：${suitText}（同色：${colorText}），本回合已用 ${st.used}/3 张`;
}
