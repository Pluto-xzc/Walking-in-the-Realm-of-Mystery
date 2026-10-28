/**
 * 扩展机制 · 蓄谋 / 隐匿
 * ----------------------------------------------------------------
 * 由 src/mechanics.js 拆分而来，段结构与原文件一一对应。
 * 本文件不 import 任何模块：所有依赖（game / player / CARDS / SKILLS）
 * 都由调用方以参数传入。
 */

import { normalizeList } from './shared.js';
/* ============================================================
 * AC. 蓄谋（本项目新增）
 * ============================================================
 * 需求方给定：
 *   · 将被蓄谋的牌按顺序**扣置**于目标的判定区；
 *   · 目标的**准备阶段**时，按**后置入先使用**的顺序依次使用蓄谋牌；
 *   · 使用时遵循**同名牌仅能使用 1 次**的限制；
 *   · 若某牌不能使用，则**弃置所有剩余蓄谋牌**；
 *   · 蓄谋牌**不能被移动**，**只有自己可见内容**。
 *
 * 无名杀依据（`src/character/jsrg/card.js` 的 `xumou_jsrg`）：
 *   · 逐张询问「是否使用」，不使用 → **弃置判定区所有蓄谋牌**；
 *   · 用 `xumou_jsrg_temp` 记录**已用过的牌名**，
 *     `cardEnabled` 里 `if (storage.includes(get.name(card))) return false`
 *     —— 即**同名牌仅能使用 1 次**。
 *   与需求方描述一致。
 */

/** 蓄谋牌的区域名 */
export const XUMOU_ZONE = 'xumou';

/**
 * 将牌蓄谋到目标判定区
 * @param {Player} target 目标（牌扣置于其判定区）
 * @param {Card[]} cards 按顺序传入（**后置入的先使用**）
 * @param {Player} [source]
 * @returns {Promise<Card[]>}
 */
export function putXumou(target, cards, source) {
  const g = target && target.game;
  const list = normalizeList(cards).filter(Boolean);
  if (!g || !list.length) return [];

  target.xumou = target.xumou || [];
  for (const c of list) {
    // 从原区域摘掉
    for (const p of g.players) {
      const hi = p.hand.indexOf(c);
      if (hi >= 0) p.hand.splice(hi, 1);
      for (const slot of Object.keys(p.equips || {})) {
        if (p.equips[slot] === c) p.equips[slot] = null;
      }
    }
    c.zone = XUMOU_ZONE;
    c.xumouOwner = target.id;
    /*
     * 需求方裁定：蓄谋牌**只有自己可见内容**。
     * 因此这里不打 revealed 标记；可见性由 isXumouVisibleTo 单独判定。
     */
    target.xumou.push(c);
  }
  g.log(`${source ? source.name + ' ' : ''}将 ${list.length} 张牌蓄谋于 `
    + `${target.name} 的判定区`);
  g.emit();
  return list;
}

/** 取某角色的蓄谋牌（按置入顺序） */
export function xumouCardsOf(player) {
  return (player && player.xumou) ? player.xumou.slice() : [];
}

/**
 * 蓄谋牌对观者是否可见内容
 * ------------------------------------------------------------------
 * 需求方裁定：**只有自己可见内容**（其他角色只知道数量）。
 */
export function isXumouVisibleTo(viewer, owner) {
  return viewer === owner;
}

/** 清空某角色的蓄谋牌（进入弃牌堆） */
export function flushXumou(player, reason) {
  const g = player && player.game;
  if (!g) return [];
  const all = xumouCardsOf(player);
  if (!all.length) return [];
  player.xumou = [];
  for (const c of all) c.zone = 'discard';
  // ⚠️ 必须传数组（toDiscard 只收一个参数）
  g.toDiscard(all, { direct: true });
  g.log(`【蓄谋】${player.name} 的 ${all.length} 张蓄谋牌被弃置`
    + (reason ? `（${reason}）` : ''));
  g.emit();
  return all;
}

/**
 * 准备阶段：依次使用蓄谋牌
 * ------------------------------------------------------------------
 * 顺序：**后置入的先使用**（即从数组末尾往前）。
 * 同名牌仅能使用 1 次；某牌不能使用 → 弃置所有剩余蓄谋牌。
 *
 * @param {Game} game
 * @param {Player} player
 * @returns {Promise<{used:Card[], discarded:Card[]}>}
 */
export async function resolveXumou(game, player) {
  const all = xumouCardsOf(player);
  if (!all.length) return { used: [], discarded: [] };

  const used = [];
  const usedNames = new Set();
  // 后置入的先使用 → 倒序遍历
  const order = all.slice().reverse();

  game.log(`【蓄谋】${player.name} 的准备阶段，开始依次使用蓄谋牌`
    + `（共 ${order.length} 张）`);

  for (const card of order) {
    const name = card.name;

    // ① 同名牌仅能使用 1 次
    if (usedNames.has(name)) {
      game.log(`【蓄谋】${card.fullname || name} 本阶段已使用过同名牌，`
        + `不能再次使用，弃置所有剩余蓄谋牌`);
      const rest = flushXumou(player, '同名牌已使用过');
      return { used, discarded: rest.concat([]) };
    }

    // ② 询问是否使用（不能使用则弃置所有剩余）
    const usable = game.cardUsableNow(player, card);
    let willUse = usable;
    if (usable && player.isHuman && game.io) {
      // 人类玩家：询问是否使用
      willUse = await player.chooseOption({
        prompt: `蓄谋：是否使用【${card.fullname || name}】？`
          + `若不使用，则判定区内所有蓄谋牌都将被置入弃牌堆。`,
        options: [{ key: 'use', label: '使用' }, { key: 'skip', label: '不使用' }],
      }).then((r) => r === 'use' || r === true).catch(() => true);
    }
    if (!willUse) {
      game.log(`【蓄谋】${card.fullname || name} 无法使用（或选择不使用），`
        + `弃置所有剩余蓄谋牌`);
      const rest = flushXumou(player, '有牌不能使用');
      return { used, discarded: rest };
    }

    // ③ 实际使用
    const idx = player.xumou.indexOf(card);
    if (idx >= 0) player.xumou.splice(idx, 1);
    card.zone = 'discard';
    usedNames.add(name);
    used.push(card);
    game.log(`【蓄谋】${player.name} 使用了蓄谋牌 ${card.fullname || name}`);
    const targets = await game.pickTargetsForVirtual(player, card).catch(() => []);
    await game.useCard(player, card, targets);
  }

  game.emit();
  return { used, discarded: [] };
}

/* ============================================================
 * AD. 隐匿（官方机制）
 * ============================================================
 * 无名杀依据（`library/element/player.js` 的 setCharacter）：
 *   if (info.hasHiddenSkill && !this.noclick) {
 *     this.hiddenSkills.addArray(skills);
 *     skills = [];
 *     this.name = "unknown";
 *     this.sex = "male";
 *     hidden = true;
 *     skills.add("g_hidden_ai");
 *   }
 * 以及 `library/skill.js` 的 `_showHiddenCharacter`：
 *   trigger: { player: ["changeHp", "phaseBeginStart", ...] }
 *   content: player.showCharacter(2)
 *
 * 需求方给定（两处修正）：
 *   · 性别为**「无」**（不是无名杀的 male），
 *     因此**不能触发**【雌雄双股剑】这类按性别的技能；
 *   · 技能**不要**真的移除，隐匿状态下仍可能发动某些技能，
 *     所以只记录到 hiddenSkills，不移出 skills。
 */

/** 该角色是否处于隐匿状态 */
export function isHidden(player) {
  return !!(player && player.hidden);
}

/**
 * 进入隐匿状态
 * ------------------------------------------------------------------
 * 隐藏：武将牌（名字）、体力值、体力上限、性别（视为「无」）。
 * 技能保留可发动，仅记录到 hiddenSkills。
 */
export function enterHidden(player) {
  if (!player || player.hidden) return false;
  player.hidden = true;
  player.hiddenSkills = (player.skills || []).slice();
  // 备份真实信息，供登场时恢复
  player.hiddenSnapshot = {
    charId: player.charId,
    name: player.name,
    sex: player.sex,
    hp: player.hp,
    maxHp: player.maxHp,
  };
  // 对外表现为「未知」
  player.name = '未知';
  player.sex = 'none';                  // 需求方裁定：性别为「无」
  player.charId = 'unknown';
  if (player.game) {
    player.game.log(`${player.name} 进入隐匿状态`
      + `（武将牌、体力值、体力上限、性别均不可见）`);
    player.game.emit();
  }
  return true;
}

/**
 * 登场（结束隐匿）
 * ------------------------------------------------------------------
 * 恢复武将牌、体力值、体力上限、性别，并触发「隐匿技」的效果。
 * @returns {Promise<boolean>}
 */
export async function exitHidden(player, opts = {}) {
  if (!player || !player.hidden) return false;
  const g = player.game;
  const snap = player.hiddenSnapshot;
  player.hidden = false;

  if (snap) {
    player.charId = snap.charId;
    player.name = snap.name;
    player.sex = snap.sex;
    player.maxHp = snap.maxHp;
    // 体力不高于上限
    player.hp = Math.min(snap.hp, snap.maxHp);
  }
  player.hiddenSnapshot = null;

  if (g) {
    g.log(`${player.name} 登场（解除隐匿），`
      + `武将牌/体力/性别恢复可见`);
    g.emit();
  }

  // 触发「隐匿技」的效果
  if (opts.fireSkill !== false && g) {
    await g.checkSkills('hiddenReveal', { player, hidden: true });
  }
  return true;
}

/**
 * 是否应因「受到伤害」而登场
 * ------------------------------------------------------------------
 * 需求方/无名杀规则：**受到伤害时防止那次伤害后登场**。
 * 返回 true 表示调用方应先防止该伤害，再让角色登场。
 */
export function shouldRevealOnDamage(player) {
  return isHidden(player);
}

/** 重新隐匿 */
export function reHidden(player) {
  if (!player) return false;
  player.hidden = false;
  player.hiddenSnapshot = null;
  return enterHidden(player);
}

