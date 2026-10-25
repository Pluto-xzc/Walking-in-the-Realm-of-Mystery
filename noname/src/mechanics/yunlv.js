/**
 * 扩展机制 · 韵律技 / 溢出体力
 * ----------------------------------------------------------------
 * 由 src/mechanics.js 拆分而来，段结构与原文件一一对应。
 * 本文件不 import 任何模块：所有依赖（game / player / CARDS / SKILLS）
 * 都由调用方以参数传入。
 */
/* ============================================================
 * AE. 韵律技（转换技的变种）
 * ============================================================
 * ⚠️ 核实说明：无名杀**没有「韵律技」**，只有「转换技」（`zhuanhuanji`）。
 *    转换技是**每次发动后自动切换选项**；
 *    需求方要求：韵律技的**选项变更条件变为达成「转韵」条件**，
 *    且该条件**由技能自己声明**（每个角色都不同）。
 *
 * 技能写法：
 *   {
 *     yunlv: {
 *       options: ['选项一', '选项二'],
 *       // 「转韵」条件：返回 true 时切换选项
 *       // 例：转韵：你使用红色锦囊牌
 *       zhuanYun: (ctx) => ctx.event?.card?.color === 'red'
 *         && ctx.event?.card?.type === 'trick',
 *     },
 *   }
 */

/** 取韵律技当前生效的选项下标 */
export function yunlvIndex(player, skill) {
  if (!player || !skill) return 0;
  const key = `yunlv_${skill.id}`;
  const n = (player.storage && player.storage[key]) | 0;
  const len = ((skill.yunlv && skill.yunlv.options) || []).length || 1;
  return ((n % len) + len) % len;
}

/** 取韵律技当前生效的选项 */
export function yunlvCurrent(player, skill) {
  const opts = (skill && skill.yunlv && skill.yunlv.options) || [];
  if (!opts.length) return null;
  return opts[yunlvIndex(player, skill)];
}

/** 切换韵律技的选项 */
export function changeYunlv(player, skill) {
  if (!player || !skill) return false;
  player.storage = player.storage || {};
  const key = `yunlv_${skill.id}`;
  const len = ((skill.yunlv && skill.yunlv.options) || []).length || 1;
  const next = (((player.storage[key] | 0) + 1) % len + len) % len;
  player.storage[key] = next;
  if (player.game) {
    player.game.log(`【韵律】${skill.name} 转换到「`
      + `${(skill.yunlv.options[next])}」`);
    player.game.emit();
  }
  return true;
}

/**
 * 检查「转韵」条件是否达成，达成则切换选项
 * ------------------------------------------------------------------
 * 由引擎在每个技能时机结算后调用（与昂扬技同一位置）。
 */
export function tryZhuanYun(game, player, event) {
  if (!game || !player) return false;
  let changed = false;
  for (const sid of player.skills || []) {
    const sk = game.skillsRef && game.skillsRef[sid];
    if (!sk || !sk.yunlv) continue;
    const fn = sk.yunlv.zhuanYun;
    if (typeof fn !== 'function') continue;
    let ok = false;
    try {
      ok = !!fn({ player, game, event, skill: sk });
    } catch { ok = false; }
    if (ok) {
      changeYunlv(player, sk);
      changed = true;
    }
  }
  return changed;
}

/* ============================================================
 * AF. 溢出体力（本项目新增）
 * ============================================================
 * 需求方给定：**恢复的溢出值变为等量护甲**。
 *   例：3/4 体力回复 3 点 → 4/4，溢出的 2 点变成 2 点护甲。
 *
 * 实现位置：`Player.recover()`（见 engine.js），
 * 判定条件为角色的 `hpOverflow` 标记。
 * 本处提供开关与计算工具。
 */

/** 授予 / 取消「溢出体力」机制 */
export function setHpOverflow(player, on = true) {
  if (!player) return false;
  player.hpOverflow = !!on;
  if (player.game) {
    player.game.log(`${player.name}${on ? '获得' : '失去'}了【溢出体力】`);
    player.game.emit();
  }
  return true;
}

export function hasHpOverflow(player) {
  return !!(player && player.hpOverflow);
}

/**
 * 计算一次回复会产生多少溢出
 * （纯函数，便于测试与 UI 预览）
 */
export function calcOverflow(hp, maxHp, recoverNum) {
  const healed = Math.max(0, Math.min(maxHp, hp + recoverNum) - hp);
  return Math.max(0, recoverNum - healed);
}

