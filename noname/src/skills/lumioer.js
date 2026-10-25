/**
 * 璐米欧儿（暗影诗篇 · 势力「影」）的两个技能
 * ==================================================================
 * 需求方给定文案：
 *
 *   金银合纵
 *     出牌阶段限 3 次，你可以弃置 3 张牌并摸其中花色数张牌；
 *     有◆牌进入弃牌堆的回合结束时，你可获得其中 1 张◆牌并使用此技能。
 *
 *   黑白乱舞
 *     你有 2 张牌被同时弃置时，可用其中的牌发动一次『界乱击』。
 *
 * 与需求方逐条确认过的判定（都是「按字面」的裁定，勿自行改写）：
 *   ① 「◆牌」= **方块牌**（◆ 只是字体把 ♦ 显示成了 ◆）。
 *   ② 「摸其中花色数张牌」= 那 3 张牌里**不同花色的种数**。
 *      ♠♥♦ → 3；♠♠♥ → 2；♠♠♠ → 1。
 *   ③ 回合结束那一条**只看有没有**方块牌进过弃牌堆（不看几张），
 *      获得其中 1 张后，可**选择**再执行一次「弃 3 摸花色数」，
 *      也可以不执行。
 *   ④ 「你有 2 张牌被同时弃置」限**你自己的**牌，
 *      且以「同一次弃置动作」为准（同一次 Player.discard 调用）。
 *   ⑤ 『界乱击』不限发动次数，但受它自身的
 *      「每种花色每回合限一次」约束 —— 用过的花色不能再用；
 *      四个花色都用过就再也发不了。
 *
 * 本引擎（相对无名杀）的差异，实现时据此调整：
 *   · 不支持无名杀的 subSkill / group 派生写法 —— 派生技能一律
 *     作为**顶层技能**单独登记，由武将的 skills 数组一起挂上。
 *   · 确认框走 `game.io.chooseOption(player, prompt, options)`（位置参数），
 *     options 是 `[{key,label}]` 数组，返回 key。
 *   · 视为使用牌走本引擎 G.play 里「剪辑高手」那套：
 *     `makeVirtualCard(def)` → `useCard(player, ghost, targets)`。
 */

/** 金银合纵：出牌阶段的使用次数上限 */
const JINYING_USABLE = 3;

/** 金银合纵：弃牌数 */
const JINYING_COST = 3;

const SUIT_LABEL = {
  spade: '♠', heart: '♥', club: '♣', diamond: '♦',
};

/** 花色符号，用于日志 */
function suitText(suit) {
  return SUIT_LABEL[suit] || suit || '?';
}

export default {
  /* ==================================================================
   * 金银合纵
   * ================================================================== */
  jinyinghezong: {
    id: 'jinyinghezong', name: '金银合纵',
    desc: `出牌阶段限${JINYING_USABLE}次，你可以弃置${JINYING_COST}张牌`
      + '并摸其中花色数张牌；'
      + '有◆牌进入弃牌堆的回合结束时，你可获得其中1张◆牌并使用此技能。',
    type: 'active', trigger: 'phaseUse', usable: JINYING_USABLE,
    filter: (ctx) => ctx.player.countCards('he') >= JINYING_COST,

    async content(ctx) {
      const { player, game } = ctx;
      return runJinyinghezong(player, game);
    },
  },

  /**
   * 金银合纵 · 回合结束的额外发动
   * ------------------------------------------------------------------
   * 单独登记为一个技能（本引擎无 subSkill），由武将 skills 数组一并挂上。
   * 这是**额外的**发动机会，不占出牌阶段的 3 次额度
   *（额度只针对「出牌阶段限3次」那一句）。
   */
  jinyinghezong_end: {
    id: 'jinyinghezong_end', name: '金银合纵',
    desc: '有◆牌进入弃牌堆的回合结束时，你可获得其中1张◆牌并使用此技能。',
    type: 'trigger', trigger: 'turnEnd',
    filter: (ctx) => {
      const { player, game, event } = ctx;
      // 只在自己回合结束时发动
      if (event && event.player && event.player !== player) return false;
      return game.turnDiscarded('diamond').length > 0;
    },
    async content(ctx) {
      const { player, game } = ctx;
      const diamonds = game.turnDiscarded('diamond');

      /* ---- ① 获得其中 1 张方块牌 ---- */
      const pick = await chooseDiamond(player, game, diamonds);
      if (pick) {
        await game.playerGain(player, [pick], null);
        game.log(`【金银合纵】${player.name} 获得了弃牌堆中的 ${pick.text}`);
      }

      /* ---- ② 「并使用此技能」：可选择再执行一次 ---- */
      if (player.countCards('he') < JINYING_COST) {
        game.log(`【金银合纵】${player.name} 可用牌不足 ${JINYING_COST} 张，`
          + '无法再发动');
        return false;
      }
      const again = await askYesNo(game, player,
        '【金银合纵】：是否再弃置 3 张牌并摸其中花色数张？');
      if (!again) return false;
      return runJinyinghezong(player, game);
    },
  },

  /* ==================================================================
   * 黑白乱舞
   * ================================================================== */
  heibailuanwu: {
    id: 'heibailuanwu', name: '黑白乱舞',
    desc: '你有2张牌被同时弃置时，可用其中的牌发动一次『界乱击』。',
    /*
     * 这是「弃置时点」的被动技，由引擎在 Player.discard 里**主动通知**
     *（game.notifyDiscardBatch），不写在 checkSkills 的时机表里 ——
     * 「同时弃置」不是回合事件，时机体系里没有对应时点。
     */
    type: 'trigger', trigger: 'cardsDiscarded',
    async content(ctx) {
      const { player, game, event } = ctx;
      const batch = (event && event.batch) || [];
      return runHeibailuanwu(player, game, batch);
    },
  },

  /**
   * 『界乱击』
   * ==================================================================
   * 需求方给定：
   *   出牌阶段，你可以将两张手牌当【万箭齐发】使用
   *   （每种花色每回合限一次）；
   *   当其他角色打出【闪】响应你使用的【万箭齐发】结算结束后，
   *   其摸一张牌；
   *   当你使用【万箭齐发】结算结束后，若此牌没有造成过伤害，
   *   你摸等同于此牌目标数的牌。
   *
   * 无名杀对应实现为 `reluanji`（神化·乱击），语义已逐条比对：
   *   · 记「本回合以此法用过的花色」（storage），据此限制每种花色一次；
   *   · 「打出【闪】的响应者摸一张」用 respond 时点；
   *   · 「未造成伤害则摸目标数张」用 useCardAfter 时点。
   * 本项目按此洁净室重写，不引用其代码。
   *
   * 本技能不由玩家主动点按钮发动 —— 发动机会由【黑白乱舞】提供
   *（需求方口径：「用其中的牌发动一次界乱击」）。
   * 下面这个顶层条目只承接「使用结算结束后」那一条效果；
   * 花色限制与选牌逻辑在 runHeibailuanwu / markLuanjiSuits 里。
   */
  luanji_jie: {
    id: 'luanji_jie', name: '界乱击',
    desc: '出牌阶段，你可以将两张手牌当【万箭齐发】使用（每种花色每回合限一次）；'
      + '当其他角色打出【闪】响应你使用的【万箭齐发】结算结束后，其摸一张牌；'
      + '当你使用【万箭齐发】结算结束后，若此牌没有造成过伤害，'
      + '你摸等同于此牌目标数的牌。',
    type: 'trigger', trigger: 'luanjiAfter',
    async content(ctx) {
      const { player, game, event } = ctx;
      return resolveLuanjiAfter(player, game, event);
    },
  },
};

/* ==================================================================
 * 金银合纵
 * ================================================================== */

/**
 * 金银合纵的一次结算：弃 3 张，摸「其中花色数」张
 * ------------------------------------------------------------------
 * 「其中花色数」= 弃置的这 3 张牌里不同花色的**种数**。
 */
async function runJinyinghezong(player, game) {
  const cards = await game.io.chooseCards(player, {
    prompt: `【金银合纵】：弃置 ${JINYING_COST} 张牌`
      + '（摸牌数 = 这些牌里不同花色的种数）',
    position: 'he',
    min: JINYING_COST, max: JINYING_COST,
    cancelable: true,
  });
  if (!cards || cards.length < JINYING_COST) return false;

  const suits = [...new Set(cards.map((c) => c.suit))];
  await player.discard(cards);
  game.log(`【金银合纵】${player.name} 弃置 ${cards.length} 张`
    + `（${suits.map(suitText).join('、')}），摸 ${suits.length} 张牌`);
  if (suits.length > 0) await player.draw(suits.length);
  return true;
}

/**
 * 从弃牌堆里的方块牌中选 1 张
 * ------------------------------------------------------------------
 * 人类玩家从弹窗里选；AI 取第一张。返回 null 表示不拿。
 */
async function chooseDiamond(player, game, diamonds) {
  if (!diamonds.length) return null;
  if (diamonds.length === 1 || !player.isHuman) return diamonds[0];
  const picked = await game.io.chooseCards(player, {
    prompt: '【金银合纵】：获得弃牌堆中的 1 张◆牌',
    position: 'discard',
    cardList: diamonds,
    min: 0, max: 1, cancelable: true,
  });
  return (picked && picked[0]) || null;
}

/* ==================================================================
 * 黑白乱舞 + 界乱击
 * ================================================================== */

/**
 * 黑白乱舞：用被同时弃置的牌发动一次界乱击
 * ------------------------------------------------------------------
 * 「你有 2 张牌被同时弃置时，可用其中的牌发动一次『界乱击』。」
 * 这些牌**已经进弃牌堆**，这里把它们当作「视为使用【万箭齐发】」所用的牌
 *（与无名杀 reluanji 的 `position: 'hs'` 同义：可从手牌/装备区取用）。
 *
 * @param {Card[]} batch 同一次弃置动作里所有玩家的牌
 */
async function runHeibailuanwu(player, game, batch) {
  const mine = (batch || []).filter((c) => c && c._discardOwner === player);
  if (mine.length < 2) return false;

  game.log(`【黑白乱舞】${player.name} 有 ${mine.length} 张牌被同时弃置，`
    + '可发动一次【界乱击】');

  // 花色限制：本回合已用过的花色不能再选
  const used = usedLuanjiSuits(player, game);
  const usable = mine.filter((c) => !used.includes(c.suit));
  if (usable.length < 2) {
    game.log('【黑白乱舞】可用花色不足 2 种'
      + `（本回合已用：${used.map(suitText).join('、') || '无'}），无法发动【界乱击】`);
    return false;
  }

  const use = await askYesNo(game, player,
    '【黑白乱舞】：是否用其中 2 张牌发动【界乱击】（视为使用【万箭齐发】）？');
  if (!use) return false;

  let pick;
  if (player.isHuman) {
    pick = await game.io.chooseCards(player, {
      prompt: '【黑白乱舞】：选择 2 张牌发动【界乱击】',
      position: 'discard',
      cardList: usable,
      min: 2, max: 2, cancelable: false,
    });
  } else {
    pick = usable.slice(0, 2);
  }
  if (!pick || pick.length < 2) return false;

  // 记录本次用到的花色（每种花色每回合限一次）
  markLuanjiSuits(player, game, pick);
  game.log(`【界乱击】${player.name} 将 ${pick.map((c) => c.text).join('、')}`
    + '当【万箭齐发】使用（本回合已用花色：'
    + `${usedLuanjiSuits(player, game).map(suitText).join('、')}）`);

  const ghost = game.makeVirtualCard({ name: 'wanjian' });
  ghost.sourceCards = pick;
  ghost.luanjiFrom = true;
  if (typeof window !== 'undefined') {
    window.__dbgPick = pick.map((c) => ({
      ctor: c && c.constructor && c.constructor.name,
      isCard: c instanceof Object && typeof c.text === 'string',
      text: c && c.text, suit: c && c.suit, fullname: c && c.fullname,
      hasOwnText: c ? Object.prototype.hasOwnProperty.call(c, 'text') : null,
    }));
    window.__dbgLog = `【金银合纵】/界乱击 pick 数 ${pick.length}`;
  }
  const targets = await game.pickTargetsForVirtual(player, ghost);
  await game.useCard(player, ghost, targets);
  return true;
}

/**
 * 【界乱击】的收尾效果
 * ------------------------------------------------------------------
 * 由 useCard 在【万箭齐发】结算完毕后带着 event 触发（timing='luanjiAfter'）：
 *   · 此牌**未造成过伤害** → 摸「目标数」张。
 *「打出【闪】的响应者摸一张」在 askShan 里即时处理（见 engine）。
 */
async function resolveLuanjiAfter(player, game, event) {
  const card = event && event.card;
  if (!card || !card.luanjiFrom) return false;

  const targets = (event && event.targets) || [];
  /*
   * 伤害次数优先取 event 上的（引擎在 emitCardUsedAfter 里显式传入），
   * 取不到时回退到 card 自身的记账 —— 两个来源都指向 resolveAoe 里
   * 累加的同一个计数，回退只是为了 content 被单独调用时也正确。
   */
  const damaged = (event && event.luanjiDamaged)
    || card.luanjiDamaged || 0;

  if (damaged === 0) {
    const n = targets.length;
    game.log(`【界乱击】此【万箭齐发】未造成伤害，`
      + `${player.name} 摸 ${n} 张牌（目标数）`);
    if (n > 0) await player.draw(n);
  } else {
    game.log('【界乱击】此【万箭齐发】已造成伤害，不摸牌');
  }
  return true;
}

/** 本回合「界乱击」已用过的花色 */
function usedLuanjiSuits(player, game) {
  const rec = player.storage && player.storage.luanjiSuits;
  if (!rec || rec.turn !== game.turnCount) return [];
  return rec.suits || [];
}

/** 记下本次使用过的花色 */
function markLuanjiSuits(player, game, cards) {
  const suits = usedLuanjiSuits(player, game).slice();
  for (const c of cards) {
    if (c && c.suit && !suits.includes(c.suit)) suits.push(c.suit);
  }
  player.storage.luanjiSuits = { turn: game.turnCount, suits };
}

/* ==================================================================
 * 公共小工具
 * ================================================================== */

/** 是 / 否 询问（AI 默认「是」） */
async function askYesNo(game, player, prompt) {
  if (!player.isHuman) return true;
  const r = await game.io.chooseOption(player, prompt,
    [{ key: 'yes', label: '发动' }, { key: 'no', label: '不发动' }])
    .catch(() => 'no');
  return r === 'yes';
}