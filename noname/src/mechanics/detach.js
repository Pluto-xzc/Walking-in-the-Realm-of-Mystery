/**
 * 扩展机制 · 调离 / 额定回合 / 附魔 / 分发
 * ----------------------------------------------------------------
 * 由 src/mechanics.js 拆分而来，段结构与原文件一一对应。
 * 本文件不 import 任何模块：所有依赖（game / player / CARDS / SKILLS）
 * 都由调用方以参数传入。
 */

import { normalizeList } from './shared.js';
/* ============================================================
 * G. 调离（本项目新增；无名杀中并无此机制）
 * ============================================================
 * ⚠️ 已核实：无名杀全部源码中「调离」**只出现在武将背景文本**里，
 *    没有任何机制实现。因此本机制的语义**完全按需求方给定**实现。
 *
 * 需求方给定规则：
 *   · 被调离的角色**不参与距离结算**；
 *   · **不能成为牌的目标**；
 *   · **不能使用牌**；
 *   · 直到被「调回」；**未注明调回时间则默认为当前回合结束后调回**。
 */

/** 调离一名角色（不写 turn 则默认当前回合结束时调回） */
export function removeFromField(player, opts = {}) {
  if (!player) return false;
  const g = player.game;
  player.detached = true;
  // 默认调回时间：当前回合结束后
  if (opts.turn == null) {
    player.detachUntilTurn = g ? g.turnCount : 0;
    player.detachAutoReturn = true;
  } else {
    player.detachUntilTurn = opts.turn;
    player.detachAutoReturn = !!opts.auto;
  }
  if (g) {
    g.log(`${player.name} 被调离（不参与距离结算、不能成为目标、不能使用牌）`);
    g.emit();
  }
  return true;
}

/** 调回一名角色 */
export function returnToField(player) {
  if (!player) return false;
  player.detached = false;
  player.detachAutoReturn = false;
  delete player.detachUntilTurn;
  if (player.game) {
    player.game.log(`${player.name} 被调回`);
    player.game.emit();
  }
  return true;
}

/** 该角色是否处于调离状态 */
export function isDetached(player) {
  return !!(player && player.detached);
}

/**
 * 回合结束时处理「自动调回」
 * 由引擎在回合结束时调用。
 */
export function checkDetachAutoReturn(game) {
  if (!game) return [];
  const back = [];
  for (const p of game.players) {
    if (!p.detached) continue;
    if (!p.detachAutoReturn) continue;
    if (p.detachUntilTurn !== game.turnCount) continue;
    returnToField(p);
    back.push(p);
  }
  return back;
}

/* ============================================================
 * H. 额定回合 / 额定阶段（官方机制的延伸）
 * ============================================================
 * 无名杀依据（`library/element/player.js` 的 rest 注释）：
 *   「type 是休整的计数方式，'round' 是在你的**额定回合开始前**才计数」
 *   即：额定回合 = 在没有技能/牌影响的前提下，每轮中该角色
 *   原本应执行的那个回合（因技能产生的**额外回合不算**）。
 *
 * 本项目实现：
 *   引擎在每个回合开始时记录该回合是否为「额定回合」。
 *   判定依据：这一回合**不是**由技能/牌插队产生的额外回合。
 */

/** 本回合是否为该角色的额定回合 */
export function isRatedTurn(game, player) {
  if (!game || !player) return false;
  if (game.currentPlayer !== player) return false;
  // extraTurn 表示由技能产生的额外回合，不算额定回合
  if (player.extraTurn) return false;
  return game._turnIsRated !== false;
}

/** 本阶段是否为该角色的额定阶段 */
export function isRatedPhase(game, player, phase) {
  if (!isRatedTurn(game, player)) return false;
  if (phase == null) return true;
  return game._ratedPhase === phase || game._currentPhase === phase;
}

/** 该角色本轮的额定回合是否已经开始过 */
export function hasRatedTurnStarted(game, player) {
  if (!game || !player) return false;
  return player.storage && player.storage.ratedTurnRound === game.roundCount;
}

/** 标记本轮额定回合已开始（由引擎调用） */
export function markRatedTurnStarted(game, player) {
  if (!game || !player) return;
  player.storage = player.storage || {};
  player.storage.ratedTurnRound = game.roundCount;
}

/* ============================================================
 * I. 附魔（本项目新增）
 * ============================================================
 * 需求方给定：把对应效果或技能的效果**附加在对应的牌上**。
 *   例：令一张【杀】附魔吕布的技能【无双】，
 *       此时该【杀】需要两张【闪】响应。
 *
 * 实现方式：
 *   card.enchants = [skillId, ...]
 *   引擎在需要时读取这些附魔技能的效果
 *   （如 shanRequired 会累加）。
 */

/** 给牌附魔若干技能 */
export function enchantCard(card, skillIds) {
  if (!card) return [];
  const list = Array.isArray(skillIds) ? skillIds : [skillIds];
  card.enchants = card.enchants || [];
  for (const s of list) {
    if (s && !card.enchants.includes(s)) card.enchants.push(s);
  }
  if (card.enchants.length) {
    card.enchanted = true;
  }
  return card.enchants;
}

/** 解除附魔 */
export function disenchantCard(card, skillIds) {
  if (!card || !card.enchants) return [];
  if (skillIds == null) {
    card.enchants = [];
  } else {
    const list = Array.isArray(skillIds) ? skillIds : [skillIds];
    card.enchants = card.enchants.filter((s) => !list.includes(s));
  }
  card.enchanted = card.enchants.length > 0;
  return card.enchants;
}

/** 这张牌附魔了哪些技能 */
export function cardEnchants(card) {
  return (card && card.enchants) ? card.enchants.slice() : [];
}

/** 这张牌是否附魔了某技能 */
export function hasEnchant(card, skillId) {
  return !!(card && card.enchants && card.enchants.includes(skillId));
}

/**
 * 汇总该牌附魔带来的效果系数
 * ------------------------------------------------------------------
 * 例：【无双】令【杀】需要两张【闪】响应。
 * 引擎在计算 needShanCount 时会调用本函数。
 *
 * @param {Card} card
 * @param {string} key 效果键（如 'shanRequired'）
 * @param {*} base 基础值
 * @param {object} SKILLS 技能表
 */
export function applyEnchantMod(card, key, base, SKILLS) {
  const ids = cardEnchants(card);
  if (!ids.length || !SKILLS) return base;
  let v = base;
  for (const sid of ids) {
    const sk = SKILLS[sid];
    if (!sk) continue;
    // 优先用 mod[key]，其次用技能顶层的同名钩子
    const fn = (sk.mod && sk.mod[key]) || sk[key];
    if (typeof fn === 'function') {
      try { v = fn(v); } catch { /* 单个附魔出错不影响其它 */ }
    }
  }
  return v;
}

/* ============================================================
 * J. 分发（本项目新增）
 * ============================================================
 * 需求方给定：将所要分发的牌，**尽可能平分**给相同的、
 * **自己以外**的其他角色；若出现「分发 5 张牌仅有 3 个角色」，
 * 则**多余的 2 张再次分发**。
 *
 * 实现：轮转发牌（round-robin）。
 *   第 1 轮每人均分 1 张 → 5 张 / 3 人 = 每人 1 张，余 2 张；
 *   余下的 2 张**再次分发** → 前 2 人再各得 1 张。
 */

/**
 * 计算分发方案（不实际发牌，便于测试与 UI 预览）
 * @param {number} cardCount 待分发牌数
 * @param {number} playerCount 参与分发的角色数
 * @returns {number[]} 每人获得的张数
 */
export function planDistribution(cardCount, playerCount) {
  if (playerCount <= 0) return [];
  const out = new Array(playerCount).fill(0);
  let left = Math.max(0, cardCount | 0);
  // 轮转分发：每轮每人一张，直到分完
  let i = 0;
  while (left > 0) {
    out[i % playerCount] += 1;
    i++;
    left--;
  }
  return out;
}

/**
 * 实际分发
 * @param {Player} source 分发者（不参与分配）
 * @param {Card[]} cards 待分发的牌
 * @param {Player[]} [receivers] 接收者，默认「自己以外的所有存活角色」
 * @returns {Promise<Array<{player:Player, cards:Card[]}>>}
 */
export async function distributeCards(source, cards, receivers) {
  const g = source && source.game;
  const list = normalizeList(cards).filter(Boolean);
  if (!g || !list.length) return [];

  let targets = receivers
    ? receivers.slice()
    : g.players.filter((p) => p.alive && p !== source);
  targets = targets.filter((p) => p && p.alive);
  if (!targets.length) return [];

  const plan = planDistribution(list.length, targets.length);
  const result = [];
  let idx = 0;
  for (let i = 0; i < targets.length; i++) {
    const n = plan[i];
    if (!n) { result.push({ player: targets[i], cards: [] }); continue; }
    const take = list.slice(idx, idx + n);
    idx += n;
    await targets[i].gain(take);
    result.push({ player: targets[i], cards: take });
  }
  g.log(`${source.name} 分发了 ${list.length} 张牌给 `
    + targets.map((p, i) => `${p.name}${plan[i]}张`).join('、'));
  g.emit();
  return result;
}

