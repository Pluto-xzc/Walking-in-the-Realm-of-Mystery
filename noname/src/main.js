/**
 * 入口：装配整局游戏
 * ------------------------------------------------------------------
 * 流程（官方身份模式）：
 *   1. 显示开屏（开源声明 + 资源预加载）
 *   2. 选择模式：官方（先给身份） / 自由（自选身份 + 全武将池）
 *   3. 官方模式 → 随机身份 → 按身份给候选武将 → 选将
 *      自由模式 → 自选身份 → 全武将池任选
 *   4. 创建对局并运行
 */

import { CHARACTERS, LORD_CHARS, ALL_CHARS, CHAR_STATS } from './characters.js';
import { DECK_LIST } from './cards.js';
import { UI } from './ui.js';
import { IDENTITY_5, IDENTITY_LABEL, CHOICE_NUM, buildCandidatePool, dealIdentities } from './match.js';
import { Game } from './engine.js';
import { AI } from './ai.js';

/** 玩家在自由模式可选的身份 */
const FREE_IDENTITIES = ['zhu', 'zhong', 'fan', 'nei'];

function shuffle(arr) {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

async function boot() {
  const ui = new UI();
  ui.init();

  // 开屏
  await ui.showSplash({ chars: CHAR_STATS.total, cards: DECK_LIST.length });

  /* ============================================================
   * ① 选择模式
   * ============================================================
   * 官方：先随机分发身份，再按身份给候选武将
   *       （主公 10 / 忠臣 6 / 内奸 6 / 反贼 5）
   * 自由：自选身份，且从**全部武将池**任选
   *       （测试武将、自由对局用）
   * ============================================================ */
  const mode = await ui.chooseMode();

  const count = 5;
  let humanIdentity;
  let candidatePool;
  let freeMode = false;

  if (mode === 'free') {
    freeMode = true;
    // 自由模式：玩家自选身份
    humanIdentity = await ui.chooseIdentity(FREE_IDENTITIES, '选 择 身 份（自由模式）');
    if (!humanIdentity) humanIdentity = shuffle(FREE_IDENTITIES)[0];   // 返回则随机
    candidatePool = [...ALL_CHARS];                                     // 全武将池
  } else {
    // 官方模式：先随机分发身份
    // ------------------------------------------------------------
    // 关键：**先从真实配比里随机抽一个身份给玩家**，再排座位。
    // 反面教材：若写成「1 号位恒为主公，玩家随机坐 2~5 号位」，
    // 则玩家永远拿不到主公——身份分布会退化成恒定值。
    //
    // 配比（5 人局）：主公 1 / 忠臣 1 / 反贼 2 / 内奸 1，
    // 所以从这 5 个身份里等概率抽一个给玩家即可（主公概率 1/5）。
    const idents = dealIdentities(count);
    humanIdentity = shuffle(idents.slice())[0];

    // 主公必须坐 1 号位；其他身份随机坐 2~5 号位
    const humanSeat = humanIdentity === 'zhu'
      ? 0
      : 1 + Math.floor(Math.random() * (count - 1));
    // 按身份给候选武将
    candidatePool = buildCandidatePool(humanIdentity);
    // 把身份与座位挂到 ui 上，供后续装配使用
    ui._dealIdents = idents;
    ui._humanSeat = humanSeat;
    ui._humanIdentity = humanIdentity;
  }

  /* ============================================================
   * ② 选将
   * ============================================================ */
  const isLord = humanIdentity === 'zhu';
  const ruleText = freeMode
    ? `自由模式：从全部 ${ALL_CHARS.length} 名武将中任选（当前身份：${IDENTITY_LABEL[humanIdentity]}）`
    : `当前身份：${IDENTITY_LABEL[humanIdentity]}｜候选 ${candidatePool.length} 名`
      + `（主公 ${CHOICE_NUM.zhu} / 忠臣 ${CHOICE_NUM.zhong} / 内奸 ${CHOICE_NUM.nei} / 反贼 ${CHOICE_NUM.fan}）`;
  const humanChar = await ui.chooseCharacter(candidatePool, isLord, {
    identity: humanIdentity,
    ruleText,
    freeMode,
  });

  /* ============================================================
   * ③ 装配座位
   * ============================================================
   * 身份规则：
   *   · 主公固定 1 号位（下标 0）；若玩家是主公则玩家坐 1 号位
   *   · 其他身份随机填满剩余座位
   * 配比恒为 主1 / 忠1 / 反2 / 内1。
   * ============================================================ */
  const allIdents = freeMode ? dealIdentities(count) : ui._dealIdents;
  // 非主公身份只坐 2~5 号位；主公必坐 1 号位
  const humanSeat = humanIdentity === 'zhu'
    ? 0
    : (freeMode
      ? 1 + Math.floor(Math.random() * (count - 1))
      : ui._humanSeat);

  const finalIdents = new Array(count).fill(null);
  finalIdents[0] = 'zhu';               // 1 号位永远是主公
  finalIdents[humanSeat] = humanIdentity;   // 玩家座位（若玩家是主公则也是 0 号位）

  // 剩余身份：从全场身份里扣掉已用的，随机填到空座位
  const remaining = allIdents.slice();
  const takeOne = (identity) => {
    const idx = remaining.indexOf(identity);
    if (idx >= 0) remaining.splice(idx, 1);
  };
  takeOne('zhu');
  takeOne(humanIdentity);
  const spare = shuffle(remaining);
  for (let i = 0; i < count; i++) {
    if (finalIdents[i] === null) finalIdents[i] = spare.shift() || 'fan';
  }

  // ---- 武将分配 ----
  const used = new Set([humanChar]);
  const seatConfig = [];
  for (let i = 0; i < count; i++) {
    const isHuman = i === humanSeat;
    let charId;
    if (isHuman) {
      charId = humanChar;
    } else if (finalIdents[i] === 'zhu') {
      // 主公从常备主公里选
      const lords = LORD_CHARS.filter((c) => !used.has(c));
      charId = lords.length ? shuffle(lords)[0]
        : shuffle(ALL_CHARS.filter((c) => !used.has(c)))[0];
    } else {
      const pool = ALL_CHARS.filter((c) => !used.has(c));
      charId = shuffle(pool)[0];
    }
    used.add(charId);
    seatConfig.push({ charId, identity: finalIdents[i], isHuman });
  }

  // 创建游戏
  const game = new Game();
  game.seatConfig = seatConfig;
  game.modeName = freeMode ? '自由' : '身份';
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