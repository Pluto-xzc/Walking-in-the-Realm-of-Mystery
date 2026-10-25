/**
 * 扩展机制 · 智囊牌 / 占用
 * ----------------------------------------------------------------
 * 由 src/mechanics.js 拆分而来，段结构与原文件一一对应。
 * 本文件不 import 任何模块：所有依赖（game / player / CARDS / SKILLS）
 * 都由调用方以参数传入。
 */

import { noteHpChange } from './inquiry.js';
/* ============================================================
 * AJ. 智囊牌（官方机制）
 * ============================================================
 * 无名杀依据（`get/index.js` 的 `zhinangs()` 与 `poptip.js` 的 rule_zhinang）：
 *   · 智囊是**牌的一类标签**，列在 `lib.config.zhinang_tricks` 里；
 *   · 牌堆中没有的智囊牌会被过滤；
 *   · 可在配置中自行增减。
 *
 * ⚠️ 无名杀默认是 **4 张**（含【洞烛先机】），
 *    需求方明确指定本项目只取 **3 张**：
 *    【无中生有】【过河拆桥】【无懈可击】。
 */

/** 本项目的智囊牌默认列表（按需求方指定，仅 3 张） */
export const ZHINANG_DEFAULT = ['wuzhong', 'guohe', 'wuxie'];

/** 取当前智囊牌列表（可被 game.zhinangTricks 覆盖，实现「增减」） */
export function zhinangCards(game) {
  if (game && Array.isArray(game.zhinangTricks) && game.zhinangTricks.length) {
    return game.zhinangTricks.slice();
  }
  return ZHINANG_DEFAULT.slice();
}

/** 这张牌是否是智囊牌 */
export function isZhinangCard(card, game) {
  if (!card) return false;
  return zhinangCards(game).includes(card.name);
}

/** 增/减智囊牌（技能可调用） */
export function setZhinangCards(game, names) {
  if (!game) return [];
  game.zhinangTricks = Array.isArray(names) ? names.slice() : [];
  game.emit();
  return game.zhinangTricks;
}

export function addZhinangCard(game, name) {
  if (!game || !name) return [];
  const list = zhinangCards(game);
  if (!list.includes(name)) list.push(name);
  return setZhinangCards(game, list);
}

export function removeZhinangCard(game, name) {
  if (!game) return [];
  return setZhinangCards(game, zhinangCards(game).filter((n) => n !== name));
}

/* ============================================================
 * AK. 占用（官方机制的延伸）
 * ============================================================
 * 需求方给定：
 *   · 一个区域**仅能被一名角色占用**，按**最新占用**的角色适用；
 *   · **未声明占用期限默认双方一人死亡**；
 *   · 一名角色能占用**多个**区域；
 *   · 特别的，可以仅占用**部分**的对应区域。
 *
 * 三类约束：
 *   ① 装备区/判定区被占用：A 仍能对自己使用，牌仍属于 A，
 *      但**对应效果仅能 B 使用或生效**；
 *   ② 手牌区/技能区被占用：A 不在自己回合内使用/打出（手牌/技能）时，
 *      须**征得 B 同意或交出 1 牌给 B**；
 *      「（手牌/技能）」形式则额外：**B 每回合有 1 次使用 A 手牌/技能的机会**；
 *      且二者发动次数限制**互相独立**（如 A 的是回合技，两人各能用一次）；
 *   ③ 体力区被占用：B 每轮的体力增减**最多 1 点**改为作用于 A 的体力，
 *      此时**不视为** A 体力恢复 / 受到伤害 / 失去体力等。
 */

/** 可被占用的四类区域 */
export const OCCUPY_ZONES = {
  EQUIP: 'equip',      // 装备区
  JUDGE: 'judge',      // 判定区
  HAND: 'hand',        // 手牌区
  SKILL: 'skill',      // 技能区
  HP: 'hp',            // 体力区
};

/**
 * B 占用 A 的某个区域
 * @param {Player} owner A（被占用者）
 * @param {Player} user B（占用者）
 * @param {string} zone 区域
 * @param {object} [opts]
 * @param {string} [opts.part] 部分占用（如仅占用 'equip1' 武器区）
 * @param {number} [opts.untilTurn] 到期回合；不传 = 默认到一方死亡
 * @returns {boolean}
 */
export function occupyZone(owner, user, zone, opts = {}) {
  if (!owner || !user || !zone) return false;
  const g = owner.game;
  owner.occupied = owner.occupied || {};
  /*
   * 同一区域仅能被一名角色占用 → **按最新占用的角色适用**，
   * 因此这里直接覆盖旧记录。
   */
  owner.occupied[zone] = {
    by: user,
    part: opts.part || null,
    untilTurn: opts.untilTurn != null ? opts.untilTurn : null,
    // 未声明期限 → 默认双方一人死亡
    untilDeath: opts.untilTurn == null,
    roundConverted: 0,        // 体力区：本轮已转嫁的点数
    skillUsedThisTurn: 0,     // 「（手牌/技能）」：B 本回合已使用的次数
  };
  if (g) {
    const zn = { equip: '装备区', judge: '判定区', hand: '手牌区', skill: '技能区', hp: '体力区' };
    g.log(`【占用】${user.name} 占用了 ${owner.name} 的`
      + `${zn[zone] || zone}${opts.part ? `（仅 ${opts.part}）` : ''}`);
    g.emit();
  }
  return true;
}

/** 解除占用 */
export function releaseOccupy(owner, zone) {
  if (!owner || !owner.occupied || !owner.occupied[zone]) return false;
  delete owner.occupied[zone];
  if (owner.game) {
    owner.game.log(`【占用】${owner.name} 的${zone}区占用被解除`);
    owner.game.emit();
  }
  return true;
}

/** 取某区域此刻的占用者（无则 null） */
export function occupierOf(owner, zone, part) {
  if (!owner || !owner.occupied) return null;
  const rec = owner.occupied[zone];
  if (!rec || !rec.by || !rec.by.alive || !owner.alive) return null;
  // 部分占用：只对指定部分生效
  if (rec.part && part && rec.part !== part) return null;
  return rec.by;
}

/** 该角色是否有任何区域被占用 */
export function isOccupied(owner, zone) {
  if (!owner || !owner.occupied) return false;
  if (zone) return !!occupierOf(owner, zone);
  return Object.keys(owner.occupied).length > 0;
}

/**
 * 占用记录的到期清理（一方死亡时解除）
 * 由引擎在每次死亡后调用。
 */
export function clearOccupyOnDeath(player) {
  if (!player) return [];
  const g = player.game;
  const cleared = [];
  // ① 他自己作为「占用者」死亡 → 解除他占用的所有区域
  for (const other of (g ? g.players : [])) {
    if (!other.occupied) continue;
    for (const zone of Object.keys(other.occupied)) {
      const rec = other.occupied[zone];
      if (rec && rec.by === player) {
        delete other.occupied[zone];
        cleared.push({ owner: other, zone });
      }
    }
  }
  // ② 他自己死亡 → 他身上的占用全部解除
  if (player.occupied) {
    for (const zone of Object.keys(player.occupied)) {
      delete player.occupied[zone];
      cleared.push({ owner: player, zone });
    }
  }
  if (g && cleared.length) {
    g.log(`【占用】${player.name} 死亡，相关占用全部解除`);
  }
  return cleared;
}

/**
 * 规则②：A 不在自己回合内使用牌/技能时的代价
 * ------------------------------------------------------------------
 * 须「征得 B 同意**或**交出 1 牌给 B」。
 * AI 约定（按需求方指定）：
 *   队友**默认同意**；敌人**坚决不同意**。
 *
 * @param {Player} actor A
 * @param {string} zone 'hand' | 'skill'
 * @param {Game} game
 * @returns {Promise<boolean>} 是否获准
 */
export async function askOccupyPermission(actor, zone, game) {
  const by = occupierOf(actor, zone);
  if (!by) return true;                       // 未被占用，无需许可

  const ai = game && game.ai;
  // 队友默认同意；敌人坚决不同意
  const friendly = ai ? !ai.isEnemy(by, actor) : false;
  if (friendly) {
    game.log(`【占用】${by.name} 是队友，同意 ${actor.name} 使用${zone === 'hand' ? '手牌' : '技能'}`);
    return true;
  }

  // 敌人不同意 → A 可以「交出 1 牌给 B」换取许可
  if (!actor.countCards('he')) {
    game.log(`【占用】${by.name} 不同意，且 ${actor.name} 无牌可交，无法使用`);
    return false;
  }
  const paid = await game.io.chooseCards(actor, {
    prompt: `【占用】${by.name} 不同意你使用${zone === 'hand' ? '手牌' : '技能'}，`
      + `是否交出 1 张牌换取许可？`,
    position: 'he', min: 0, max: 1, cancelable: true,
  }).catch(() => []);
  if (!paid || !paid.length) {
    game.log(`【占用】${actor.name} 未交出牌，无法使用`);
    return false;
  }
  await actor.loseCards(paid);
  await by.gain(paid);
  game.log(`【占用】${actor.name} 交出 ${paid[0].text} 给 ${by.name}，获得许可`);
  return true;
}

/**
 * 规则②的特别形式：「（手牌/技能）」→ B 每回合有 1 次使用 A 手牌/技能的机会
 * ------------------------------------------------------------------
 * 且二者的**发动次数限制互相独立**（如 A 的是回合技，两人各能用一次）。
 */
export function canBorrowOccupy(user, owner, zone, game) {
  const rec = owner && owner.occupied && owner.occupied[zone];
  if (!rec || rec.by !== user) return false;
  // 必须是「（手牌/技能）」这种特别形式
  if (!rec.part || rec.part !== 'borrow') return false;
  const turn = game ? game.turnCount : 0;
  if (rec.borrowTurn !== turn) {
    rec.borrowTurn = turn;
    rec.skillUsedThisTurn = 0;
  }
  return (rec.skillUsedThisTurn | 0) < 1;
}

/** 记录 B 使用了这次机会 */
export function markBorrowUsed(user, owner, zone) {
  const rec = owner && owner.occupied && owner.occupied[zone];
  if (!rec || rec.by !== user) return false;
  rec.skillUsedThisTurn = (rec.skillUsedThisTurn | 0) + 1;
  return true;
}

/**
 * 规则③：体力区被占用时的转嫁
 * ------------------------------------------------------------------
 * B 每轮的体力增减**最多 1 点**改为作用于 A 的体力，
 * 且**不视为** A 体力恢复 / 受到伤害 / 失去体力。
 *
 * @param {Player} user B
 * @param {number} delta 正=增加，负=扣减
 * @param {Game} game
 * @returns {Promise<boolean>} 是否发生了转嫁
 */
export async function redirectHpChange(user, delta, game) {
  if (!user || !delta || !game) return false;
  for (const owner of game.players) {
    const by = occupierOf(owner, OCCUPY_ZONES.HP);
    if (by !== user) continue;
    const rec = owner.occupied[OCCUPY_ZONES.HP];
    // 每轮最多 1 点
    const used = rec.roundConverted | 0;
    if (used >= 1) return false;
    rec.roundConverted = used + 1;

    const n = delta > 0 ? 1 : -1;
    // 直接改数值：不触发 recover / loseHp / damage
    const before = owner.hp;
    owner.hp = Math.max(0, Math.min(owner.maxHp, owner.hp + n));
    game.log(`【占用】${user.name} 的体力${n > 0 ? '增加' : '扣减'}转为`
      + `${owner.name} 的体力${n > 0 ? '增加' : '扣减'} 1 点`
      + `（不视为恢复/伤害/失去体力）`);
    noteHpChange(game, owner, 'convert', 1, before);
    game.emit();
    if (owner.hp <= 0) await game.enterDying(owner);
    return true;
  }
  return false;
}

/** 每轮开始时重置体力区的转嫁计数 */
export function resetOccupyRound(game) {
  if (!game) return;
  for (const p of game.players) {
    if (!p.occupied) continue;
    for (const zone of Object.keys(p.occupied)) {
      const rec = p.occupied[zone];
      if (rec) rec.roundConverted = 0;
    }
  }
}
