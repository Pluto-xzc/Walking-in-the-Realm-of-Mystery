/**
 * 机制：毒
 * ------------------------------------------------------------------
 * 需求方 m08271 给出的【毒】规则：
 *   「当此牌正面朝上或被转化牌而离开你的手牌区时，你失去 1 点体力；
 *     当你因摸牌阶段摸牌而获得【毒】后，你可不触发该牌效果的将之交给其他角色。」
 *
 * 另有「明置的牌在明置的回合内视为【毒】」（小早川时一【雾生雪】），
 * 所以判定统一走 `isPoisonNow()`，不要直接比较牌名。
 */

export const POISON = 'du';

/**
 * 场上是否有【雾生雪】（小早川时一）。
 * ------------------------------------------------------------------
 * 「明置的牌视为【毒】」是**雾生雪的锁定技效果**，不是全局规则：
 * 没有小早川时一时，明置的牌不该变成毒。
 * 历史 bug：曾经无条件生效，导致娜塔莎对局里明置的牌离开手牌
 * 就掉血、直接把自己掉死。
 */
export function hasWushengxue(game) {
  return !!game && game.players.some((p) => p.alive && p.skills && p.skills.includes('wushengxue'));
}

/**
 * 这张牌此刻是否「视为毒」。
 * ① 它本身是【毒】；
 * ② 它是本回合刚被明置的牌（【雾生雪】锁定技 —— 需要有该技能在场）。
 */
export function isPoisonNow(game, card) {
  if (!card) return false;
  if (card.name === POISON) return true;
  if (!card.revealed || card.revealTurn !== game.turnCount) return false;
  return hasWushengxue(game);
}

/**
 * 是否有资格因「离开手牌区」触发掉血。
 * 只有「正面朝上」或「作为转化牌的实体牌」离开手牌区才触发。
 */
export function leavesFaceUp(card) {
  return !!(card && (card.revealed || card._leavingAsSource));
}

/**
 * 离开手牌区之后的结算：每张符合条件的毒各失去 1 点体力。
 * 由 `Player.loseCards()` 调用。
 */
export async function onHandLeave(game, owner, cards) {
  if (!owner || !owner.alive || !cards || !cards.length) return 0;
  /*
   * 调用方（Player.loseCards）已经在「清掉明置状态之前」筛好了名单，
   * 这里不能再用 isPoisonNow 复筛 —— 那时 revealed 已经被清空。
   */
  const poison = cards.filter(Boolean);
  if (!poison.length) return 0;
  for (const card of poison) {
    if (!owner.alive) break;
    game.log(`【毒】${owner.name} 的 ${card.fullname || card.name} 正面离开手牌区，失去 1 点体力`);
    await owner.loseHp(1);
  }
  return poison.length;
}

/**
 * 摸牌阶段摸到毒之后的转交机会。
 * 由 `Player.draw()` 在摸牌阶段调用；返回被交出去的牌（没有则 null）。
 */
export async function offerPoisonTransfer(game, owner, cards) {
  if (!owner || !owner.alive) return null;
  const poison = (cards || []).filter((c) => c && c.name === POISON);
  if (!poison.length) return null;
  const others = game.players.filter((p) => p.alive && p !== owner);
  if (!others.length) return null;

  const pick = await owner.chooseOption({
    prompt: `【毒】摸牌阶段获得的【毒】可以交给其他角色（不触发掉血），要交给谁？`,
    options: [
      { key: 'keep', label: '自己留着' },
      ...others.map((p) => ({ key: p.id, label: `${p.name}（${p.seat + 1} 号位）` })),
    ],
    cancelable: false,
  });
  if (!pick || pick === 'keep') return null;
  const target = game.players.find((p) => p.id === pick || String(p.id) === String(pick));
  if (!target) return null;

  const card = poison[0];
  owner.hand = owner.hand.filter((c) => c !== card);
  card._leavingAsSource = false;
  card.revealed = false;
  await target.gain([card], 'poison-transfer');
  game.log(`【毒】${owner.name} 将摸到的【毒】交给了 ${target.name}（不失去体力）`);
  return card;
}
