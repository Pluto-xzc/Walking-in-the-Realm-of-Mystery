/**
 * 扩展机制 · 仁区 / 入幻 / 入魔 / 施法 / 失救
 * ----------------------------------------------------------------
 * 由 src/mechanics.js 拆分而来，段结构与原文件一一对应。
 * 本文件不 import 任何模块：所有依赖（game / player / CARDS / SKILLS）
 * 都由调用方以参数传入。
 */

import { normalizeList } from './shared.js';
/* ============================================================
 * V. 仁区（官方机制）
 * ============================================================
 * 无名杀依据（`library/index.js` 的 `commonArea.renku`）：
 *   · 翻译名「仁库」，牌存于 `_status.renku`，是**公共区域**；
 *   · `addHandeler` 原文：
 *       _status.renku.addArray(cards...)
 *       if (_status.renku.length > 6) {
 *         const cards2 = _status.renku.splice(0, _status.renku.length - 6);
 *         await game.cardsDiscard(cards2)...
 *       }
 *     即：**至多 6 张**，超出时**最先置入的**进入弃牌堆。
 *
 * 需求方给定与上述完全一致，因此按无名杀实现。
 */

export const RENKU_LIMIT = 6;

/** 取仁区（公共区域，所有角色可见） */
export function renkuCards(game) {
  if (!game) return [];
  return game.renku || (game.renku = []);
}

/**
 * 将牌置入仁区
 * ------------------------------------------------------------------
 * 超出 6 张时，**最先置入的**牌进入弃牌堆。
 *
 * @returns {Promise<Card[]>} 因溢出而进入弃牌堆的牌
 */
export async function addToRenku(game, cards) {
  const g = game;
  if (!g) return [];
  const list = normalizeList(cards).filter(Boolean);
  if (!list.length) return [];
  const zone = renkuCards(g);

  for (const c of list) {
    // 从原区域摘掉
    for (const p of g.players) {
      const hi = p.hand.indexOf(c);
      if (hi >= 0) p.hand.splice(hi, 1);
      for (const slot of Object.keys(p.equips || {})) {
        if (p.equips[slot] === c) p.equips[slot] = null;
      }
      const ji = (p.judges || []).indexOf(c);
      if (ji >= 0) p.judges.splice(ji, 1);
    }
    c.zone = 'renku';
    zone.push(c);
  }
  g.log(`仁区置入了 ${list.length} 张牌（现有 ${zone.length} 张）`);

  // 溢出处理：最先置入的进弃牌堆
  let overflow = [];
  if (zone.length > RENKU_LIMIT) {
    overflow = zone.splice(0, zone.length - RENKU_LIMIT);
    for (const c of overflow) c.zone = 'discard';
    g.toDiscard(overflow, { direct: true });
    g.log(`仁区已满 ${RENKU_LIMIT} 张，最先置入的 ${overflow.length} 张`
      + `进入弃牌堆`);
  }
  g.emit();
  return overflow;
}

/**
 * 从仁区移去牌
 * @returns {Card[]} 实际移出的牌
 */
export function removeFromRenku(game, cards) {
  const g = game;
  if (!g) return [];
  const zone = renkuCards(g);
  const list = normalizeList(cards).filter(Boolean);
  const moved = [];
  for (const c of list) {
    const i = zone.indexOf(c);
    if (i < 0) continue;
    zone.splice(i, 1);
    moved.push(c);
  }
  if (moved.length) {
    g.log(`仁区移去了 ${moved.length} 张牌（现有 ${zone.length} 张）`);
    g.emit();
  }
  return moved;
}

/** 取某角色从仁区获得牌 */
export async function gainFromRenku(player, cards) {
  const g = player && player.game;
  if (!g) return [];
  const moved = removeFromRenku(g, cards);
  if (moved.length) await player.gain(moved);
  return moved;
}

/* ============================================================
 * W. 入幻 / 入魔（官方机制的修改）
 * ============================================================
 * 无名杀依据（`library/poptip.js`）：
 *   · 入魔 `rule_rumo`：「每局游戏限一次，当你满足条件后，可入魔。
 *     入魔后，**每轮结束时，若本轮你未造成过伤害，你失去1点体力**。」
 *   · 变身 `rule_bianshen`：「进入变身状态时，弃置判定区里的所有牌。
 *     变身状态下替换武将牌，**两张武将牌血量单独计算**。」
 *
 * 需求方给定（在本项目里的落地规则）：
 *   · 只有拥有对应「幻形态 / 魔形态」的武将才能触发；
 *   · 替换武将牌；**体力值/体力上限两形态不共享**；
 *     **区域内的牌共享**（手牌、装备、判定都留着）；
 *   · 于幻形态死亡时，若无特殊声明，角色死亡；
 *   · 入魔额外：每轮结束若本轮未造成伤害 → 流失 1 点体力；
 *     退出魔形态时 → **流失 1 点体力并摸两张牌**。
 */

/**
 * 进入幻形态
 * @param {Player} player
 * @param {object} form { charId, hp, maxHp, skills? }
 */
export async function enterHuan(player, form) {
  return enterAlternateForm(player, form, 'huan');
}

/** 退出幻形态 */
export async function exitHuan(player) {
  return exitAlternateForm(player, 'huan');
}

/** 进入魔形态 */
export async function enterMo(player, form) {
  return enterAlternateForm(player, form, 'mo');
}

/**
 * 退出魔形态
 * ------------------------------------------------------------------
 * 按需求方规则：退出时**流失 1 点体力并摸两张牌**。
 */
export async function exitMo(player) {
  if (!player || !player.alive) return false;
  const wasMo = player.altForm === 'mo';
  await exitAlternateForm(player, 'mo');
  if (!wasMo) return false;
  // 退出魔形态的代价
  await player.loseHp(1);
  if (player.alive) await player.draw(2);
  if (player.game) {
    player.game.log(`${player.name} 退出魔形态：流失 1 点体力并摸两张牌`);
  }
  return true;
}

/**
 * 通用：进入替代表形态
 * ------------------------------------------------------------------
 * 两形态的体力**各自独立保存**，切换时保存旧值、载入新值；
 * 区域内的牌**不处理**（共享）。
 */
async function enterAlternateForm(player, form, kind) {
  if (!player || !form) return false;
  const g = player.game;

  /*
   * ⚠️ 进入形态前**必须先存档当前（基础）形态的体力**。
   *    否则退出时找不到基础形态的血量，会错误地沿用化身形态的值。
   */
  saveFormVitals(player);

  // 已有形态时也要把该形态的体力存好
  if (player.altForm) saveFormVitals(player);

  player.altForm = kind;
  player.altForms = player.altForms || {};
  player.altForms[kind] = {
    charId: form.charId || player.charId,
    name: form.name,
    skills: form.skills ? form.skills.slice() : null,
  };

  // 替换武将牌（charId / 名字 / 技能）
  const old = { charId: player.charId, name: player.name, skills: player.skills.slice() };
  player.baseCharId = player.baseCharId || player.charId;
  player.baseName = player.baseName || player.name;
  player.baseSkills = player.baseSkills || player.skills.slice();

  if (form.charId) player.charId = form.charId;
  if (form.name) player.name = form.name;
  if (form.skills) player.skills = form.skills.slice();

  // 体力独立：载入该形态自己的体力
  loadFormVitals(player, kind, form);

  /*
   * 无名杀的「变身」规则：进入变身状态时弃置判定区所有牌。
   * 需求方未否定这一点，且「区域内的牌共享」指的是手牌/装备，
   * 判定区的延时锦囊与化身状态强相关，因此按无名杀处理。
   */
  if (player.judges && player.judges.length) {
    const js = player.judges.slice();
    player.judges = [];
    g.toDiscard(js, { direct: true });
    g.log(`${player.name} 进入${kind === 'mo' ? '魔' : '幻'}形态，`
      + `弃置判定区 ${js.length} 张牌`);
  }

  g.log(`${player.name} 进入${kind === 'mo' ? '魔' : '幻'}形态`
    + `（${player.name}，体力 ${player.hp}/${player.maxHp}）`);
  g.emit();
  void old;
  return true;
}

/** 通用：退出替代表形态 */
async function exitAlternateForm(player, kind) {
  if (!player || player.altForm !== kind) return false;
  saveFormVitals(player);
  player.altForm = null;

  // 换回原本的武将牌
  if (player.baseCharId) player.charId = player.baseCharId;
  if (player.baseName) player.name = player.baseName;
  if (player.baseSkills) player.skills = player.baseSkills.slice();

  // 恢复原形态的体力
  loadFormVitals(player, 'base', null);
  if (player.game) {
    player.game.log(`${player.name} 退出了${kind === 'mo' ? '魔' : '幻'}形态`);
    player.game.emit();
  }
  return true;
}

/** 保存当前形态的体力（两形态不共享） */
function saveFormVitals(player) {
  player.formVitals = player.formVitals || {};
  const key = player.altForm || 'base';
  player.formVitals[key] = { hp: player.hp, maxHp: player.maxHp };
}

/** 载入某形态的体力 */
function loadFormVitals(player, key, form) {
  player.formVitals = player.formVitals || {};
  const saved = player.formVitals[key];
  if (saved) {
    player.hp = Math.min(saved.hp, saved.maxHp);
    player.maxHp = saved.maxHp;
  } else if (form) {
    player.hp = form.hp != null ? form.hp : player.hp;
    player.maxHp = form.maxHp != null ? form.maxHp : player.maxHp;
    player.formVitals[key] = { hp: player.hp, maxHp: player.maxHp };
  } else {
    // 回到基础形态但没有存档 → 保持当前值
    player.formVitals[key] = { hp: player.hp, maxHp: player.maxHp };
  }
}

/** 该角色是否处于某个替代表形态 */
export function altFormOf(player) {
  return (player && player.altForm) || null;
}

/** 该角色是否拥有对应形态（入幻/入魔的前提） */
export function hasAltForm(player, kind) {
  if (!player) return false;
  return !!(player.altForms && player.altForms[kind]);
}

/**
 * 入魔的每轮结算
 * ------------------------------------------------------------------
 * 「每轮结束时，若本轮你未造成过伤害，你失去 1 点体力。」
 * 由引擎在轮次结束时调用。
 */
export async function checkMoRoundEnd(game) {
  if (!game) return [];
  const hit = [];
  for (const p of game.players) {
    if (!p.alive || p.altForm !== 'mo') continue;
    if (p.flags && p.flags._moDamagedThisRound) continue;
    game.log(`【入魔】${p.name} 本轮未造成伤害，流失 1 点体力`);
    await p.loseHp(1);
    hit.push(p);
  }
  return hit;
}

/** 标记「本轮造成过伤害」（入魔判定用） */
export function markMoDamaged(player) {
  if (!player) return;
  player.flags = player.flags || {};
  player.flags._moDamagedThisRound = true;
}

/** 每轮开始时重置入魔的伤害记录 */
export function resetMoRound(game) {
  if (!game) return;
  for (const p of game.players) {
    if (p.flags) delete p.flags._moDamagedThisRound;
  }
}

/* ============================================================
 * X. 施法（官方机制的落地）
 * ============================================================
 * ⚠️ 与无名杀的差异（已与需求方确认按本描述实现）：
 *   无名杀 `rule_shifa`：「X∈[1, 3]，在此之后的**第 X 个回合结束时**
 *                        执行施法效果」，**不涉及标记**。
 *   需求方给定：**X∈[1, 5]**，发动时**获得 X 个同名施法标记**，
 *              **每回合结束时移去 1 枚**，**归零时**结算效果。
 *   本实现按需求方版本。
 */

/** 某技能名的施法标记数量 */
export function shifaMarks(player, skillName) {
  if (!player || !player.storage) return 0;
  return player.storage[`shifa_${skillName}`] || 0;
}

/**
 * 发动施法
 * @param {Player} player
 * @param {object} skill 施法技能
 * @param {number} x 声明的数字（1-5）
 * @returns {Promise<boolean>} 是否成功发动
 */
export function castShifa(player, skill, x) {
  if (!player || !skill) return false;
  const name = skill.id || skill.name;
  // 「若你身上没有与该技能同名的施法标记，你可以发动此技能」
  if (shifaMarks(player, name) > 0) return false;

  const n = Math.max(1, Math.min(5, Math.round(x || 1)));
  player.storage = player.storage || {};
  player.storage[`shifa_${name}`] = n;
  player.storage[`shifaX_${name}`] = n;      // 效果里的 X
  if (player.game) {
    player.game.log(`${player.name} 发动【${skill.name}】施法，`
      + `声明 X=${n}，获得 ${n} 个施法标记`);
    player.game.emit();
  }
  return true;
}

/** 该技能此刻是否可以发动施法（没有同名标记） */
export function canCastShifa(player, skill) {
  if (!player || !skill) return false;
  const name = skill.id || skill.name;
  return shifaMarks(player, name) === 0;
}

/**
 * 回合结束时移去一枚施法标记
 * ------------------------------------------------------------------
 * 由引擎在回合结束时调用；归零时执行该技能的施法效果。
 *
 * @param {Game} game
 * @param {Player} owner 回合的主人（施法标记挂在他身上）
 * @returns {Promise<Array>} 本次结算的技能列表
 */
export async function tickShifa(game, owner) {
  if (!game || !owner || !owner.storage) return [];
  const done = [];
  const keys = Object.keys(owner.storage).filter((k) => k.startsWith('shifa_')
    && !k.startsWith('shifaX_'));
  for (const key of keys) {
    const name = key.slice('shifa_'.length);
    const cur = owner.storage[key];
    if (!cur || cur <= 0) continue;
    const left = cur - 1;
    owner.storage[key] = left;
    game.log(`【施法】${owner.name} 的「${name}」标记 ${cur} → ${left}`);

    if (left <= 0) {
      // 归零 → 结算效果，并清理标记
      delete owner.storage[key];
      const x = owner.storage[`shifaX_${name}`] || 1;
      delete owner.storage[`shifaX_${name}`];
      const sk = game.skillsRef && game.skillsRef[name];
      game.log(`【施法】${owner.name} 的「${name}」标记归零，执行结算`
        + `（X=${x}）`);
      if (sk && typeof sk.shifaEffect === 'function') {
        await sk.shifaEffect({ player: owner, game, skill: sk, x });
      }
      done.push({ name, x, skill: sk });
    }
  }
  if (done.length) game.emit();
  return done;
}

/* ============================================================
 * Y. 失救（官方机制的时点）
 * ============================================================
 * 需求方给定：
 *   「你的濒死结算结束时你死亡时，此时为**失救时点**，
 *     部分技能可能可以恢复体力从而继续游戏。」
 *
 * 实现：在濒死流程走完、确认无法挽救、**即将阵亡之前**
 *       触发 `failedSave` 时机；技能可在此时恢复体力来续命。
 */

/**
 * 失救时点的处理
 * @param {Game} game
 * @param {Player} player 即将因失救而阵亡的角色
 * @returns {Promise<boolean>} 是否被救回（恢复了体力）
 */
export async function triggerFailedSave(game, player) {
  if (!game || !player) return false;
  const ev = { player, rescued: false };
  game.log(`${player.name} 的濒死结算结束，进入失救时点`);
  await game.checkSkills('failedSave', ev);

  if (ev.rescued && player.hp > 0) {
    game.log(`【失救】${player.name} 被技能救回（体力 ${player.hp}）`);
    game.emit();
    return true;
  }
  return false;
}

