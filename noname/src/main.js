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
  const identities = IDENTITY_5.slice(0, count);

  // 随机打乱身份，但玩家位置固定 0，主公在随机座位
  const shuffled = identities.slice();
  // 保证恰有一个主公
  for (let i = shuffled.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
  }

  const used = new Set([humanChar]);
  const seatConfig = [];
  for (let i = 0; i < count; i++) {
    let charId;
    if (shuffled[i] === 'zhu') {
      const lords = LORD_CHARS.filter((c) => !used.has(c));
      charId = lords.length
        ? lords[Math.floor(Math.random() * lords.length)]
        : ALL_CHARS.filter((c) => !used.has(c))[0];
    } else if (i === 0) {
      charId = humanChar;
    } else {
      const p = ALL_CHARS.filter((c) => !used.has(c));
      charId = p[Math.floor(Math.random() * p.length)];
    }
    used.add(charId);
    seatConfig.push({ charId, identity: shuffled[i], isHuman: i === 0 });
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