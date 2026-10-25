/**
 * 扩展机制 · 废除 / 发现
 * ----------------------------------------------------------------
 * 由 src/mechanics.js 拆分而来，段结构与原文件一一对应。
 */
import { normalizeList } from './shared.js';
/* ============================================================
 * K. 废除（官方机制）
 * ============================================================
 * 无名杀依据（`library/element/content.js` 的 disableEquip）：
 *   · 被废除的装备栏不能再装备牌；
 *   · 原本在栏内的牌会被弃置
 *     （源码：`if (cards.length > 0) await player.loseToDiscardpile({cards})`）。
 *
 * 需求方补充：未标明时**全部为装备区**。
 */

/** 装备槽位 key ↔ 序号 */
const SLOT_BY_NUM = {
  1: 'equip1', 2: 'equip2', 3: 'equip3', 4: 'equip4', 5: 'equip5',
};

/**
 * 废除一个或多个区域
 * @param {Player} player
 * @param {string|number|Array} slots 槽位（'equip1' / 1 / ['equip1','equip2']）
 * @param {object} [opts]
 * @param {boolean} [opts.all] 传 true 表示废除全部装备区
 * @param {boolean} [opts.discard=true] 是否弃置区内原有的牌
 * @param {string} [opts.reason] 日志原因
 * @returns {Promise<Card[]>} 被弃置的牌
 */
export async function disableEquipSlots(player, slots, opts = {}) {
  if (!player) return [];
  const g = player.game;
  const { discard = true, reason = '' } = opts;

  // 归一化槽位
  let keys = [];
  if (opts.all) {
    keys = Object.values(SLOT_BY_NUM);
  } else {
    const raw = Array.isArray(slots) ? slots : [slots];
    keys = raw.map((s) => (typeof s === 'number' ? SLOT_BY_NUM[s] : s)).filter(Boolean);
  }
  if (!keys.length) return [];

  const lost = [];
  for (const key of keys) {
    // ① 标记为废除
    if (!player.disabledEquips.includes(key)) player.disabledEquips.push(key);
    // ② 区内原有的牌 → 弃置
    const card = player.equips && player.equips[key];
    if (card) {
      player.equips[key] = null;
      lost.push(card);
    }
  }

  if (lost.length && discard) {
    // ⚠️ 必须传数组（toDiscard 只收一个参数）
    g.toDiscard(lost, { direct: true });
  }

  if (g) {
    const label = keys.map((k) => SLOT_LABEL[k] || k).join('、');
    g.log(`${player.name} 的${label}被废除${reason ? `（${reason}）` : ''}`
      + `${lost.length ? `，其中的 ${lost.length} 张牌被弃置` : ''}`);
    g.emit();
  }
  return lost;
}

const SLOT_LABEL = {
  equip1: '武器区', equip2: '防具区', equip3: '进攻马区',
  equip4: '防御马区', equip5: '宝物区',
};

/** 恢复一个或多个区域 */
export function enableEquipSlots(player, slots, opts = {}) {
  if (!player) return [];
  let keys = [];
  if (opts.all) {
    keys = Object.values(SLOT_BY_NUM);
  } else {
    const raw = Array.isArray(slots) ? slots : [slots];
    keys = raw.map((s) => (typeof s === 'number' ? SLOT_BY_NUM[s] : s)).filter(Boolean);
  }
  player.disabledEquips = player.disabledEquips.filter((k) => !keys.includes(k));
  if (player.game) {
    player.game.log(`${player.name} 的`
      + `${keys.map((k) => SLOT_LABEL[k] || k).join('、')}被恢复`);
    player.game.emit();
  }
  return keys;
}

/** 某区域是否已被废除 */
export function isSlotDisabled(player, slot) {
  if (!player || !player.disabledEquips) return false;
  const key = typeof slot === 'number' ? SLOT_BY_NUM[slot] : slot;
  return player.disabledEquips.includes(key);
}

/* ============================================================
 * L. 发现（官方机制的延伸；按需求方描述实现）
 * ============================================================
 * ⚠️ 与无名杀的差异（已与需求方确认按本描述实现）：
 *    无名杀的 `discoverCard` 是「从候选池随机取 num 张、选 1 张获得」；
 *    本机制按需求方描述实现为**翻牌堆直到翻出符合的牌**。
 *
 * 需求方给定规则：
 *   · 从目标位置（默认对应牌堆顶）翻开牌，
 *     直到翻开的牌为「要发现的牌」，则获得之然后结束流程；
 *   · 若同时发现**多张**牌，则直到翻开的**牌全部符合**
 *     要发现的牌后（例如发现 2 张锦囊，直到 2 张锦囊被翻开为止），
 *     获得目标牌然后结束流程。
 */

/**
 * 执行「发现」
 * @param {Game} game
 * @param {Player} player 发现者
 * @param {Function|object} spec 目标条件
 *        - 函数：(card) => boolean
 *        - 对象：{ name:'jiedao' } 或 { type:'trick' } 或 { names:[...] }
 * @param {object} [opts]
 * @param {number} [opts.count=1] 需要发现几张（全部符合才结束）
 * @param {string} [opts.from='top'] 'top'（牌堆顶）| 'bottom'（牌堆底）
 * @param {boolean} [opts.gain=true] 是否获得翻出的目标牌
 * @param {number} [opts.maxFlip=60] 安全上限，防止无限翻
 * @returns {Promise<{found:Card[], flipped:Card[], exhausted:boolean}>}
 */
export async function discover(game, player, spec, opts = {}) {
  const {
    count = 1, from = 'top', gain = true, maxFlip = 60,
  } = opts;

  const match = makeMatcher(spec);
  const found = [];
  const flipped = [];
  let exhausted = false;

  for (let i = 0; i < maxFlip; i++) {
    if (found.length >= count) break;
    // 从指定位置取一张
    // 注意：引擎的 takeFromDeckXxx 接收「数量」并返回数组；
    //       第二个参数传 true 表示牌堆空时**不自动洗牌**，
    //       这样「翻到翻不动为止」的语义才成立（否则会无限续牌）。
    const batch = (from === 'bottom')
      ? game.takeFromDeckBottom(1, true)
      : game.takeFromDeckTop(1, true);
    const card = batch && batch[0];
    if (!card) { exhausted = true; break; }

    flipped.push(card);
    if (match(card)) {
      found.push(card);
      game.log(`【发现】翻出了 ${card.fullname || card.name}`
        + `（${found.length}/${count}）`);
    } else {
      // 不符合的牌置入弃牌堆
      game.toDiscard([card], { direct: true });
      game.log(`【发现】翻出 ${card.fullname || card.name}，不符合条件，置入弃牌堆`);
    }
  }

  if (exhausted) {
    game.log(`【发现】牌堆已空，仅发现 ${found.length}/${count} 张`);
  }

  // 获得目标牌
  if (gain && found.length) {
    await player.gain(found);
    game.log(`${player.name} 通过【发现】获得了 `
      + found.map((c) => c.fullname || c.name).join('、'));
  }

  game.emit();
  return { found, flipped, exhausted };
}

/** 把 spec 归一化成判定函数 */
function makeMatcher(spec) {
  if (typeof spec === 'function') return spec;
  if (!spec) return () => false;
  if (typeof spec === 'string') {
    return (c) => c && c.name === spec;
  }
  return (c) => {
    if (!c) return false;
    if (spec.name && c.name !== spec.name) return false;
    if (spec.names && !spec.names.includes(c.name)) return false;
    if (spec.type && c.type !== spec.type) return false;
    if (spec.subtype && c.subtype !== spec.subtype) return false;
    if (spec.suit && c.suit !== spec.suit) return false;
    return true;
  };
}

