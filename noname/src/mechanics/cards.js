/**
 * 扩展机制 · 横置牌 / 即时牌 / 连招技 / 酩酊
 * ----------------------------------------------------------------
 * 由 src/mechanics.js 拆分而来，段结构与原文件一一对应。
 * 本文件不 import 任何模块：所有依赖（game / player / CARDS / SKILLS）
 * 都由调用方以参数传入。
 */

import { normalizeList, invalidateRevealed } from './shared.js';
/* ============================================================
 * M. 横置牌（本项目新增）
 * ============================================================
 * ⚠️ 核实说明：无名杀的「横置」指的是**角色状态**（连环状态，即铁索
 *    连环的 link），本项目早已实现（Player.isChained）。
 *    这里要做的是**牌级的横置**，无名杀并无对应机制，
 *    因此完全按需求方给定实现。
 *
 * 需求方给定规则：
 *   · 横置的牌被**弃置**时，**一并弃置**手牌中其余的横置牌；
 *   · 横置的牌被**其他角色获得**时，**一并获得**手牌中其余的横置牌；
 *   · 表现形式上须将牌横向持有（本项目用角标表示，见样式）。
 */

/** 横置一张或多张牌 */
export function linkCards(cards) {
  const list = normalizeList(cards);
  const out = [];
  for (const c of list) {
    if (!c) continue;
    c.horizontal = true;
    out.push(c);
  }
  return out;
}

/** 解除横置 */
export function unlinkCards(cards) {
  const list = normalizeList(cards);
  for (const c of list) {
    if (c) delete c.horizontal;
  }
  return list;
}

/** 这张牌是否被横置 */
export function isLinkedCard(card) {
  return !!(card && card.horizontal);
}

/**
 * 取某角色**手牌中**所有横置牌
 * @param {Player} player
 * @param {Card} [except] 可排除一张（通常是触发源头本身）
 */
export function linkedHandCards(player, except) {
  if (!player || !player.hand) return [];
  return player.hand.filter((c) => c && c.horizontal && c !== except);
}

/**
 * 横置牌的「连带弃置」
 * ------------------------------------------------------------------
 * 当某张横置牌被弃置时，该角色手牌中其余的横置牌**一并弃置**。
 *
 * @param {Player} owner 原持有者
 * @param {Card} card 触发连带的横置牌
 * @param {Function} [discardFn] 弃置函数，默认用 owner.discard
 * @returns {Promise<Card[]>} 被连带弃置的牌
 */
export async function cascadeDiscardLinked(owner, card, discardFn) {
  if (!owner || !isLinkedCard(card)) return [];
  const extra = linkedHandCards(owner, card);
  if (!extra.length) return [];

  if (typeof discardFn === 'function') {
    await discardFn(extra);
  } else if (owner.game) {
    for (const c of extra) delete c.horizontal;
    owner.game.toDiscard(extra, { direct: true });
    if (owner.game.log) {
      owner.game.log(`【横置】${owner.name} 手牌中其余 `
        + `${extra.length} 张横置牌被一并弃置`);
    }
  }
  for (const c of extra) delete c.horizontal;
  return extra;
}

/**
 * 横置牌的「连带获得」
 * ------------------------------------------------------------------
 * 当某张横置牌被**其他角色**获得时，原持有者手牌中其余的横置牌
 * **一并被该角色获得**。
 *
 * @param {Player} receiver 获得牌的角色
 * @param {Player} owner 原持有者
 * @param {Card} card 触发连带的横置牌
 * @returns {Promise<Card[]>} 被连带获得的牌
 */
export async function cascadeGainLinked(receiver, owner, card) {
  if (!receiver || !owner || !isLinkedCard(card)) return [];
  if (receiver === owner) return [];      // 自己获得自己的牌不触发
  const extra = linkedHandCards(owner, card);
  if (!extra.length) return [];

  for (const c of extra) {
    // 离开原持有者手牌：同时解除横置与明置
    delete c.horizontal;
    invalidateRevealed([c]);
    const i = owner.hand.indexOf(c);
    if (i >= 0) owner.hand.splice(i, 1);
  }
  await receiver.gain(extra);
  if (owner.game && owner.game.log) {
    owner.game.log(`【横置】${owner.name} 手牌中其余 `
      + `${extra.length} 张横置牌被 ${receiver.name} 一并获得`);
  }
  return extra;
}

/* ============================================================
 * N. 即时牌（本项目新增）
 * ============================================================
 * 需求方给定：
 *   即时牌 = **基本牌 + 普通锦囊牌** 的总和，
 *   意为「即时产生效果」的牌。
 *   **延时锦囊牌、装备牌不包含在内。**
 *
 * 无名杀依据：`get.type2` 会把牌归为 basic / trick / equip，
 * 但延时锦囊（乐不思蜀/兵粮寸断/闪电）在无名杀里仍是 trick ——
 * 而本机制要把它们**排除**，因此这里用 `def.delayed` 单独判定。
 */

/** 这张牌是否是即时牌 */
export function isInstantCard(card, CARDS_REF) {
  if (!card) return false;
  const def = (CARDS_REF || {})[card.name];
  const type = (def && def.type) || card.type;
  // 基本牌 → 是
  if (type === 'basic') return true;
  // 普通锦囊 → 是；延时锦囊 → 不是
  if (type === 'trick') {
    const delayed = (def && def.delayed) || card.delayed;
    return !delayed;
  }
  // 装备牌 → 不是
  return false;
}

/** 从一组牌里筛出即时牌 */
export function filterInstantCards(cards, CARDS_REF) {
  return normalizeList(cards).filter((c) => isInstantCard(c, CARDS_REF));
}

/* ============================================================
 * O. 连招技（官方机制）
 * ============================================================
 * 无名杀依据：
 *   ① 技能标签：`get/index.js` 里 `if (info.comboSkill) list.add("连招技")`；
 *   ② 判定方式：`library/element/player.js` 的 `getLastUsed(num)`
 *      —— 取 `getHistory("useCard")` 里**倒数第 num+1 个**（默认 num=0，
 *      即**上一张使用的牌**）；
 *   ③ 典型写法（`character/xianding/skill.js` 的 dcxiaoben/dczhuitao）：
 *      `const evt = lib.skill.xxx.getLastUsed(player, event);`
 *      `if (!evt || !evt.card) return false;`
 *      `return <条件(evt.card, event.card)>;`
 *
 * 需求方给定：
 *   · 「连续的两张牌使用时符合括号内要求」→ 立刻触发连招技；
 *   · 「连招」则是**直接触发效果**（不再要求连续两张牌的条件）。
 *
 * 因此本实现：
 *   - comboSkill 技能声明 `combo: { check(prev, cur, ctx) }`；
 *   - 引擎在 useCard 时用「上一张使用的牌」与「当前牌」做比对。
 */

/**
 * 取某角色上一张使用的牌的记录（对照无名杀 getLastUsed）
 * @param {Player} player
 * @param {number} [num=0] 0 = 上一张
 */
export function getLastUsedCard(player, num = 0) {
  const g = player && player.game;
  if (!g) return null;
  const hist = (g.useEvents || []).filter(
    (e) => e && e.kind === 'use' && e.player === player,
  );
  if (hist.length <= num) return null;
  return hist[hist.length - num - 1];
}

/**
 * 判定「连招技」是否成立
 * ------------------------------------------------------------------
 * @param {Player} player 技能拥有者
 * @param {Card} cur 当前使用的牌
 * @param {object} skill 技能定义（需有 combo.check）
 * @param {object} ctx 上下文（含 game / event）
 * @returns {boolean}
 */
export function checkCombo(player, cur, skill, ctx = {}) {
  if (!skill) return false;
  const combo = skill.combo || {};
  // 「连招」：直接触发，不需要连续条件
  if (combo.direct === true) return true;

  const last = getLastUsedCard(player, 0);
  if (!last || !last.card) return false;
  const prev = last.card;
  // 同一次使用不算「连续两张」
  if (ctx.event && ctx.event._comboPrev === prev) return false;

  if (typeof combo.check === 'function') {
    return !!combo.check(prev, cur, { ...ctx, player, prevEvent: last });
  }
  // 未声明 check 时的默认：仅要求「有上一张牌」
  return true;
}

/* ============================================================
 * P. 酩酊（本扩机制引申）
 * ============================================================
 * 需求方给定：**使用【酒】后的状态**。
 *
 * 与既有「酒意」的关系：
 *   本项目已有 `Player.flags.jiu` / `Game.jiuActive()` 表示酒意
 *   （参考无名杀 storage.jiu）。「酩酊」是同一状态在**本扩**里的名称，
 *   因此这里直接以酒意作为酩酊的判定依据，保证二者不会出现分歧。
 */

/** 该角色是否处于酩酊状态（= 使用过【酒】后的状态） */
export function isDrunk(player) {
  if (!player) return false;
  if (player.game && typeof player.game.jiuActive === 'function') {
    return !!player.game.jiuActive(player);
  }
  return !!(player.flags && player.flags.jiu);
}

/** 酩酊状态的剩余效力描述（供 UI 显示） */
export function drunkStatus(player) {
  if (!isDrunk(player)) return null;
  return { active: true, label: '酩酊' };
}

