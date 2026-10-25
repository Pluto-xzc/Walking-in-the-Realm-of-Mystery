/**
 * 扩展机制 · 体力变化 / 调整 / 跳过询问
 * ----------------------------------------------------------------
 * 由 src/mechanics.js 拆分而来，段结构与原文件一一对应。
 * 本文件不 import 任何模块：所有依赖（game / player / CARDS / SKILLS）
 * 都由调用方以参数传入。
 */
/* ============================================================
 * Z. 体力变化（本项目新增的「统一概念」）
 * ============================================================
 * 需求方给定：「体力变化」包含以下效果——
 *   受到伤害、失去体力、恢复体力、体力值调整、体力值（被）转化。
 *
 * 用途：把「体力发生任何形式的变化」统一记录/触发，
 *       供「每当体力变化时」这类技能使用。
 *
 * ⚠️ 关键区分（需求方明确要求）：
 *   · 只有前三种（伤害/失去/恢复）是**真正的体力得失**；
 *   · 「体力值调整」**不视为**恢复体力、失去体力、受到伤害；
 *   · 「体力值转化」同理。
 *   因此本记录用 `kind` 区分，技能可自行取舍。
 */

/** 体力变化的五种类型 */
export const HP_CHANGE_KINDS = [
  'damage',     // 受到伤害
  'lose',       // 失去体力
  'recover',    // 恢复体力
  'adjust',     // 体力值调整
  'convert',    // 体力值（被）转化
];

/**
 * 记录一次体力变化
 * @param {Game} game
 * @param {Player} player
 * @param {string} kind 见 HP_CHANGE_KINDS
 * @param {number} num  变化量（正数）
 * @param {number} [before] 变化前体力
 */
export function noteHpChange(game, player, kind, num, before) {
  if (!game || !player) return null;
  game.hpChangeLog = game.hpChangeLog || [];
  const beforeHp = before != null ? before : player.hp;
  const ev = {
    player,
    kind,
    num,
    before: beforeHp,
    after: player.hp,
    turn: game.turnCount,
    // 哪些属于「真正的体力得失」
    realLoss: kind === 'damage' || kind === 'lose',
    realGain: kind === 'recover',
  };
  game.hpChangeLog.push(ev);
  return ev;
}

/** 取本回合的体力变化记录 */
export function hpChangesThisTurn(game, player, kinds) {
  if (!game || !game.hpChangeLog) return [];
  return game.hpChangeLog.filter((e) => e.turn === game.turnCount
    && (!player || e.player === player)
    && (!kinds || kinds.includes(e.kind)));
}

/** 该角色本回合是否发生过体力变化 */
export function hasHpChangeThisTurn(game, player, kinds) {
  return hpChangesThisTurn(game, player, kinds).length > 0;
}

/* ============================================================
 * AA. 调整（本项目新增）
 * ============================================================
 * 需求方给定：「将当前数值向目标数值调整」，分两种——
 *   ① **手牌数量调整**：视为摸牌 / 弃牌；
 *   ② **体力值调整**：**不视为**恢复体力、失去体力、受到伤害。
 *   当前数值与目标数值相同时，**可以触发**「调整」机制，
 *   但此时**无事发生**（不摸不弃、不加不减）。
 */

/**
 * 手牌数量调整（视为摸牌/弃牌）
 * @param {Player} player
 * @param {number} target 目标手牌数
 * @returns {Promise<{drawn:number, discarded:number, changed:boolean}>}
 */
export async function adjustHandCount(player, target) {
  const g = player && player.game;
  const cur = player.countCards('h');
  const diff = target - cur;
  if (!g) return { drawn: 0, discarded: 0, changed: false };
  if (diff === 0) {
    g.log(`【调整】${player.name} 的手牌数已经是 ${target}，无事发生`);
    return { drawn: 0, discarded: 0, changed: false };
  }
  if (diff > 0) {
    await player.draw(diff);
    g.log(`【调整】${player.name} 将手牌数调整到 ${target}（视为摸 ${diff} 张）`);
    return { drawn: diff, discarded: 0, changed: true };
  }
  const n = -diff;
  await player.discardCards(n, 'h', `【调整】将手牌数调整到 ${target}`);
  g.log(`【调整】${player.name} 将手牌数调整到 ${target}（视为弃 ${n} 张）`);
  return { drawn: 0, discarded: n, changed: true };
}

/**
 * 体力值调整
 * ------------------------------------------------------------------
 * ⚠️ 按需求方要求：**不视为**恢复体力、失去体力、受到伤害，
 *    因此这里直接改 hp，不走 recover/loseHp/damage，
 *    也不会触发濒死之外的那三类时机。
 *
 * 但若调整后 hp<=0，仍需进入濒死（否则角色会「无声死亡」）。
 */
export async function adjustHp(player, target) {
  if (!player || !player.alive) return { delta: 0, changed: false };
  const g = player.game;
  const cur = player.hp;
  const delta = target - cur;
  if (delta === 0) {
    if (g) g.log(`【调整】${player.name} 的体力值已经是 ${target}，无事发生`);
    return { delta: 0, changed: false };
  }
  player.hp = target;
  if (g) {
    g.log(`【调整】${player.name} 的体力值被调整为 ${target}`
      + `（${cur} → ${target}，不视为回复/失去/伤害）`);
    // 【体力变化】记录为 adjust（不算真正的得失）
    noteHpChange(g, player, 'adjust', Math.abs(delta), cur);
    g.emit();
  }
  if (player.hp <= 0 && g) await g.enterDying(player);
  return { delta, changed: true };
}

/**
 * 体力值（被）转化
 * ------------------------------------------------------------------
 * 例：与另一名角色交换体力值。同样**不视为**恢复/失去/伤害。
 */
export async function convertHp(playerA, playerB) {
  if (!playerA || !playerB) return false;
  const g = playerA.game;
  const a = playerA.hp; const b = playerB.hp;
  const aBefore = a; const bBefore = b;
  playerA.hp = b;
  playerB.hp = a;
  if (g) {
    g.log(`【转化】${playerA.name} 与 ${playerB.name} 交换了体力值`
      + `（${aBefore} ↔ ${bBefore}）`);
    noteHpChange(g, playerA, 'convert', Math.abs(b - aBefore), aBefore);
    noteHpChange(g, playerB, 'convert', Math.abs(a - bBefore), bBefore);
    g.emit();
    if (playerA.hp <= 0) await g.enterDying(playerA);
    if (playerB.hp <= 0) await g.enterDying(playerB);
  }
  return true;
}

/**
 * 通用「调整」入口
 * @param {Player} player
 * @param {object} spec { hand?: number, hp?: number }
 */
export async function adjust(player, spec = {}) {
  const out = { hand: null, hp: null };
  if (spec.hand != null) out.hand = await adjustHandCount(player, spec.hand);
  if (spec.hp != null) out.hp = await adjustHp(player, spec.hp);
  return out;
}

/* ============================================================
 * AB. 跳过 xx 询问（官方机制的延伸）
 * ============================================================
 * 需求方给定三档：
 *   ① **牌的询问**：对其使用牌其不可响应，
 *      且其**不能在其他角色求桃时使用牌**；
 *   ② **技能的询问**：其**不能封锁触发类技能发动**；
 *   ③ **一切的询问**：包含前两者。
 *
 * 说明：这里的「询问」指游戏向该角色发起的响应/决策请求。
 * 被跳过 ≠ 不能行动，而是「不再询问他，按默认结果处理」。
 */

/** 三种跳过档位 */
export const SKIP_KINDS = {
  CARD: 'card',      // 牌的询问
  SKILL: 'skill',    // 技能的询问
  ALL: 'all',        // 一切的询问
};

/** 让某角色跳过某档位询问 */
export function skipInquiry(player, kind = SKIP_KINDS.ALL, opts = {}) {
  if (!player) return false;
  player.skipInquiry = player.skipInquiry || {};
  const until = opts.until != null ? opts.until : (player.game ? player.game.turnCount : 0);
  player.skipInquiry[kind] = until;
  if (player.game) {
    const label = kind === 'card' ? '牌的询问'
      : kind === 'skill' ? '技能的询问' : '一切的询问';
    player.game.log(`${player.name} 被跳过了${label}`);
    player.game.emit();
  }
  return true;
}

/** 恢复某档位询问 */
export function resumeInquiry(player, kind = SKIP_KINDS.ALL) {
  if (!player || !player.skipInquiry) return false;
  delete player.skipInquiry[kind];
  if (player.game) {
    player.game.log(`${player.name} 恢复了询问`);
    player.game.emit();
  }
  return true;
}

/**
 * 该角色此刻是否被跳过了某档位的询问
 * ------------------------------------------------------------------
 * 「一切的询问」会覆盖前两档。
 */
export function isInquirySkipped(player, kind = SKIP_KINDS.CARD) {
  if (!player || !player.skipInquiry) return false;
  const g = player.game;
  const turn = g ? g.turnCount : 0;
  const live = (k) => {
    const until = player.skipInquiry[k];
    return until != null && (until === true || until >= turn);
  };
  if (live(SKIP_KINDS.ALL)) return true;
  return live(kind);
}

/**
 * 【牌的询问】被跳过时的两个后果
 * ------------------------------------------------------------------
 * ① 对其使用牌，其**不可响应**
 * ② 其**不能在其他角色求桃时使用牌**
 */
export function cannotRespond(player) {
  return isInquirySkipped(player, SKIP_KINDS.CARD);
}

export function cannotUseCardWhenOthersDying(player) {
  return isInquirySkipped(player, SKIP_KINDS.CARD);
}

/**
 * 【技能的询问】被跳过时的后果：不能封锁触发类技能发动
 * ------------------------------------------------------------------
 * 用于「不能因此发动技能」类机制的闸门判定。
 */
export function cannotBlockTriggerSkill(player) {
  return isInquirySkipped(player, SKIP_KINDS.SKILL);
}

