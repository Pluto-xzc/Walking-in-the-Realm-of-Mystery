/**
 * 冠位指定（势力「冠」）武将技能
 * ==================================================================
 * 本文件只放「冠位指定」包的技能，一个包一张表（与其他扩展包一致）。
 *
 * 当前武将：
 *   理查一世 ——【Excalibur(伪)】【百般骥足】
 *
 * 规则依据：需求方 m07688 的口述规则（无名杀库里没有这两名武将，
 * 全部为原创，因此注释里保留需求方原话，便于日后核对）。
 */
import { Card } from '../engine/card.js';
import { CARDS, SUITS, DAMAGE_CARD_KEYS, isDamageCardName } from '../cards.js';

/**
 * 「伤害类牌」判定
 * ----------------------------------------------------------------
 * 分类表统一放在 src/cards.js（DAMAGE_CARD_KEYS / isDamageCardName），
 * 这里只做一层薄封装，避免同一个清单写两遍。
 */
export const DAMAGE_CARDS = DAMAGE_CARD_KEYS;

export function isDamageCard(card) {
  return !!card && isDamageCardName(card.name);
}

const SUIT_OPTIONS = [
  { key: 'spade', label: '♠ 黑桃' },
  { key: 'heart', label: '♥ 红桃' },
  { key: 'club', label: '♣ 梅花' },
  { key: 'diamond', label: '♦ 方块' },
];

const suitLabel = (s) => {
  const d = SUITS[s];
  return d ? `${d.label}${d.name}` : s;
};

/** 目标选择：a) 牌自带固定目标（群体/只对自己）；b) 需要玩家点选 */
async function chooseCardTargets(game, player, card, maxTargets, noDistance) {
  const fixed = game.defaultTargetsFor(player, card);
  if (fixed) return fixed;

  const def = CARDS[card.name] || {};
  const cands = game.players.filter((p) => p.alive
    && !(p === player && def.notSelf)
    && game.canBeTargeted(p, card)
    && game.canTargetByLimits(player, p, card)
    && (noDistance || !needsRange(card) || game.cardNoDistance(player, card)
      || player.inAttackRange(p)));
  if (!cands.length) return null;
  return player.chooseTargets({
    prompt: `【Excalibur(伪)】请选择【${def.fullname || card.name}】的目标`,
    candidates: cands, min: 1, max: Math.min(maxTargets, cands.length),
  });
}

/** 只有在「有距离要求」的牌上才需要判断攻击范围（杀 / 顺手 / 兵粮） */
function needsRange(card) {
  return card.name === 'sha' || card.name === 'shunshou' || card.name === 'bingliang';
}

/**
 * 开局执行【Excalibur(伪)】的永续部分
 * ----------------------------------------------------------------
 * 把所有拥有该技能的角色武器栏废除。
 * 攻击范围 +1 由 `excalibur_yongxu.mod.attackRange` 提供，不需要在这里做。
 * 由 `src/engine/g-turn.js` 在开局初始化里调用；测试可直接调用。
 */
export function applyExcaliburWeaponSlot(game) {
  const owners = [];
  for (const p of game.players) {
    if (!p.skills || !p.skills.includes('excalibur')) continue;
    p.setEquipSlotDisabled('equip1', true);
    game.log(`【Excalibur(伪)】${p.name} 的武器栏被废除，攻击范围 +1`);
    owners.push(p);
  }
  return owners;
}

/** 把「弃置的牌」当成另一张牌使用 */
function makeGhost(source, name) {
  const def = CARDS[name] || {};
  const ghost = new Card(source.suit, source.number, name);
  ghost.fullname = def.fullname || def.label || name;
  ghost.virtual = true;
  ghost.sourceCards = [source];
  return ghost;
}

export default {
  /* ==================================================================
   * 一、Excalibur(伪)
   * ================================================================== */
  /**
   * 永续部分：武器栏废除 + 攻击范围 +1
   * ----------------------------------------------------------------
   * `sub: true` → 不作为独立按钮显示（按钮由上面的主动技提供）。
   * 武器栏废除在 src/engine/g-turn.js 的开局初始化里执行。
   */
  excalibur_yongxu: {
    id: 'excalibur_yongxu',
    name: 'Excalibur(伪)',
    desc: '锁定技，你的武器栏被废除，攻击范围 +1。',
    type: 'mod',
    locked: true,
    sub: true,
    mod: {
      attackRange: (player, range) => range + 1,
    },
  },
  excalibur: {
    id: 'excalibur',
    name: 'Excalibur(伪)',
    /*
     * 需求方原文：
     *   「锁定技，你的武器栏变为攻击范围+1；你使用伤害类牌时，可熔铸任意数量
     *     花色不同的手牌并可重复的选择X项：①伤害或目标+1；②令这张牌无距离
     *     次数限制；③令之不可响应。（X为弃置的花色种类数）」
     *   「一技能的武器栏效果是，自己的武器栏不能使用，取而代之的是默认的
     *     攻击范围+1，是永续效果。使用伤害类牌时的效果，可以做成主动点击
     *     按钮触发，先选用什么牌（先不指定目标），然后熔铸牌，然后选择效果。」
     */
    desc: '锁定技，你的武器栏被废除，攻击范围 +1。'
      + '出牌阶段，你可选择一张伤害类牌，熔铸任意数量花色各不相同的手牌'
      + '（熔铸：弃置），并重复选择 X 项（X 为熔铸的花色种类数）：'
      + '①此牌伤害 +1 或目标数 +1；②此牌无距离与次数限制；③此牌的目标不可响应。'
      + '然后使用此牌。',
    type: 'active',
    trigger: 'phaseUse',
    filter(ctx) {
      const { player, game } = ctx;
      if (!game.isInPlayPhase(player)) return false;
      return player.getCards('h', (c) => isDamageCard(c)).length > 0;
    },

    async content(ctx) {
      const { player, game } = ctx;

      // ① 选一张伤害类牌（此时不指定目标）
      const picked = await player.chooseCards({
        prompt: '【Excalibur(伪)】：选择一张伤害类牌（先不指定目标）',
        position: 'h', min: 1, max: 1, cancelable: true,
        filter: (c) => isDamageCard(c),
      });
      if (!picked || !picked.length) return;
      const card = picked[0];

      // ② 熔铸：任意张、花色互不相同
      const forged = [];
      const usedSuits = [];
      for (;;) {
        const avail = player.getCards('h')
          .filter((c) => c !== card && !usedSuits.includes(c.suit));
        if (!avail.length) break;
        const more = await player.chooseCards({
          prompt: `【Excalibur(伪)】熔铸第 ${forged.length + 1} 张牌`
            + `（已熔铸：${forged.length ? forged.map((c) => c.text).join('、') : '无'}；`
            + '花色必须各不相同，取消即结束熔铸）',
          position: 'h', min: 0, max: 1, cancelable: true,
          filter: (c) => c !== card && !usedSuits.includes(c.suit),
        });
        if (!more || !more.length) break;
        forged.push(more[0]);
        usedSuits.push(more[0].suit);
      }
      const X = forged.length;
      if (X > 0) {
        await player.discard(forged);
        game.log(`【Excalibur(伪)】${player.name} 熔铸了 ${forged.map((c) => c.text).join('、')}`
          + `（${X} 种花色：${usedSuits.map(suitLabel).join('、')}）`);
      }

      // ③ 重复选择 X 项
      let dmgBonus = 0;
      let tgtBonus = 0;
      let noLimit = false;
      let noRespond = false;
      for (let i = 0; i < X; i++) {
        const pick = await player.chooseOption({
          prompt: `【Excalibur(伪)】选择第 ${i + 1}/${X} 项（可重复选择同一项）`,
          options: [
            { key: 'dmg', label: '① 此牌伤害 +1' },
            { key: 'tgt', label: '① 此牌目标数 +1' },
            { key: 'limit', label: '② 无距离与次数限制' },
            { key: 'noresp', label: '③ 目标不可响应' },
          ],
        });
        if (pick === 'tgt') tgtBonus += 1;
        else if (pick === 'limit') noLimit = true;
        else if (pick === 'noresp') noRespond = true;
        else dmgBonus += 1;
      }

      // ④ 应用修正
      const chosenDef = CARDS[card.name] || {};
      const equipChoice = chosenDef.type === 'equip';
      if (dmgBonus) {
        if (equipChoice) {
          game.log(`【Excalibur(伪)】${card.fullname} 是装备牌、不造成伤害，`
            + `①的「伤害 +${dmgBonus}」没有实际效果`);
        } else {
          card.damageBonus = (card.damageBonus || 0) + dmgBonus;
          game.log(`【Excalibur(伪)】${card.fullname} 伤害 +${dmgBonus}`);
        }
      }
      if (noLimit) {
        card.noDistance = true;
        if (card.name === 'sha') player.addFlag('shaNoLimitThisTurn', true);
        game.log(`【Excalibur(伪)】${card.fullname} 无距离与次数限制`);
      }

      // ⑤ 选目标并使用
      const targets = await chooseCardTargets(game, player, card, 1 + tgtBonus, noLimit);
      if (!targets) {
        game.log(`【Excalibur(伪)】没有合法的目标，未使用【${card.fullname}】`);
        if (noLimit && card.name === 'sha') player.addFlag('shaNoLimitThisTurn', false);
        card.noDistance = false;
        delete card.damageBonus;
        return;
      }
      if (noRespond && targets.length) {
        card.noRespondTargets = targets.slice();
        game.log(`【Excalibur(伪)】${card.fullname} 的目标不可响应`);
      }
      await game.useCard(player, card, targets);
    },
  },

  /* ==================================================================
   * 二、百般骥足
   * ================================================================== */
  baibanjizu: {
    id: 'baibanjizu',
    name: '百般骥足',
    /*
     * 需求方原文：
     *   「有即时牌结算后，你可弃置一张牌，然后声明一种花色并进行一次判定，
     *     若二者相同，你可将那张弃置牌视为那张即时牌使用，
     *     否则至下个回合开始前此技能失效。」
     */
    desc: '有即时牌结算后，你可弃置一张牌，然后声明一种花色并进行一次判定；'
      + '若二者花色相同，你可将那张弃置的牌视为那张即时牌使用，'
      + '否则至你的下个回合开始前，此技能失效。',
    type: 'trigger',
    trigger: 'cardUsedAfter',
    scope: 'global',
    forced: false,
    filter(ctx) {
      const { player, event } = ctx;
      if (!player.alive) return false;
      if (player.flags && player.flags.baibanjizuOff) return false;
      const card = event && event.card;
      const def = card && CARDS[card.name];
      if (!def) return false;
      // 只对「即时牌」：装备、延时锦囊、响应牌（闪/无懈）都不算
      if (def.type === 'equip' || def.delayed || def.respondOnly) return false;
      return player.countCards('he') > 0;
    },

    async content(ctx) {
      const { player, game, event } = ctx;
      const resolved = event.card;
      const resolvedName = resolved.name;

      // ① 弃置一张牌
      const picked = await player.chooseCards({
        prompt: `【百般骥足】：弃置一张牌（结算的是【${resolved.fullname}】）`,
        position: 'he', min: 1, max: 1, cancelable: true,
      });
      if (!picked || !picked.length) return;
      const seed = picked[0];
      const seedName = seed.text;

      // ② 声明花色
      const declared = await player.chooseOption({
        prompt: '【百般骥足】：声明一种花色',
        options: SUIT_OPTIONS,
      });
      if (!declared) return;

      // ③ 判定
      const judge = await game.doJudge(player, '百般骥足');
      const same = judge && judge.suit === declared;
      game.log(`【百般骥足】${player.name} 声明${suitLabel(declared)}，判定为`
        + `${judge && judge.card ? `${suitLabel(judge.suit)}${judge.card.text}` : '无'}`
        + `，${same ? '花色相同' : '花色不同'}`);

      // 弃置这一步放在判定后，逻辑上「先弃置再判定」，但视觉上更清楚
      await player.discard([seed]);

      if (!same) {
        player.addFlag('baibanjizuOff', true);
        game.log(`【百般骥足】花色不同，此技能失效至 ${player.name} 的下个回合开始`);
        return;
      }

      // ④ 可将那张弃置牌视为那张即时牌使用
      const ghost = makeGhost(seed, resolvedName);
      const targets = await game.pickTargetsForVirtual(player, ghost);
      if (!targets || !targets.length) {
        if (game.defaultTargetsFor(player, ghost) === null) {
          game.log(`【百般骥足】没有合法的目标，未使用【${ghost.fullname}】`);
          return;
        }
      }
      game.log(`【百般骥足】${player.name} 将弃置的 ${seedName} 视为【${ghost.fullname}】使用`);
      await game.useCard(player, ghost, targets || []);
    },
  },
};
