/**
 * 扩展机制 · 转化 / 周始 / 阵法技
 * ----------------------------------------------------------------
 * 由 src/mechanics.js 拆分而来，段结构与原文件一一对应。
 * 本文件不 import 任何模块：所有依赖（game / player / CARDS / SKILLS）
 * 都由调用方以参数传入。
 */

import { noteHpChange } from './inquiry.js';
/* ============================================================
 * AG. 转化（本项目新增）
 * ============================================================
 * 需求方给定：通常用于**体力值、护甲、已损体力值**的相互转化。
 *   · 该操作**不视为**受到伤害、失去体力、恢复体力；
 *   · 但**可视为体力值变化**（即记为 HP_CHANGE_KINDS 的 convert）。
 *
 * 三种可转化的资源：
 *   hp      当前体力值
 *   hujia   护甲
 *   lostHp  已损体力值（= maxHp - hp，不是独立数值，而是「空上限」）
 */

/** 三种可转化资源 */
export const CONVERT_RESOURCES = ['hp', 'hujia', 'lostHp'];

/** 读某角色某项资源的当前值 */
export function readResource(player, res) {
  if (!player) return 0;
  if (res === 'hp') return player.hp;
  if (res === 'hujia') return player.hujia || 0;
  if (res === 'lostHp') return Math.max(0, (player.maxHp || 0) - (player.hp || 0));
  return 0;
}

/**
 * 通用转化：把 `from` 的 num 点转为 `to` 的 num 点
 * ------------------------------------------------------------------
 * ⚠️ 关键约束（需求方明确要求）：
 *   本操作**不视为**受到伤害 / 失去体力 / 恢复体力，
 *   因此绝不调用 damage / loseHp / recover，
 *   只直接调整数值，并记一条 `convert` 的体力变化。
 *
 * 语义：从 from 扣 num，给 to 加 num（受各自上限约束）。
 *
 * @returns {Promise<{moved:number, from:number, to:number}>}
 */
export async function convertResource(player, from, to, num) {
  if (!player || !player.alive) return { moved: 0, from: 0, to: 0 };
  const g = player.game;
  if (from === to) return { moved: 0, from: 0, to: 0 };

  const avail = readResource(player, from);
  const n = Math.max(0, Math.min(num, avail));
  if (!n) return { moved: 0, from: 0, to: 0 };

  const hpBefore = player.hp;
  applyResource(player, from, -n);
  applyResource(player, to, n);

  if (g) {
    const label = { hp: '体力值', hujia: '护甲', lostHp: '已损体力值' };
    g.log(`【转化】${player.name} 将 ${n} 点${label[from]}`
      + `转化为 ${n} 点${label[to]}`
      + `（不视为回复/失去/伤害）`);
    // 可视为体力值变化
    if (from === 'hp' || to === 'hp') {
      noteHpChange(g, player, 'convert', n, hpBefore);
    }
    g.emit();
  }
  return { moved: n, from: avail, to: readResource(player, to) };
}

/** 直接对某项资源加减（内部用；不做任何时机触发） */
function applyResource(player, res, delta) {
  if (res === 'hp') {
    // 体力受 [0, maxHp] 约束；允许降到 0（由调用方决定是否走濒死）
    player.hp = Math.max(0, Math.min(player.maxHp, player.hp + delta));
  } else if (res === 'hujia') {
    player.hujia = Math.max(0, (player.hujia || 0) + delta);
    player.maxHujia = Math.max(player.maxHujia || 0, player.hujia);
  } else if (res === 'lostHp') {
    /*
     * 「已损体力值」= maxHp - hp，不是独立数值。
     *
     * 对它 **-n**（消耗/转化掉 n 点已损）→ 空缺变小 → **降低体力上限** n 点。
     * 对它 **+n**（获得 n 点已损）→ 空缺变大 → **提高体力上限** n 点。
     *
     * 推导：lostHp = maxHp - hp。要让 lostHp 减少 n，而 hp 不动，
     *       则 maxHp 也必须减少 n。所以 maxHp += delta（delta 本身就是 -n）。
     *
     * ⚠️ 无论增还是减，都**不能直接改 hp**，否则会与「已损」的定义打架。
     */
    player.maxHp = Math.max(1, player.maxHp + delta);
    // 上限降低后体力不能超过新上限
    player.hp = Math.min(player.hp, player.maxHp);
  }
}

/**
 * 便捷写法：已损体力值 → 护甲（需求方最常提的一种用法）
 */
export function lostHpToHujia(player, num) {
  return convertResource(player, 'lostHp', 'hujia', num);
}

/** 便捷写法：护甲 → 体力 */
export function hujiaToHp(player, num) {
  return convertResource(player, 'hujia', 'hp', num);
}

/* ============================================================
 * AH. 周始（本项目新增）
 * ============================================================
 * 需求方给定：
 *   · 当**转化技或韵律技**从第一项按顺序使用到**最后一项**，
 *     在最后一项的效果结算后，触发「周始」效果；
 *   · 特别的，**韵律技仅在最后一项第一次结算后触发**，
 *     须**重新变至第一项刷新**；
 *   · **未触发效果的转换不算使用**。
 *
 * 实现：为每个技能维护一个「本轮已跑到第几项」的游标。
 *   · 每次**实际结算**了某项后，游标 = 该项下标 + 1；
 *   · 游标达到选项总数 → 触发周始，并复位；
 *   · 韵律技额外用 `zhouShiFired` 标记「最后一项第一次结算后」，
 *     只有 `changeYunlv` 回到第 0 项时才清除该标记（重新刷新）。
 */

/**
 * 记录某技能某项「被实际结算」（未触发效果的转换不算使用）
 * @param {Game} game
 * @param {Player} player
 * @param {object} skill
 * @param {number} optionIndex 实际结算的选项下标
 * @returns {Promise<boolean>} 是否触发了周始
 */
export async function noteOptionResolved(game, player, skill, optionIndex) {
  if (!game || !player || !skill) return false;
  const opts = optionCount(skill);
  if (!opts) return false;

  player.storage = player.storage || {};
  const key = `zhou_${skill.id}`;
  // 只有「按顺序推进」才算：必须正好是当前应结算的那一项
  const cursor = player.storage[key] | 0;
  if (optionIndex !== cursor) {
    // 跳项不算「按顺序使用到最后一项」，游标不推进
    return false;
  }
  const next = cursor + 1;
  player.storage[key] = next;

  game.log(`【周始】${skill.name} 第 ${next}/${opts} 项已结算`);

  if (next < opts) return false;

  // 跑完最后一项 → 触发周始
  player.storage[key] = 0;               // 复位
  if (!skill.zhouShi) {
    // 没声明周始效果的技能，只复位
    return false;
  }

  /*
   * 韵律技的特殊限制：**仅在最后一项第一次结算后触发**，
   * 须重新变至第一项刷新。
   */
  if (skill.yunlv) {
    const flag = `zhouFired_${skill.id}`;
    if (player.storage[flag]) return false;   // 本次循环已触发过
    player.storage[flag] = true;
  }

  game.log(`【周始】${player.name} 的【${skill.name}】跑完所有选项，`
    + `触发周始效果`);
  if (typeof skill.zhouShi === 'function') {
    await skill.zhouShi({ player, game, skill });
  }
  game.emit();
  return true;
}

/** 选项数量 */
function optionCount(skill) {
  if (!skill) return 0;
  const y = (skill.yunlv && skill.yunlv.options) || [];
  if (y.length) return y.length;
  const z = (skill.zhuanhuanji && skill.zhuanhuanji.options) || [];
  if (z.length) return z.length;
  if (Array.isArray(skill.options)) return skill.options.length;
  return 0;
}

/** 取当前周始游标（便于测试/UI） */
export function zhouShiCursor(player, skill) {
  if (!player || !skill || !player.storage) return 0;
  return player.storage[`zhou_${skill.id}`] | 0;
}

/** 韵律技变回第一项时，清除周始的已触发标记（刷新） */
export function refreshZhouShi(player, skill) {
  if (!player || !skill || !player.storage) return;
  delete player.storage[`zhouFired_${skill.id}`];
}

/* ============================================================
 * AI. 阵法技（X/Y）（本项目新增）
 * ============================================================
 * ⚠️ 核实说明：无名杀的「阵法技」是**国战专用**的
 *   （`mode/guozhan/.../poptip.js`：「在存活角色数不小于 4 时锁定生效」），
 *   与本机制的「术法」完全无关。因此本机制按需求方描述实现。
 *
 * 需求方给定：技能标签，写作 **阵法技（X/Y）**——
 *   · 初始拥有 X 点术法，最高拥有 Y 点术法；
 *   · 默认两个增加术法的时机：**每轮结束后**、**自己用【桃】回复体力**；
 *   · 部分技能可自行添加别的时机（预留接口）。
 */

/** 取某技能的术法上限配置（X/Y） */
export function zhanfaConfig(skill) {
  if (!skill) return null;
  const z = skill.zhenfa;
  if (!z) return null;
  if (typeof z === 'object') {
    return {
      init: z.init != null ? z.init : (z.x != null ? z.x : 0),
      max: z.max != null ? z.max : (z.y != null ? z.y : 0),
    };
  }
  return { init: 0, max: 0 };
}

/** 取当前术法点数 */
export function shufaCount(player, skill) {
  if (!player || !skill || !player.storage) return 0;
  return player.storage[`shufa_${skill.id}`] | 0;
}

/** 设置术法点数（自动夹在 [0, Y]） */
export function setShufa(player, skill, n) {
  if (!player || !skill) return 0;
  const cfg = zhanfaConfig(skill);
  const max = cfg ? cfg.max : 0;
  player.storage = player.storage || {};
  const v = Math.max(0, Math.min(max, n));
  player.storage[`shufa_${skill.id}`] = v;
  if (player.game) {
    const markKey = `shufaMark_${skill.id}`;
    player.storage[markKey] = v;
    player.game.emit();
  }
  return v;
}

/**
 * 增加术法点数
 * @param {boolean} [opts.silent] 不写日志（批量时用）
 */
export function addShufa(player, skill, n = 1, opts = {}) {
  if (!player || !skill) return 0;
  const cfg = zhanfaConfig(skill);
  if (!cfg) return 0;
  const cur = shufaCount(player, skill);
  const v = setShufa(player, skill, cur + n);
  if (!opts.silent && player.game && v !== cur) {
    player.game.log(`【阵法技】${player.name} 的【${skill.name}】术法 `
      + `${cur} → ${v}（上限 ${cfg.max}）`);
  }
  return v;
}

/** 初始化术法（技能获得时调用） */
export function initShufa(player, skill) {
  const cfg = zhanfaConfig(skill);
  if (!cfg) return 0;
  return setShufa(player, skill, cfg.init);
}

/**
 * 默认的两个增加时机
 * ------------------------------------------------------------------
 * ① 每轮结束后
 * ② 自己用【桃】回复体力时
 * 由引擎在对应位置调用。
 */
export function tickZhanfaRoundEnd(game) {
  if (!game) return [];
  const hit = [];
  for (const p of game.players) {
    if (!p.alive) continue;
    for (const sid of p.skills || []) {
      const sk = game.skillsRef && game.skillsRef[sid];
      if (!sk || !sk.zhenfa) continue;
      const cur = shufaCount(p, sk);
      const after = addShufa(p, sk);
      if (after !== cur) hit.push({ player: p, skill: sk, value: after });
    }
  }
  return hit;
}

/** 自己用【桃】回复体力时增加术法 */
export function tickZhanfaOnTao(player) {
  if (!player || !player.game) return [];
  const hit = [];
  for (const sid of player.skills || []) {
    const sk = player.game.skillsRef && player.game.skillsRef[sid];
    if (!sk || !sk.zhenfa) continue;
    const cur = shufaCount(player, sk);
    const after = addShufa(player, sk);
    if (after !== cur) hit.push({ player, skill: sk, value: after });
  }
  return hit;
}

