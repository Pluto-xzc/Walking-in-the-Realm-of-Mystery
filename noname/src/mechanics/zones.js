/**
 * 扩展机制 · 除外 / 点燃
 * ----------------------------------------------------------------
 * 由 src/mechanics.js 拆分而来，段结构与原文件一一对应。
 * 本文件不 import 任何模块：所有依赖（game / player / CARDS / SKILLS）
 * 都由调用方以参数传入。
 */

import { normalizeList, invalidateRevealed } from './shared.js';
/* ============================================================
 * E. 除外（本项目扩展）
 * ============================================================
 * 按需求方给定的规则：
 *   ① 被除外的牌**移出游戏**，独立存在于「除外区」；
 *   ② **仅主人可见**这些牌的具体内容，其余角色只了解数量；
 *   ③ 除外区**无数量限制**；
 *   ④ 主人**死亡**时，这些牌进入弃牌堆；
 *   ⑤ 每名角色的除外区**相互独立**，互不影响。
 *
 * 另外确认：技能**可以取回**除外区里的牌（不是只能等死亡）。
 *
 * 实现落在 Player.excluded 数组 + Card.zone = 'excluded'。
 * 由于牌不在牌堆/弃牌堆/手牌/装备/判定，因此天然「移出游戏」。
 * ============================================================ */

/**
 * 将牌除外
 * @param {Player} player 执行除外的角色（即除外区的主人）
 * @param {Card[]} cards
 * @param {string} [reason] 日志用
 */
export function excludeCards(player, cards, reason) {
  const list = (Array.isArray(cards) ? cards : [cards]).filter(Boolean);
  if (!list.length) return [];
  const g = player.game;
  const moved = [];
  for (const c of list) {
    // 从原区域摘掉（手牌 / 装备 / 判定）
    const hi = player.hand.indexOf(c);
    if (hi >= 0) player.hand.splice(hi, 1);
    for (const slot of Object.keys(player.equips || {})) {
      if (player.equips[slot] === c) player.equips[slot] = null;
    }
    const ji = (player.judges || []).indexOf(c);
    if (ji >= 0) player.judges.splice(ji, 1);
    // 若在别处（他人手牌等），也一并摘除
    if (g) {
      for (const p of g.players) {
        const k = p.hand.indexOf(c);
        if (k >= 0) p.hand.splice(k, 1);
      }
    }
    c.zone = 'excluded';
    c.excludedOwner = player.id;
    /*
     * 被除外 → 失去明置与横置状态
     *（需求方确认「被除外」也属于失去明置的情形之一）
     */
    invalidateRevealed([c]);
    delete c.horizontal;
    player.excluded.push(c);
    moved.push(c);
  }
  if (g) {
    g.log(`${player.name} 将 ${moved.length} 张牌除外`
      + (reason ? `（${reason}）` : ''));
    g.emit();
  }
  return moved;
}

/**
 * 取回除外区的牌
 * @param {Player} player 除外区主人
 * @param {Card[]} cards
 * @returns {Card[]} 实际取回的牌
 */
export function retrieveExcluded(player, cards) {
  const list = (Array.isArray(cards) ? cards : [cards]).filter(Boolean);
  const got = [];
  for (const c of list) {
    const i = player.excluded.indexOf(c);
    if (i < 0) continue;
    player.excluded.splice(i, 1);
    c.zone = 'hand';
    delete c.excludedOwner;
    got.push(c);
  }
  return got;
}

/**
 * 主人死亡：除外区的牌进入弃牌堆
 * 参考需求：「当除外这些牌的角色死亡时，这些牌进入弃牌堆」
 */
export function flushExcludedOnDeath(player) {
  if (!player.excluded || !player.excluded.length) return [];
  const g = player.game;
  const all = player.excluded.slice();
  player.excluded.length = 0;
  for (const c of all) {
    c.zone = 'discard';
    delete c.excludedOwner;
  }
  if (g) {
    // ⚠️ 必须传**数组**，不能写成 toDiscard(...all)：
    //    toDiscard(cards) 只接收一个参数，用展开会把其余牌全丢掉。
    g.toDiscard(all);
    g.log(`${player.name} 阵亡，其除外区的 ${all.length} 张牌进入弃牌堆`);
  }
  return all;
}

/**
 * 某角色能看到多少张除外牌
 * 可见性规则：主人看全部（含具体内容），其他人只看数量。
 *
 * @param {Player} viewer 观察者
 * @param {Player} owner  除外区主人
 * @returns {{count:number, cards:Card[]|null, known:boolean}}
 */
export function viewExcluded(viewer, owner) {
  const count = (owner.excluded || []).length;
  const known = viewer === owner;
  return { count, cards: known ? owner.excluded.slice() : null, known };
}

/* ============================================================
 * F. 点燃（本项目扩展）
 * ============================================================
 * 需求方给定规则：
 *   · 被点燃的牌**使用**时没有距离和次数限制；
 *   · **每有两张**被点燃的牌**被弃置**时，那些牌的**原持有者**
 *     须受到 1 点**火焰**伤害。
 *
 * 裁定（已与需求方确认）：
 *   「原持有者」= **点燃时牌在谁手上**的那个人
 *   （而不是造成弃置的人）。
 *
 * 实现方式：
 *   给牌打标记 card.ignited = true，并记录 card.ignitedOwner。
 *   弃置时由引擎调用 noteIgnitedDiscard() 计数，每满 2 张结算一次。
 */

/** 点燃一张或多张牌 */
export function igniteCards(cards, owner) {
  const list = normalizeList(cards);
  const out = [];
  for (const c of list) {
    if (!c) continue;
    c.ignited = true;
    // 记录「原持有者」：点燃时牌在谁手上
    c.ignitedOwner = owner || c.ignitedOwner || null;
    out.push(c);
  }
  if (out.length && owner && owner.game) {
    owner.game.log(`${owner.name} 点燃了 ${out.length} 张牌`
      + `（${out.map((c) => c.fullname || c.name).join('、')}）`);
    owner.game.emit();
  }
  return out;
}

/** 取消点燃 */
export function extinguisCards(cards) {
  const list = normalizeList(cards);
  for (const c of list) {
    if (!c) continue;
    delete c.ignited;
    delete c.ignitedOwner;
  }
  return list;
}

/** 这张牌是否被点燃 */
export function isIgnited(card) {
  return !!(card && card.ignited);
}

/**
 * 记录「有被点燃的牌被弃置」，每满 2 张结算一次火焰伤害
 * ------------------------------------------------------------------
 * 由引擎的弃牌入口统一调用（toDiscard）。
 *
 * @param {Game} game
 * @param {Card[]} cards 本次被弃置的牌
 * @returns {Promise<number>} 本次结算造成的伤害次数
 */
export async function noteIgnitedDiscard(game, cards) {
  if (!game) return 0;
  const list = normalizeList(cards).filter((c) => c && c.ignited);
  if (!list.length) return 0;

  // 全局计数器：跨角色累计（规则说的是「每有两张」，未限定持有者）
  game._ignitedDiscardCount = (game._ignitedDiscardCount || 0);
  let hits = 0;

  for (const c of list) {
    game._ignitedDiscardCount += 1;
    game.log(`【点燃】${c.fullname || c.name} 被弃置`
      + `（点燃计数 ${game._ignitedDiscardCount}/2）`);

    if (game._ignitedDiscardCount >= 2) {
      game._ignitedDiscardCount -= 2;
      // 由「原持有者」受到 1 点火焰伤害
      const victim = c.ignitedOwner;
      if (victim && victim.alive) {
        game.log(`【点燃】两张被点燃的牌已被弃置，`
          + `${victim.name} 受到 1 点火焰伤害`);
        await game.doDamage(victim, 1, null, 'ignite', null, 'fire');
        hits++;
      }
    }
    // 结算完毕，标记清除
    delete c.ignited;
    delete c.ignitedOwner;
  }
  return hits;
}

/** 点燃相关的 mod：被点燃的牌使用无距离、无次数限制 */
export function ignitedCardMods(card, player, game) {
  if (!isIgnited(card)) return null;
  return {
    noDistance: true,
    noLimit: true,
  };
}

