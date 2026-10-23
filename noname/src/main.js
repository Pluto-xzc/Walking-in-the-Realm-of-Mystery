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
  // 规则：主公固定在 1 号位（seat 0），其余身份随机分配到 2~5 号位。
  // 这样行动顺序就是「主公先手 → 2 号 → 3 号 → …」，符合身份模式惯例。
  const others = IDENTITY_5.filter((x) => x !== 'zhu');   // ['zhong','fan','fan','nei']
  for (let i = others.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [others[i], others[j]] = [others[j], others[i]];
  }
  const idents = ['zhu', ...others];

  // ---- 武将分配 ----
  // 主公从常备主公中选；其余随机（且不与已选重复）
  const lordIds = LORD_CHARS.slice();
  for (let i = lordIds.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [lordIds[i], lordIds[j]] = [lordIds[j], lordIds[i]];
  }
  const lordChar = lordIds.find((c) => c !== humanChar)
    || ALL_CHARS.find((c) => c !== humanChar);

  const used = new Set([humanChar, lordChar]);
  const seatConfig = [];
  for (let i = 0; i < count; i++) {
    let charId;
    if (i === 0) {
      charId = lordChar;                       // 1 号位永远主公
    } else if (i === 1) {
      charId = humanChar;                      // 玩家固定在 2 号位
    } else {
      const p = ALL_CHARS.filter((c) => !used.has(c));
      charId = p[Math.floor(Math.random() * p.length)];
    }
    used.add(charId);
    seatConfig.push({
      charId,
      identity: idents[i],
      // 玩家在 2 号位；若玩家自己就是主公（选了常备主公），则玩家坐 1 号位
      isHuman: i === 1,
    });
  }

  // 若玩家选的武将本身就是常备主公，则让玩家坐 1 号位当主公
  const humanIsLord = LORD_CHARS.includes(humanChar);
  if (humanIsLord) {
    seatConfig[0].charId = humanChar;
    seatConfig[0].isHuman = true;
    seatConfig[1].charId = lordChar;
    seatConfig[1].isHuman = false;
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