/**
 * 轮换牌（卡包）系统
 * ==================================================================
 * 需求方给定：
 *   · 「轮换牌」有很多卡包，每个卡包的点数花色都固定一样，**只有内容不同**；
 *   · 每局开始时随机挑一个卡包，把这 12 张牌**加进**牌堆（固定 196 张 + 12 张 = 208 张）；
 *   · 日志要写清楚用的是哪个包。
 *
 * 12 个固定位置（按点数从小到大）：
 *   黑桃 1、红桃 2、方块 3、梅花 4、黑桃 5、红桃 6、
 *   方块 8、梅花 9、红桃 10、梅花 11、黑桃 12、方块 13
 * （没有点数 7）
 */

import { CARDS } from '../cards.js';
import { Card } from '../engine/card.js';

/** 12 个固定位置：[花色, 点数] */
export const ROTATION_SLOTS = [
  ['spade', 1],
  ['heart', 2],
  ['diamond', 3],
  ['club', 4],
  ['spade', 5],
  ['heart', 6],
  ['diamond', 8],
  ['club', 9],
  ['heart', 10],
  ['club', 11],
  ['spade', 12],
  ['diamond', 13],
];

/**
 * 卡包清单：cards 按点数从小到大对应 ROTATION_SLOTS。
 * 新增卡包只要往这个数组里追加一条即可。
 */
export const ROTATION_PACKS = [
  {
    id: 'shen',
    name: '星神的一瞥',
    cards: [
      'nanuke',          // 黑桃 1
      'lan',             // 红桃 2
      'boshizun',        // 方块 3
      'ix',              // 梅花 4
      'kelipo',          // 黑桃 5
      'yaoshi',          // 红桃 6
      'aoboluosi',       // 方块 8
      'aha',             // 梅花 9
      'tayiziyuluosi',   // 红桃 10
      'xipei',           // 梅花 11
      'misi',            // 黑桃 12
      'fuli',            // 方块 13
    ],
  },
  {
    id: 'tongbao',
    name: '通宝雅集',
    cards: [
      'dayantongbao',    // 黑桃 1
      'hanre',           // 红桃 2
      'hongcai',         // 方块 3
      'wurenzhizheng',   // 梅花 4
      'baiyejuxing',     // 黑桃 5
      'hanmenzhi',       // 红桃 6
      'yuliangyi',       // 方块 8
      'zhanxueliu',      // 梅花 9
      'yiziluo',         // 红桃 10
      'zhengshangji',    // 梅花 11
      'baizaoshengjing', // 黑桃 12
      'guijidaibi',      // 方块 13
    ],
  },
];

/** 随机挑一个卡包（可用 game.randomPick，也可外部注入） */
export function pickRotationPack(packs = ROTATION_PACKS) {
  return packs[Math.floor(Math.random() * packs.length)];
}

/**
 * 把卡包内容放进牌堆
 * ----------------------------------------------------------------
 * 12 个卡包牌是**额外追加**的 12 张：固定牌堆 196 张 + 轮换 12 张 = 208 张，
 * 不与固定牌堆里的牌互换。
 *
 * @returns {{pack: object, added: Array<object>, replaced: Array<object>}}
 */
export function applyRotation(deck, pack = pickRotationPack()) {
  const added = [];
  ROTATION_SLOTS.forEach(([suit, number], i) => {
    const name = pack.cards[i];
    if (!name) return;
    const card = new Card(suit, number, name);
    card.fullname = (CARDS[name] && CARDS[name].fullname) || name;
    card.rotationPack = pack.id;
    deck.push(card);
    added.push(card);
  });
  return { pack, added, replaced: added };
}

/** 供测试/日志用：一个包的内容摘要 */
export function packSummary(pack) {
  return `${pack.name}（${pack.cards.length} 张）`;
}
