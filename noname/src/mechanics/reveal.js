/**
 * 扩展机制 · 明置 / 命运回合 / 否极技 / 契定技 / 熔铸
 * ----------------------------------------------------------------
 * 由 src/mechanics.js 拆分而来，段结构与原文件一一对应。
 */
import { normalizeList, clearRevealed, invalidateRevealed } from './shared.js';

export { clearRevealed, invalidateRevealed };
/* ============================================================
 * Q. 明置（本项目新增）
 * ============================================================
 * ⚠️ 核实说明：无名杀的 `showCards` 是**一次性展示**（给所有人看一眼
 *    就结束），**没有持续的「明置状态」**。因此本机制按需求方给定实现。
 *
 * 需求方给定规则：
 *   · 被明置的手牌**随时可被其他角色观看**（持续状态）；
 *   · 一张明置牌被**原牌以外的角色获得**后，失去明置状态；
 *   · **令一张明置牌暗置**，同样失去明置状态。
 *
 * 需求方补充（确认过）：
 *   · 被**弃置 / 自己使用 / 暗置 / 别人获得 / 放入木牛流马 / 被除外**
 *     —— 这些情况**都会**失去明置状态；
 *   · 查看别人的明置牌走**右键武将详情**；
 *   · 【顺手牵羊】这类牌**可以明着选择**明置牌（因为是公开信息）。
 */

/** 明置一张或多张牌 */
export function revealCards(cards, owner) {
  const list = normalizeList(cards);
  const out = [];
  for (const c of list) {
    if (!c) continue;
    /*
     * 复用引擎里**已有的** Card.setRevealed / Card.isVisibleTo 机制
     *（见 engine.js 的 Card 类），避免与它各写一套导致行为分歧。
     * 若传入的牌不是 Card 实例（测试桩），则退回直接打标记。
     */
    if (typeof c.setRevealed === 'function') c.setRevealed(true, owner || c.owner);
    else { c.revealed = true; if (owner) c.revealOwner = owner; }
    out.push(c);
  }
  if (out.length && owner && owner.game) {
    owner.game.log(`${owner.name} 明置了 ${out.length} 张手牌`
      + `（${out.map((c) => c.fullname || c.name).join('、')}）`);
    owner.game.emit();
  }
  return out;
}

/** 暗置（失去明置状态） */
export function hideCards(cards) {
  const list = normalizeList(cards);
  for (const c of list) {
    if (!c) continue;
    if (typeof c.setRevealed === 'function') c.setRevealed(false);
    else { delete c.revealed; delete c.revealOwner; }
  }
  return list;
}

/** 这张牌是否明置 */
export function isRevealed(card) {
  return !!(card && card.revealed);
}

/**
 * 某角色**当前可被所有人看到的明置手牌**
 * （供右键武将详情、以及【顺手牵羊】这类牌的目标牌选择使用）
 */
export function revealedCardsOf(player) {
  if (!player || !player.hand) return [];
  return player.hand.filter((c) => c && c.revealed);
}

/**
 * 观者能看到某角色的哪些手牌
 * ------------------------------------------------------------------
 * 返回值里的 `revealed` 标记表示「因明置而公开」。
 * 注意：这只是**信息可见性**，不代表可以合法操作这些牌。
 */
export function visibleHandCards(viewer, owner) {
  if (!owner || !owner.hand) return [];
  const revealed = owner.hand.filter((c) => c && c.revealed);
  if (viewer === owner) {
    return owner.hand.map((c) => ({ card: c, revealed: !!c.revealed, self: true }));
  }
  return revealed.map((c) => ({ card: c, revealed: true, self: false }));
}

/**
 * 明置牌的批量失效
 * ------------------------------------------------------------------
 * 需求方确认：以下情况**都会**失去明置状态——
 *   被弃置 / 自己使用 / 被暗置 / 被别人获得 /
 *   被放入木牛流马 / 被除外
 *
 * 实现上优先复用 Card.checkRevealLost（引擎原有），
 * 此处作为「统一兜底入口」，保证任何调用点都不会漏清。
 *
 * @param {Card|Card[]} cards
 * @returns {Card[]} 被清除明置的牌
 */

/* ============================================================
 * R. 命运回合（本项目新增）
 * ============================================================
 * 需求方给定：
 *   所有角色的**额定回合均执行后**，于**轮次结束前**，
 *   拥有命运回合的角色**按座次顺序**，每人依次开始一个额外回合。
 *
 * 依赖 H 节的「额定回合」判定（额外回合不算额定回合）。
 */

/** 该角色是否拥有命运回合 */
export function hasDestinyTurn(player) {
  return !!(player && player.destinyTurn);
}

/** 授予 / 取消命运回合 */
export function setDestinyTurn(player, on = true) {
  if (!player) return false;
  player.destinyTurn = !!on;
  if (player.game) {
    player.game.log(`${player.name}${on ? '获得' : '失去'}了命运回合`);
    player.game.emit();
  }
  return true;
}

/**
 * 计算本轮命运回合的执行顺序（按座次）
 * @param {Game} game
 * @returns {Player[]} 需要执行命运回合的角色（按座位号升序）
 */
export function destinyTurnOrder(game) {
  if (!game) return [];
  return game.players
    .filter((p) => p.alive && hasDestinyTurn(p))
    .sort((a, b) => a.id - b.id);
}

/* ============================================================
 * S. 否极技（本项目新增）
 * ============================================================
 * 需求方给定：
 *   · 带有此标签的技能包含**至少两个分支选项**；
 *   · 技能效果取决于**当前生效且被选择的选项**；
 *   · **每个选项于一局游戏内选择次数上限为 1**；
 *   · 当**所有选项**的选择次数均达到上限时，**重置所有选项**的选择次数。
 *
 * 技能写法：
 *   {
 *     fouji: {
 *       options: [
 *         { id: 'a', name: '选项一', run: async (ctx) => {...} },
 *         { id: 'b', name: '选项二', run: async (ctx) => {...} },
 *       ],
 *     },
 *   }
 * 每种选项一局各只能选 1 次；全部选过一遍后统一重置。
 */

/** 取某技能的否极选项目前哪些可用 */
export function foujiAvailableOptions(player, skill) {
  const opts = (skill && skill.fouji && skill.fouji.options) || [];
  const used = (player.storage && player.storage[`fouji_${skill.id}`]) || {};
  return opts.filter((o) => !used[o.id]);
}

/** 该否极技是否所有选项都已用完（即需要重置） */
export function foujiAllUsed(player, skill) {
  const opts = (skill && skill.fouji && skill.fouji.options) || [];
  if (!opts.length) return false;
  const used = (player.storage && player.storage[`fouji_${skill.id}`]) || {};
  return opts.every((o) => used[o.id]);
}

/** 标记某个选项已被选择 */
export function markFoujiUsed(player, skill, optionId) {
  if (!player || !skill) return;
  player.storage = player.storage || {};
  const key = `fouji_${skill.id}`;
  const used = player.storage[key] || {};
  used[optionId] = true;
  player.storage[key] = used;
  return used;
}

/** 重置所有选项的选择次数 */
export function resetFouji(player, skill) {
  if (!player || !skill) return;
  player.storage = player.storage || {};
  player.storage[`fouji_${skill.id}`] = {};
  if (player.game) {
    player.game.log(`【否极】${skill.name} 的选项已全部重置`);
    player.game.emit();
  }
}

/**
 * 选择并执行一个否极选项
 * ------------------------------------------------------------------
 * 自动处理「全部选完 → 重置」的逻辑。
 *
 * @param {object} ctx { player, game, skill, ... }
 * @param {Function} chooser 选择函数：(available, ctx) => option | null
 * @returns {Promise<object|null>} 实际执行的选项
 */
export async function useFouji(ctx, chooser) {
  const { player, skill, game } = ctx;
  if (!player || !skill) return null;

  // 若全部选项都已用完，先重置
  if (foujiAllUsed(player, skill)) {
    resetFouji(player, skill);
  }

  const available = foujiAvailableOptions(player, skill);
  if (!available.length) return null;

  let picked = null;
  if (typeof chooser === 'function') {
    picked = await chooser(available, ctx);
  } else {
    picked = available[0];
  }
  if (!picked) return null;

  markFoujiUsed(player, skill, picked.id);
  if (game) game.log(`${player.name} 选择了【${skill.name}】的${picked.name || picked.id}`);

  if (typeof picked.run === 'function') {
    await picked.run({ ...ctx, option: picked });
  }
  return picked;
}

/* ============================================================
 * T. 契定技（官方机制）
 * ============================================================
 * 无名杀依据（`library/poptip.js` 的 `sxrm_qidingSkill`）：
 *   原文：「一种技能标签。**发动一次后**，此技能『契定技』的标签
 *          改为『锁定技』并**删除技能描述中的「可以」**。」
 *
 * 判定函数见 `get/is.js` 的 `qidingSkill(skill, player)`：
 *   支持布尔值或函数（函数返回 true 表示当前**仍处于契定状态**）。
 */

/** 该技能此刻是否仍为「契定技」（未发动过） */
export function isQidingSkill(player, skill) {
  if (!player || !skill) return false;
  const q = skill.qidingSkill;
  if (typeof q === 'function') {
    try { return !!q(skill.id || skill, player); } catch { return false; }
  }
  if (q === undefined) return false;
  if (!q) return false;
  // 已发动过 → 不再是契定技（已转为锁定技）
  return !isQidingUsed(player, skill);
}

/** 该契定技是否已发动过 */
export function isQidingUsed(player, skill) {
  if (!player || !skill) return false;
  const key = `qiding_${skill.id}`;
  return !!(player.storage && player.storage[key]);
}

/**
 * 发动契定技后的处理（对照无名杀的两条效果）
 *   ① 「契定技」标签 → 「锁定技」
 *   ② 删除技能描述中的「可以」
 */
export function markQidingUsed(player, skill) {
  if (!player || !skill) return;
  player.storage = player.storage || {};
  player.storage[`qiding_${skill.id}`] = true;
  if (player.game) {
    player.game.log(`【契定】${skill.name} 已发动，转为锁定技`);
    player.game.emit();
  }
  return true;
}

/**
 * 取「转为锁定技之后」的技能描述
 * ------------------------------------------------------------------
 * 即把描述里的「可以」全部删去（无名杀原文：
 * 「删除技能描述中的『可以』」）。
 * 注意只删「可以」二字，其余文字原样保留。
 */
export function qidingLockedDesc(skill) {
  if (!skill) return '';
  return String(skill.desc || '').replace(/可以/g, '');
}

/**
 * 该技能此刻是否应被视为锁定技
 * （原本 locked，或原本是契定技但已发动过）
 */
export function isQidingLocked(player, skill) {
  if (!skill) return false;
  if (skill.locked) return true;
  if (skill.qidingSkill && isQidingUsed(player, skill)) return true;
  return false;
}

/* ============================================================
 * U. 熔铸（本项目新增）
 * ============================================================
 * 需求方给定：将**对应数量的牌弃置**后，**摸一张牌**。
 *   （注意与官方「重铸」的区别：重铸是弃 N 张摸 N 张；
 *     熔铸是不论弃几张，都只摸 1 张。）
 */

/**
 * 熔铸
 * @param {Player} player
 * @param {Card[]} cards 要弃置的牌
 * @param {object} [opts]
 * @param {number} [opts.draw=1] 摸牌数（默认 1）
 * @returns {Promise<{discarded:Card[], drawn:Card[]}>}
 */
export async function meltCast(player, cards, opts = {}) {
  const { draw: drawNum = 1 } = opts;
  const g = player && player.game;
  const list = normalizeList(cards).filter(Boolean);
  if (!g || !list.length) return { discarded: [], drawn: [] };

  g.log(`${player.name} 熔铸 ${list.length} 张牌`
    + `（${list.map((c) => c.text).join('、')}）`);
  await player.discard(list);
  const drawn = await player.draw(drawNum);
  g.log(`${player.name} 熔铸后摸了 ${(drawn || []).length} 张牌`);
  g.emit();
  return { discarded: list, drawn: drawn || [] };
}

