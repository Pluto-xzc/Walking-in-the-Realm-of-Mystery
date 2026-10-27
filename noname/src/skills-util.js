/**
 * 技能公共小工具
 * ------------------------------------------------------------------
 * 供技能实现与 UI 共用，不依赖 engine / ui，避免循环引用。
 */

/**
 * 每回合使用次数上限
 * ------------------------------------------------------------------
 * 技能声明 `usable: N` 表示「每回合限 N 次」（N 缺省 / 0 视为不限）。
 * 次数按**回合编号**记账，跨回合自动作废，无需手动清零。
 */
export function skillUseLimit(skill) {
  const n = skill && skill.usable;
  return typeof n === 'number' && n > 0 ? n : Infinity;
}

/** 本回合已用次数 */
export function skillUseCount(player, skill, game) {
  const rec = player.flags && player.flags['skillUse_' + skill.id];
  if (!rec || rec.turn !== game.turnCount) return 0;
  return rec.n || 0;
}

/** 本回合是否已用满 */
export function skillUsedUp(player, skill, game) {
  return skillUseCount(player, skill, game) >= skillUseLimit(skill);
}

/** 记一次使用 */
export function markSkillUsed(player, skill, game) {
  if (!player.flags) player.flags = {};
  const key = 'skillUse_' + skill.id;
  const rec = player.flags[key];
  const n = (rec && rec.turn === game.turnCount) ? (rec.n || 0) : 0;
  player.flags[key] = { turn: game.turnCount, n: n + 1 };
}

/**
 * 本回合额外增加一次可用次数
 * ------------------------------------------------------------------
 * 用于「可用次数 +1」类效果：把本回合已记的次数**退回一次**，
 * 于是 skillUsedUp 重新变回 false。本回合还没用过时无需处理。
 */
export function grantExtraSkillUse(player, skill, game) {
  if (!player.flags) return;
  const rec = player.flags['skillUse_' + skill.id];
  if (!rec || rec.turn !== game.turnCount) return;
  rec.n = Math.max(0, (rec.n || 0) - 1);
}