/**
 * 扩展机制 · 共用小工具
 * ----------------------------------------------------------------
 * 这里只放**被多个机制域共用**的纯函数，避免子文件之间产生网状依赖。
 * 判断标准：被 3 个以上机制文件引用，且与具体机制无关。
 */

/**
 * 把「单个牌 / 牌数组 / 可迭代集合」统一成数组。
 * 各机制的公开函数都允许这三种调用方式，故共用。
 */
export function normalizeList(cards) {
  if (!cards) return [];
  if (Array.isArray(cards)) return cards;
  if (typeof cards === 'object' && cards.name !== undefined) return [cards];
  return [];
}

/**
 * 清除一张牌的「明置」标记，返回它此前是否明置。
 * 明置定义在 reveal.js，但除外 / 横置 / 蓄谋 等区域在移动牌时
 * 都要顺带失效明置，故上提到共用层。
 */
export function clearRevealed(card) {
  if (!card) return false;
  const had = !!card.revealed;
  if (typeof card.setRevealed === 'function') card.setRevealed(false);
  else { delete card.revealed; delete card.revealOwner; }
  return had;
}

/** 批量失效明置，返回实际被清掉的那些牌 */
export function invalidateRevealed(cards) {
  const out = [];
  for (const c of normalizeList(cards)) {
    if (c && c.revealed && clearRevealed(c)) out.push(c);
  }
  return out;
}