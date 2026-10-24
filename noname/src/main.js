/**
 * 入口：装配整局游戏
 * ------------------------------------------------------------------
 * 流程：
 *   1. 显示开屏（开源声明 + 资源预加载）
 *   2. 玩家选将
 *   3. 创建对局并运行
 */

import { CHARACTERS, LORD_CHARS, ALL_CHARS, CHAR_STATS } from './characters.js';
import { DECK_LIST } from './cards.js';
import { UI } from './ui.js';
import { IDENTITY_5 } from './match.js';
import { Game } from './engine.js';
import { AI } from './ai.js';

async function boot() {
  const ui = new UI();
  ui.init();

  // 开屏
  await ui.showSplash({ chars: CHAR_STATS.total, cards: DECK_LIST.length });

  // 选将：玩家先从全部武将中挑
  const pool = [...ALL_CHARS];
  const humanChar = await ui.chooseCharacter(pool, false);

  // 组装座位
  const count = 5;

  // ---- 身份分配 ----
  // 规则（按你的要求）：
  //   - 主公固定在 1 号位（seat 0），行动顺序 1→2→3→4→5
  //   - 其余身份（忠臣/反贼/反贼/内奸）随机分配到 2~5 号位
  //   - 玩家**随机**坐在 2~5 号位之一（不再固定）
  //   - 例外：若玩家选了常备主公武将，则玩家坐 1 号位当主公
  const humanIsLord = LORD_CHARS.includes(humanChar);

  const others = IDENTITY_5.filter((x) => x !== 'zhu');   // ['zhong','fan','fan','nei']
  for (let i = others.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [others[i], others[j]] = [others[j], others[i]];
  }

  // 玩家座位：随机落在 2~5 号位（绝对下标 1~4）
  const humanSeat = 1 + Math.floor(Math.random() * (count - 1));

  // ---- 武将分配 ----
  const lordIds = LORD_CHARS.filter((c) => c !== humanChar);
  for (let i = lordIds.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [lordIds[i], lordIds[j]] = [lordIds[j], lordIds[i]];
  }
  const lordChar = lordIds[0] || ALL_CHARS.find((c) => c !== humanChar);

  // 身份顺序：1 号位固定主公，其余按打乱后的顺序分配到 2~5 号位
  const idents = ['zhu', ...others];

  const used = new Set([humanChar, lordChar]);
  const seatConfig = [];
  for (let i = 0; i < count; i++) {
    // 玩家坐在哪：默认随机位；若玩家自己是主公则坐 1 号位
    const isHuman = humanIsLord ? (i === 0) : (i === humanSeat);
    let charId;
    if (i === 0) {
      charId = humanIsLord ? humanChar : lordChar;   // 1 号位永远是主公
    } else if (isHuman) {
      charId = humanChar;
    } else {
      const pool = ALL_CHARS.filter((c) => !used.has(c));
      charId = pool[Math.floor(Math.random() * pool.length)];
    }
    used.add(charId);
    seatConfig.push({ charId, identity: idents[i], isHuman });
  }

  // 创建游戏
  const game = new Game();
  game.seatConfig = seatConfig;
  ui.attach(game);

  const ai = new AI(game);
  const chars = seatConfig.map((s) => ({ charId: s.charId, isHuman: s.isHuman }));

  await game.setup(chars, ui, ai);

  // 分配身份
  game.players.forEach((p, i) => {
    p.identity = seatConfig[i].identity;
    p.isZhu = p.identity === 'zhu';
    if (p.isZhu) { p.maxHp += 1; p.hp += 1; }
    p.identityShown = p.isHuman || p.isZhu;
  });

  ui.render();

  // 运行
  await game.runGame(chars, ui, ai);

  // 结算
  ui.showResult(game);
}

// 启动
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', boot);
} else {
  boot();
}