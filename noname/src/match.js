/**
 * 身份模式（5 人局）与对局装配
 * ------------------------------------------------------------------
 * 5 人局身份配比：主公 1 / 忠臣 1 / 反贼 2 / 内奸 1
 */

import { CHARACTERS, LORD_CHARS, ALL_CHARS } from './characters.js';
import { AI } from './ai.js';
import { Game } from './engine.js';

/** 5 人局身份配置 */
export const IDENTITY_5 = ['zhu', 'zhong', 'fan', 'fan', 'nei'];

export const IDENTITY_LABEL = {
  zhu: '主公',
  zhong: '忠臣',
  fan: '反贼',
  nei: '内奸',
};

export const IDENTITY_COLOR = {
  zhu: '#d4a017',
  zhong: '#b03a3a',
  fan: '#3d8b6e',
  // 内奸：原先 #7a6a55 是灰褐色，做成角标后发闷、显脏。
  // 换成偏冷的暗紫，与魏/蜀/吴/群的身份色都能区分开，也更有辨识度。
  nei: '#6b4fa8',
};

function shuffle(arr) {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

/**
 * 组装一局游戏
 * @param {object} opts
 *   humanCharId  玩家选择的武将（可选，默认随机）
 *   playerCount  人数（默认 5）
 */
export function createMatch(opts = {}) {
  const count = opts.playerCount || 5;
  const identities = IDENTITY_5.slice(0, count);

  // 主公固定
  const lordIdx = 0;

  // 选将：玩家优先；AI 随机
  const used = new Set();
  const humanChar = opts.humanCharId && CHARACTERS[opts.humanCharId]
    ? opts.humanCharId
    : shuffle(ALL_CHARS)[0];
  used.add(humanChar);

  const seats = [];
  for (let i = 0; i < count; i++) {
    let charId;
    if (i === 0) {
      // 主公从常备主公中选
      const lords = LORD_CHARS.filter((c) => !used.has(c));
      charId = lords.length ? shuffle(lords)[0] : shuffle(ALL_CHARS.filter((c) => !used.has(c)))[0];
    } else if (i === 1 && opts.humanSeat === 1) {
      charId = humanChar;
    } else {
      const pool = ALL_CHARS.filter((c) => !used.has(c));
      charId = shuffle(pool)[0];
    }
    used.add(charId);
    seats.push({ charId, identity: identities[i], isHuman: false });
  }

  // 玩家固定在座位 0，主公也固定在座位 0？
  // 这里让玩家永远坐 0 号位，主公身份按 identities 分配
  const humanSeat = 0;
  seats[humanSeat].isHuman = true;
  seats[humanSeat].charId = humanChar;

  // 若玩家不是主公，则主公在别的座位；此处保持 identities 顺序
  const game = new Game();
  game.identityConfig = identities;
  game.seatConfig = seats;
  return game;
}

/**
 * 启动对局
 * @param {Game} game
 * @param {object} io    UI 交互实现
 */
export async function startMatch(game, io) {
  const ai = new AI(game);

  // 绑定身份
  const chars = game.seatConfig.map((s, i) => {
    const p = { charId: s.charId, isHuman: s.isHuman };
    return p;
  });

  // 先 setup 再写身份
  await game.setup(chars, io, ai);
  game.players.forEach((p, i) => {
    p.identity = game.seatConfig[i].identity;
    p.isZhu = p.identity === 'zhu';
    // 主公 +1 体力上限
    if (p.isZhu) { p.maxHp += 1; p.hp += 1; }
    // 仅玩家自己的身份可见
    p.identityShown = p.isHuman || p.identity === 'zhu';
  });

  // 主公身份公开
  const zhu = game.players.find((p) => p.identity === 'zhu');
  if (zhu) zhu.identityShown = true;

  await game.runGame(chars, io, ai);
  return game;
}

export default { createMatch, startMatch, IDENTITY_5, IDENTITY_LABEL, IDENTITY_COLOR };