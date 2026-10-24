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

/* ============================================================
 * 候选武将数量（官方身份模式规则）
 * ============================================================
 * 官方流程是「先定身份，再按身份给不同数量的候选武将」：
 *   主公 10 人（含常备主公）、忠臣 6 人、内奸 6 人、反贼 5 人。
 *
 * ⚠️ 说明：无名杀源码里的**默认值**其实是
 *     choice_zhu=3 / choice_zhong=4 / choice_nei=6 / choice_fan=3
 *   （见 noname/library/index.js 的 config 定义），
 *   且主公是「常备主公全部 + choice_zhu 个随机」。
 *   本项目按需求方指定的数值实现（10/6/6/5），
 *   与无名杀默认值不同，特此注明，避免以后误以为抄错。
 */
export const CHOICE_NUM = {
  zhu: 10,
  zhong: 6,
  nei: 6,
  fan: 5,
};

/** 身份是否为主公（需要从常备主公里选） */
export function isLordIdentity(identity) {
  return identity === 'zhu';
}

function shuffle(arr) {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

/**
 * 按「官方身份模式」规则生成候选武将池
 * ------------------------------------------------------------------
 * 官方流程：**先分发身份**，再根据身份给出候选武将：
 *   - 主公 → 从**常备主公**里选（本项目按需求取 CHOICE_NUM.zhu 个候选）
 *   - 忠臣/内奸/反贼 → 从对应数量的普通武将里随机抽
 *
 * @param {string} identity  'zhu' | 'zhong' | 'nei' | 'fan'
 * @param {object} [opts]
 * @param {string[]} [opts.exclude] 需要排除的武将（如已被他人选走）
 * @returns {string[]} 候选武将 id 列表
 */
export function buildCandidatePool(identity, opts = {}) {
  const exclude = new Set(opts.exclude || []);
  const num = CHOICE_NUM[identity] || 5;

  if (identity === 'zhu') {
    // 主公：常备主公优先（这是官方规则的核心——主公必须是常备主公）
    const lords = LORD_CHARS.filter((c) => !exclude.has(c));
    if (lords.length >= 1) {
      // 常备主公不足 num 个时，用普通武将补足，保证候选数量稳定
      const extra = shuffle(ALL_CHARS.filter(
        (c) => !exclude.has(c) && !LORD_CHARS.includes(c),
      ));
      return shuffle(lords).concat(extra).slice(0, num);
    }
  }
  // 其他身份：从全部武将随机抽 num 个
  return shuffle(ALL_CHARS.filter((c) => !exclude.has(c))).slice(0, num);
}

/**
 * 生成一局的身份配置
 * ------------------------------------------------------------------
 * 5 人局固定为 主1 / 忠1 / 反2 / 内1，但**玩家拿到哪个身份是随机的**。
 * @param {number} count 人数
 * @returns {string[]} 每个座位的身份（下标即座位，0 号位固定主公）
 */
export function dealIdentities(count = 5) {
  const base = IDENTITY_5.slice(0, count);
  // 除主公外的身份打乱后分配给 2~5 号位
  const others = base.filter((x) => x !== 'zhu');
  return ['zhu', ...shuffle(others)];
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

export default {
  createMatch,
  startMatch,
  buildCandidatePool,
  dealIdentities,
  IDENTITY_5,
  IDENTITY_LABEL,
  IDENTITY_COLOR,
  CHOICE_NUM,
};