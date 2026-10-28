/**
 * 技能辅助：shuangxing（丰川祥子的转换技）
 * ------------------------------------------------------------------
 * 【双星伴生之人】既是**转换技**（①/②/③ 循环），又是被另一个技能
 * 【爱恶生死之惑】「执行」的对象。两个技能共用同一套「候选牌名」判定
 * 与「当前项」流转，所以把公共部分抽到这里，避免各写一遍。
 *
 * 三个选项（需求方原文）：
 *   ① 存在于弃牌堆的同类牌
 *   ② 不存于场上可见牌的同类牌
 *   ③ 本回合未使用过的牌名
 *
 * 「同类牌」= 与被转化的那张牌**同一个大类**。需求方补充说明
 * 「基本牌、锦囊牌、装备牌」，因此大类只有这三种。
 */

import { CARDS } from '../cards.js';
import { SKILLS } from '../skills.js';
import { noteOptionResolved } from '../mechanics.js';

/** 转换技的三个选项标签 */
export const SHUANGXING_ITEMS = ['①', '②', '③'];

/** 三个选项的说明文字（UI 与日志共用） */
export const SHUANGXING_TEXT = [
  '存在于弃牌堆的同类牌',
  '不存于场上可见牌的同类牌',
  '本回合未使用过的牌名',
];

/** 技能 id（多处引用，抽成常量避免手打错） */
const SKILL_ID = 'shuangxingbansheng';

/** 转换技当前项（0 / 1 / 2） */
export function shuangxingIndex(player) {
  const rec = player.storage && player.storage[`zhuanhuanji_${SKILL_ID}`];
  return (rec | 0) % SHUANGXING_ITEMS.length;
}

/** 牌的大类：基本牌 / 锦囊牌 / 装备牌 */
function bigTypeOf(name) {
  const def = CARDS[name] || {};
  if (def.type === 'equip') return 'equip';
  if (def.type === 'trick') return 'trick';
  return 'basic';
}

/** 场上**可见**的牌名（装备区、判定区、明置的手牌） */
function visibleCardNames(game) {
  const names = new Set();
  for (const p of game.players) {
    for (const c of Object.values(p.equips || {})) if (c) names.add(c.name);
    for (const c of (p.judges || [])) if (c) names.add(c.name);
    for (const c of (p.hand || [])) {
      if (c && (c.revealed || c.visible)) names.add(c.name);
    }
  }
  return names;
}

/** 本回合全场**使用过**的牌名 */
function namesUsedThisTurn(game) {
  const names = new Set();
  for (const ev of (game.useEvents || [])) {
    if (ev.turn !== game.turnCount || ev.kind !== 'use') continue;
    if (ev.card && ev.card.name) names.add(ev.card.name);
  }
  return names;
}

/** 这张牌能不能「视为 targetName」被使用（用来判断合法性） */
function probeCard(source, targetName) {
  return { name: targetName, suit: source.suit, number: source.number };
}

/**
 * 「双星伴生之人」的候选牌名
 * ------------------------------------------------------------------
 * @param {Card} source     被转化的那张牌（决定「同类」是哪个大类）
 * @param {number} itemIndex 当前项（0/1/2）
 * @returns {string[]} 可选的牌名（可能是空数组）
 */
export function shuangxingCandidates(game, player, source, itemIndex) {
  const cat = bigTypeOf(source.name);
  const discard = new Set((game.discardPile || []).map((c) => c && c.name));
  const visible = visibleCardNames(game);
  const used = namesUsedThisTurn(game);

  const out = [];
  for (const name of Object.keys(CARDS)) {
    if (name === source.name) continue;
    if (bigTypeOf(name) !== cat) continue;
    if (itemIndex === 0 && !discard.has(name)) continue;
    if (itemIndex === 1 && visible.has(name)) continue;
    if (itemIndex === 2 && used.has(name)) continue;
    out.push(name);
  }
  return out;
}

/**
 * 实际可选的牌名
 * ------------------------------------------------------------------
 * 在候选的基础上叠加「须非法」的限制：周始后的那次转化必须是
 * **此刻用不出来的牌**（如【闪】，或已经用满次的【杀】）。
 */
export function shuangxingPicks(game, player, source, itemIndex) {
  const list = shuangxingCandidates(game, player, source, itemIndex);
  const probe = (n) => game.cardUsableNow(player, probeCard(source, n));
  if (illegalPending(player)) {
    // 周始：这次转化必须是一张**此刻用不出来**的牌
    return list.filter((n) => !probe(n));
  }
  /*
   * 平时只列「现在真的用得出」的牌名。
   * 否则会列出【闪】这种只能响应的牌，玩家选完再被要求选目标，
   * 变成一个走不下去的假流程。
   */
  return list.filter(probe);
}

/** 本回合「下次转化的牌须非法」的标记是否还挂着 */
function illegalPending(player) {
  return !!(player.storage && player.storage.shuangxingIllegalNext);
}

/**
 * 选一个「视为」的牌名
 * ------------------------------------------------------------------
 * 一个候选都不剩时返回 null，调用方据此放弃发动。
 *
 * @returns {Promise<string|null>} 牌名；null = 不转化
 */
export async function chooseShuangxingName(ctx, source, itemIndex) {
  const { player, game } = ctx;
  const list = shuangxingPicks(game, player, source, itemIndex);
  if (!list.length) return null;

  const label = `【${source.fullname || source.name}】视为`;
  if (!player.isHuman) {
    // AI：优先挑一张真的用得出来的，免得白亏一张牌
    const ok = list.filter((n) => game.cardUsableNow(player, probeCard(source, n)));
    return (ok.length ? ok : list)[0];
  }

  // 只有一个候选就不必问
  if (list.length === 1) return list[0];

  const options = list.map((n) => ({
    key: n,
    label: (CARDS[n] && CARDS[n].fullname) || n,
  }));
  const picked = await game.io.chooseOption(player,
    `${label}？\n（当前项${SHUANGXING_ITEMS[itemIndex]}：`
    + `${SHUANGXING_TEXT[itemIndex]}）`, options).catch(() => null);
  return list.includes(picked) ? picked : null;
}

/**
 * 把转换技的当前项设为 index，并登记这一项「已被实际结算」
 * ------------------------------------------------------------------
 * 周始的计数在 mechanics/convert.js 里：只有**按顺序**结算才推进游标，
 * 三项跑完才触发周始效果。因此调整当前项必须同时通知它。
 */
export async function setShuangxingIndex(game, player, index) {
  if (!player.storage) player.storage = {};
  player.storage[`zhuanhuanji_${SKILL_ID}`] = index;
  await noteOptionResolved(game, player, SKILLS[SKILL_ID], index);
}

/**
 * 转化技的常规流转：本次执行了第 index 项 → 当前项推进到下一位
 */
export async function advanceShuangxing(game, player, index) {
  await setShuangxingIndex(game, player,
    (index + 1) % SHUANGXING_ITEMS.length);
}
