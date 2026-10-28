/**
 * 技能表 · 魔族精兵（山城恋）
 * ------------------------------------------------------------------
 * 单独成表，不塞进 table-expansion.js —— 一个扩展包一张表，
 * 读代码时能一眼定位到某个武将的全部逻辑。
 *
 * 山城恋 4/4，势力「魔」，分类「魔族精兵」，称号「万物的顶点」。
 *
 * 【无穷之锁】锁定技
 *   你仅有单侧攻击范围（左/右，开局选择）；
 *   你使用牌时，可改变自身攻击范围后，令之对范围内角色或
 *   变化路径上一名角色额外结算一次。
 *
 * 【总括万物之无限宇宙全一】出牌阶段限一次
 *   执行前两个「可完全执行」的项（按 ①②③④ 顺序取前两个，
 *   不足两个则不能发动）：
 *     ① 使用一张目标为你或攻击范围内角色的牌
 *     ② 明置所有【杀】
 *     ③ 用牌堆顶 5 张牌当手牌的视为使用一张【决斗】
 *     ④ 令下次攻击范围变化后，对变化路径上的任意名角色各造成 1 点伤害
 */

import { CARDS } from '../cards.js';

const SUO = 'wuqiongzhisuo';
const ZONG = 'zongkuo';

/* ============================================================
 * 单侧攻击范围
 * ============================================================ */

/** 该角色是否拥有【无穷之锁】 */
function hasSuo(player) {
  return !!(player && player.skills && player.skills.includes(SUO));
}

/** 当前方向：'left'（上家）/ 'right'（下家） */
export function rangeSideOf(player) {
  const s = player.storage && player.storage.attackSide;
  return s === 'right' ? 'right' : 'left';
}

/** 单侧范围内的其他存活角色（按左→右排列） */
export function sideRangePlayers(game, player, side = rangeSideOf(player)) {
  const alive = game.players.filter((p) => p.alive);
  const me = alive.indexOf(player);
  return player
    .sideRangeTargets(side)
    .map((p) => ({ p, off: signedOffset(alive.indexOf(p) - me, alive.length) }))
    .sort((x, y) => x.off - y.off)
    .map((x) => x.p);
}

/** 环形偏移：正 = 下家（右），负 = 上家（左） */
function signedOffset(raw, n) {
  let d = raw;
  if (d > n / 2) d -= n;
  else if (d < -n / 2) d += n;
  return d;
}

/** 方向的文字 */
function sideLabel(side) {
  return side === 'left' ? '左（上家）' : '右（下家）';
}

/**
 * 改变攻击范围：方向 + 「第 X 个」
 * ------------------------------------------------------------------
 * 规则（需求方给定）：
 *   · 技能声明的范围**不能绕圈找人**，所以 X 最多到「存活人数 - 2」；
 *   · 每次改动，新范围内必须有存活角色（可以被调离，但要在场）。
 * 返回**变化路径**：旧范围最远端 → … → 自己 → … → 新范围最远端。
 */
export async function changeRange(game, player, { silent = false } = {}) {
  const before = rangeSideOf(player);
  const beforePlayers = sideRangePlayers(game, player, before);
  const n = game.players.filter((p) => p.alive).length;
  const maxX = Math.max(1, n - 2);

  const sidePick = await player.chooseOption({
    prompt: '【无穷之锁】：把攻击范围改到哪一侧？',
    options: [
      { key: 'left', label: '左（上家方向）' },
      { key: 'right', label: '右（下家方向）' },
    ],
  });
  const after = sidePick === 'right' ? 'right' : 'left';

  const xPick = await player.chooseOption({
    prompt: `【无穷之锁】：新的范围是第几个角色（最多第 ${maxX} 个）？`,
    options: Array.from({ length: maxX }, (_, i) => ({ key: String(i + 1), label: `第 ${i + 1} 个` })),
  });
  const x = Math.min(maxX, Math.max(1, parseInt(xPick, 10) || 1));

  if (!player.storage) player.storage = {};
  const saved = { side: player.storage.attackSide, x: player.storage.rangeX };
  player.storage.attackSide = after;
  player.storage.rangeX = x;

  const afterPlayers = sideRangePlayers(game, player, after);
  if (!afterPlayers.length) {
    player.storage.attackSide = saved.side;
    player.storage.rangeX = saved.x;
    if (!silent) game.log(`【无穷之锁】${player.name} 的新范围内没有角色，不能改变攻击范围`);
    return null;
  }

  const path = buildPath(game, player, beforePlayers, afterPlayers);
  game.log(`【无穷之锁】${player.name} 的攻击范围改为${sideLabel(after)}第 ${x} 个`
    + `（变化路径：${path.map((p) => p.name).join(' → ')}）`);
  game.emit();

  // 【总括万物】④：范围变化后结算路径伤害
  await afterRangeChanged(game, player, path);
  return { before, after, x, path, beforePlayers, afterPlayers };
}

/** 变化路径：两段范围的并集 + 自己，按座位顺序连成一条弧 */
function buildPath(game, player, a, b) {
  const alive = game.players.filter((p) => p.alive);
  const me = alive.indexOf(player);
  if (me < 0) return [];
  const set = new Set([player, ...a, ...b]);
  const offs = [];
  alive.forEach((p, idx) => {
    if (!set.has(p)) return;
    offs.push({ p, off: signedOffset(idx - me, alive.length) });
  });
  offs.sort((x, y) => x.off - y.off);
  return offs.map((x) => x.p);
}

/* ============================================================
 * 「额外结算一次」：把一张牌对单个角色再结算一遍
 * ============================================================ */

/**
 * 对单个目标重复结算一次 {card} 的效果
 * ------------------------------------------------------------------
 * 只实现有意义的即时牌；装备/延时锦囊没有「对某角色结算」的概念，
 * 这时写一条日志说明，不做任何结算。
 */
export async function extraResolve(game, source, card, target) {
  const name = card && card.name;
  game.log(`【无穷之锁】${card.fullname || name} 对 ${target.name} 额外结算一次`);
  switch (name) {
    case 'sha':
      await target.damage(1, source, 'wuqiongzhisuo', card, card.nature || null);
      break;
    case 'juedou':
      await game.resolveJuedou(source, [target]);
      break;
    case 'guohe':
      await game.resolveGuohe(source, [target]);
      break;
    case 'shunshou':
      await game.resolveShunshou(source, [target]);
      break;
    case 'huogong':
      await game.resolveHuogong(source, [target]);
      break;
    case 'tao':
      await target.recover(1);
      break;
    case 'wuzhong':
      await source.draw(2);
      break;
    case 'nanman':
    case 'wanjian': {
      const needSha = name === 'nanman';
      const ok = needSha
        ? await game.askSha(target, source, name)
        : await game.askShan(target, source, card);
      if (!ok) await target.damage(1, source, name, card);
      break;
    }
    default:
      game.log(`【无穷之锁】${card.fullname || name} 没有可重复结算的效果`);
  }
}

/** 从候选里问一名角色；AI 随机取第一个 */
async function pickOne(game, player, cands, prompt) {
  if (!cands.length) return null;
  if (cands.length === 1) return cands[0];
  const picked = await game.io.chooseTargets(player, {
    prompt, candidates: cands, min: 1, max: 1,
  }).catch(() => null);
  return picked && picked.length ? picked[0] : null;
}

/* ============================================================
 * 总括万物之无限宇宙全一：四个可执行项
 * ============================================================ */

/** ① 可用、且目标落在「你或攻击范围内」的牌 */
function item1Candidates(game, player) {
  const pool = new Set([player, ...sideRangePlayers(game, player)]);
  return (player.hand || []).filter((c) => {
    if (!game.cardUsableNow(player, c)) return false;
    const fixed = game.defaultTargetsFor(player, c);
    if (fixed && fixed.length) return fixed.every((t) => pool.has(t));
    // 需要自己选目标：只要「你或范围内」存在合法目标即可
    return [...pool].some((p) => p.alive && game.canBeTargeted(p, c));
  });
}

/** ② 手牌里有【杀】才可明置 */
function item2Ok(player) {
  return (player.hand || []).some((c) => c.name === 'sha');
}

/** ③ 牌堆够 5 张、且场上还有别人 */
function item3Ok(game, player) {
  return (game.deck || []).length >= 5 && game.players.some((p) => p.alive && p !== player);
}

export default {
  /* ======================= 无穷之锁 ======================= */
  [SUO]: {
    id: SUO, name: '无穷之锁',
    desc: '锁定技，你仅有单侧攻击范围；你使用牌时，可改变自身攻击范围后，'
      + '令之对范围内角色或变化路径上一名角色额外结算一次。',
    type: 'trigger', trigger: 'cardUsedAfter',
    // 锁定技：不询问是否发动
    forced: true,
    filter(ctx) {
      const { player, event } = ctx;
      return !!player.alive && event.player === player && !!event.card;
    },
    async content(ctx) {
      const { player, game, event } = ctx;
      // ① 是否改变攻击范围（可选）
      const before = rangeSideOf(player);
      const after = before === 'left' ? 'right' : 'left';
      const canChange = sideRangePlayers(game, player, after).length > 0;
      let changed = null;
      if (canChange) {
        const ans = await game.io.chooseOption(player,
          `【无穷之锁】是否改变攻击范围（当前${sideLabel(before)}）？`,
          [{ key: 'yes', label: `改为${sideLabel(after)}` },
            { key: 'no', label: '不改变' }]).catch(() => 'no');
        if (ans === 'yes') changed = await changeRange(game, player);
      }

      // ② 额外结算的目标：范围内角色 ∪ 变化路径
      const pool = new Set(sideRangePlayers(game, player));
      if (changed) for (const p of changed.path) pool.add(p);
      pool.delete(player);
      const cands = [...pool].filter((p) => p.alive);
      if (!cands.length) return;

      const chosen = await pickOne(game, player, cands,
        `【无穷之锁】选择一名角色，令【${event.card.fullname}】对其额外结算一次`);
      if (chosen) await extraResolve(game, player, event.card, chosen);
    },
  },

  /* ============ 总括万物之无限宇宙全一 ============ */
  [ZONG]: {
    id: ZONG, name: '总括万物之无限宇宙全一',
    desc: '出牌阶段限一次，你可执行前两个可完全执行项：'
      + '①使用一张目标为你或攻击范围内角色的牌；②明置所有【杀】；'
      + '③用牌堆顶 5 张牌当手牌的视为使用一张【决斗】；'
      + '④令下次攻击范围变化后，对变化路径上的任意名角色各造成 1 点伤害。',
    type: 'active', trigger: 'phaseUse', usable: 1,
    filter(ctx) {
      const { player, game } = ctx;
      if (!game.isInPlayPhase(player)) return false;
      return availableItems(game, player).length >= 2;
    },
    async content(ctx) {
      const { player, game } = ctx;
      const items = availableItems(game, player).slice(0, 2);
      if (items.length < 2) {
        game.log(`【总括万物之无限宇宙全一】可执行项不足两个，不能发动`);
        return false;
      }
      game.log(`【总括万物之无限宇宙全一】${player.name} 执行：`
        + items.map((i) => `${{ 1: '①', 2: '②', 3: '③', 4: '④' }[i]}`).join(' '));
      for (const i of items) {
        if (!player.alive) break;
        if (i === 1) await runItem1(game, player);
        else if (i === 2) await runItem2(game, player);
        else if (i === 3) await runItem3(game, player);
        else if (i === 4) await runItem4(game, player);
      }
      return true;
    },
  },
};

/** 此刻「可完全执行」的项（按顺序） */
function availableItems(game, player) {
  const out = [];
  if (item1Candidates(game, player).length) out.push(1);
  if (item2Ok(player)) out.push(2);
  if (item3Ok(game, player)) out.push(3);
  out.push(4);   // ④ 只是立一个标记，永远可执行
  return out;
}

/* ---------------- ① 使用一张目标为你或范围内的牌 ---------------- */
async function runItem1(game, player) {
  const cands = item1Candidates(game, player);
  if (!cands.length) return;
  const picked = await game.io.chooseCards(player, {
    prompt: '【总括万物】①：选择一张目标为你或攻击范围内角色的牌使用',
    position: 'h', min: 1, max: 1, cancelable: true,
    filter: (c) => cands.includes(c),
  });
  if (!picked || !picked.length) return;
  const card = picked[0];

  const fixed = game.defaultTargetsFor(player, card);
  let targets = fixed && fixed.length ? fixed : null;
  if (!targets) {
    const pool = [player, ...sideRangePlayers(game, player)].filter(
      (p) => p.alive && game.canBeTargeted(p, card) && game.canTargetByLimits(player, p, card));
    if (!pool.length) {
      game.log(`【总括万物】①：${card.fullname} 没有合法目标`);
      return;
    }
    const t = await game.io.chooseTargets(player, {
      prompt: `【总括万物】①：${card.fullname} 请选择目标`, candidates: pool, min: 1, max: 1,
    });
    if (!t || !t.length) return;
    targets = t;
  }
  await game.useCard(player, card, targets);
}

/* ---------------- ② 明置所有【杀】 ---------------- */
async function runItem2(game, player) {
  const shas = (player.hand || []).filter((c) => c.name === 'sha');
  for (const c of shas) {
    c.revealed = true;
    c.visible = true;
  }
  game.log(`【总括万物】②：${player.name} 明置了 ${shas.length} 张【杀】`);
  game.emit();
}

/* ---------------- ④ 下次范围变化后造成伤害 ---------------- */
async function runItem4(game, player) {
  if (!player.storage) player.storage = {};
  player.storage.zongkuoNextDamage = true;
  game.log(`【总括万物】④：下次攻击范围变化后，`
    + `对变化路径上的任意名角色各造成 1 点伤害`);
  game.emit();
}

/* ---------------- ③ 牌堆顶 5 张当手牌打【决斗】 ---------------- */
async function runItem3(game, player) {
  const five = game.takeFromDeckTop(5);
  if (five.length < 5) {
    for (const c of five) game.deck.push(c);
    game.log('【总括万物】③：牌堆不足 5 张，不能执行');
    return;
  }
  const foes = game.players.filter((p) => p.alive && p !== player);
  const t = await game.io.chooseTargets(player, {
    prompt: '【总括万物】③：用牌堆顶 5 张牌当手牌，视为使用一张【决斗】',
    candidates: foes, min: 1, max: 1,
  });
  if (!t || !t.length) {
    for (const c of five) game.deck.push(c);
    return;
  }
  const target = t[0];

  // 这 5 张牌「视作手牌」：临时进手牌，打出的照常进弃牌堆
  for (const c of five) {
    c.owner = player;
    c.zone = 'hand';
    player.hand.push(c);
  }
  game.log(`【总括万物】③：${player.name} 将牌堆顶 5 张牌当作手牌，`
    + `视为对 ${target.name} 使用【决斗】`);
  game.emit();

  try {
    await runJuedouWithPool(game, player, target, five);
  } finally {
    // 没用掉的牌回到牌堆顶（保持原顺序）
    const left = five.filter((c) => player.hand.includes(c));
    for (const c of left) {
      const i = player.hand.indexOf(c);
      if (i >= 0) player.hand.splice(i, 1);
      c.zone = 'deck';
      game.deck.push(c);
    }
    game.emit();
  }
}

/**
 * 只用「牌堆顶那 5 张」打的【决斗】
 * ------------------------------------------------------------------
 * 目标先出【杀】，然后交替；轮到山城恋时只能从 pool 里出【杀】
 *（用一张少一张），出不出来就受到 1 点伤害。
 */
async function runJuedouWithPool(game, player, target, pool) {
  let asker = target;        // 此刻要出【杀】的人
  let other = player;        // 不出就挨打的那一方来源
  for (let guard = 0; guard < 20; guard++) {
    if (!asker.alive || !other.alive) return;
    let ok;
    if (asker === player) ok = await askShaFromPool(game, player, pool);
    else ok = await game.askSha(asker, other, 'juedou');
    if (!ok) {
      await asker.damage(1, other, 'juedou', null);
      return;
    }
    const t = asker; asker = other; other = t;
  }
}

/** 从 pool 里问一张【杀】并打出 */
async function askShaFromPool(game, player, pool) {
  const avail = pool.filter((c) => c.name === 'sha' && player.hand.includes(c));
  if (!avail.length) return false;
  if (!player.isHuman) {
    const c = avail[0];
    const i = player.hand.indexOf(c);
    if (i >= 0) player.hand.splice(i, 1);
    game.toDiscard([c]);
    game.log(`${player.name} 打出了 ${c.text}`);
    game.emit();
    return true;
  }
  const picked = await game.io.chooseCards(player, {
    prompt: '【决斗】：打出【杀】（只能用牌堆顶的这 5 张），或放弃',
    position: 'h', min: 1, max: 1, cancelable: true,
    filter: (c) => avail.includes(c),
  });
  if (!picked || !picked.length) return false;
  const c = picked[0];
  const i = player.hand.indexOf(c);
  if (i >= 0) player.hand.splice(i, 1);
  game.toDiscard([c]);
  game.log(`${player.name} 打出了 ${c.text}`);
  game.emit();
  return true;
}

/* ============================================================
 * 与【总括万物】④ 的联动：范围变化后结算路径伤害
 * ============================================================ */
export async function afterRangeChanged(game, player, path) {
  if (!player.storage || !player.storage.zongkuoNextDamage) return;
  player.storage.zongkuoNextDamage = false;
  const cands = path.filter((p) => p !== player && p.alive);
  if (!cands.length) return;
  const picked = await game.io.chooseTargets(player, {
    prompt: '【总括万物】④：选择变化路径上的任意名角色，各造成 1 点伤害',
    candidates: cands, min: 0, max: cands.length,
  }).catch(() => []);
  for (const t of (picked || [])) {
    if (t && t.alive) await t.damage(1, player, 'zongkuo', null);
  }
}
