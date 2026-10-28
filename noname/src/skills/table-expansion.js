/**
 * 本扩武将技
 * 本项目自研武将的技能
 * 由 tools/split_skills.cjs 从旧 skills.js 切出。
 */

import { CARDS } from '../cards.js';
import { SKILLS } from '../skills.js';
import { grantExtraSkillUse, markSkillUsed, skillUsedUp } from '../skills-util.js';
import { resolveQianxing, runZhouShiEffect } from './qianxing.js';
import { runYeyan } from './yeyan.js';
import {
  SHUANGXING_ITEMS, SHUANGXING_TEXT, shuangxingIndex, shuangxingCandidates,
  shuangxingPicks, chooseShuangxingName, setShuangxingIndex, advanceShuangxing,
} from './shuangxing.js';

/* 金银合纵的参数（对象字面量里就会求值，必须声明在 export 之前） */
/** 出牌阶段的使用次数上限 */
const JINYING_USABLE = 3;
/** 弃牌数 */
const JINYING_COST = 3;

export default {
  voidhp_armor: {
    id: 'voidhp_armor', name: '空上限',
    desc: '锁定技。你的空余体力上限视为护甲：受到伤害时，'
      + '先由「体力上限 - 当前体力」的部分承受，不足的部分才扣减体力。'
      + '以此法承受的伤害不改变体力上限与护甲值。',
    type: 'mod', locked: true,
    mod: {
      /** 供引擎 doDamage 识别（实际逻辑在引擎里，保证与护甲顺序一致） */
      voidHpAsArmor: () => true,
    },
  },
  hp_card_exchange: {
    id: 'hp_card_exchange', name: '等价',
    desc: '锁定技。你摸牌或弃牌时，可以改为不摸/不弃，'
      + '而增加/减少等量的体力；弃牌阶段可以一次性以扣减体力代替弃牌。'
      + '该结算仅视为摸牌/弃牌，不视为回复或失去体力。',
    type: 'mod', locked: true,
    mod: {
      hpCardExchange: () => true,
    },
  },
  wuworuchunshi: {
    id: 'wuworuchunshi', name: '无我入春时',
    // 正式描述采用需求方提供的「专业版」文案
    desc: '每回合限一次。有角色受到伤害时，若此伤害会令其体力值减少，'
      + '你可流失1点体力，防止此伤害。若你因此进入濒死，'
      + '则你回复体力至1，然后本回合未使用过牌但成为过牌目标的'
      + '其他角色与你各获得1点护甲。',
    type: 'trigger', trigger: 'damageBegin',
    // 归属：任意角色受伤都可能是发动契机，故不受归属闸门限制
    scope: 'any',
    filter: (ctx) => {
      const ev = ctx.event;
      if (!ev || ev.prevented) return false;
      if (ev.num <= 0) return false;
      // 每回合限一次
      if (ctx.player.flags.wuworuchunshiUsed === ctx.game.turnCount) return false;
      const target = ev.player;
      if (!target || !target.alive) return false;
      // 伤害必须会「确切减小体力」：最终伤害 > 当前护甲
      const armor = target.hujia || 0;
      return ev.num > armor;
    },
    async content(ctx) {
      const { player, game } = ctx;
      const ev = ctx.event;
      const victim = ev.player;

      // 标记本回合已用
      player.addFlag('wuworuchunshiUsed', game.turnCount);

      // ① 自己流失 1 点体力
      // ------------------------------------------------------------
      // 裁定（按需求方说明）：
      //   这次**确实是流失体力**（所以写进日志、也照常扣体力），
      //   但「因这次流失体力而进入的濒死结算**不触发**」——
      //   即跳过濒死/求桃流程，直接按技能描述恢复体力至 1。
      //
      // 因此这里不能用 player.loseHp(1)：
      //   loseHp 在 hp<=0 时会走完整的 enterDying（求桃、可能阵亡），
      //   与本技能的裁定不符。
      // 改为在引擎提供的 suppressDying 通道下扣血，
      // 由引擎保证「本次流失不触发濒死结算」。
      game.log(`${player.name} 发动【无我入春时】，流失 1 点体力`
        + `以防止 ${victim.name} 受到的 ${ev.num} 点伤害`);
      const wentDying = await game.loseHpWithoutDying(player, 1);

      // ② 防止该次伤害
      ev.prevented = true;
      game.log(`${victim.name} 受到的伤害被【无我入春时】防止`);

      if (!wentDying) return;

      // ③ 因本技能而「本应濒死」→ 直接恢复体力至 1
      //    （濒死结算已被跳过，所以这里只是把体力补回 1）
      player.hp = 1;
      game.log(`${player.name} 因【无我入春时】流失体力将进入濒死，`
        + `不触发濒死结算，直接回复体力至 1`);
      game.emit();

      // ④ 给护甲：本回合未使用过牌、但成为过牌目标的其他角色 + 自己
      //    （你自己**默认在名单里**，不需要满足该条件）
      const gains = [player];
      for (const p of game.players) {
        if (p === player || !p.alive) continue;
        const used = game.hasUsedCardThisTurn(p);
        const targeted = game.hasBeenTargetedThisTurn(p);
        if (!used && targeted) gains.push(p);
      }
      for (const p of gains) {
        await p.changeHujia(1);
      }
      game.log(`【无我入春时】${gains.map((p) => p.name).join('、')} 各获得 1 点护甲`);
      game.emit();
    },
  },
  xinghuojinranhan: {
    id: 'xinghuojinranhan', name: '星火尽染寒',
    // 正式描述采用需求方提供的「专业版」文案
    desc: '出牌阶段开始时，你可以摸X张牌（X为你已损失的体力值+2），'
      + '这些牌使用时无距离与次数限制。若你如此做，'
      + '本回合你使用的牌只能指定手牌数不小于你的角色、'
      + '或体力值不小于你的角色为目标。',
    type: 'trigger', trigger: 'phaseUseBegin',
    // 归属：只在**自己的**出牌阶段开始时触发，不包括别人的
    scope: 'player',
    async content(ctx) {
      const { player, game } = ctx;
      // X = 已损失体力 + 2
      const lost = Math.max(0, (player.maxHp || 0) - (player.hp || 0));
      const x = lost + 2;

      const cards = await player.draw(x);
      game.log(`${player.name} 发动【星火尽染寒】，已损体力 ${lost}`
        + `，摸 ${x} 张牌`);

      /*
       * 这批牌「无距离、无次数限制」+ 本回合所有牌的目标限制。
       * 用回合标记实现，弃牌阶段结束后随 flags 清空自然失效。
       */
      player.addFlag('xinghuoActive', game.turnCount);
      // 本回合【杀】无次数限制
      player.addFlag('shaNoLimitThisTurn', true);

      // 摸到的牌单独打标（供 UI 提示「这些牌无距离限制」）
      for (const c of cards || []) {
        c.gaintag = c.gaintag || [];
        if (!c.gaintag.includes('xinghuo')) c.gaintag.push('xinghuo');
      }
      game.emit();
    },
    mod: {
      /**
       * 目标限制：本回合你使用的牌只能指定
       * 「手牌数不小于你」或「体力值不小于你」的角色。
       *
       * 说明：
       *  - 只在发动过【星火尽染寒】的本回合生效；
       *  - 群体锦囊（南蛮/万箭）也走这个判断，
       *    因此自动变成「符合条件的全部其他角色」。
       */
      targetLimit: (card, source, target, info) => {
        const game = info && info.game;
        if (!game) return true;
        if (source.flags.xinghuoActive !== game.turnCount) return true;
        // 自己不受限制（描述只约束「角色」目标）
        if (target === source) return true;
        const handOk = target.countCards('h') >= source.countCards('h');
        const hpOk = (target.hp || 0) >= (source.hp || 0);
        return handOk || hpOk;
      },
      /** 无距离限制：本回合你使用的牌不受距离约束 */
      trickNoDistance: (player, game) => {
        if (!game) return false;
        return player.flags.xinghuoActive === game.turnCount;
      },
    },
  },
  jianjigaoshou: {
    id: 'jianjigaoshou', name: '剪辑高手',
    desc: '每种颜色每回合各限一次。回合结束时，你可以将一张手牌置入弃牌堆，'
      + '视为使用中央区的一张牌；若二者类型相同，你可以重复此流程；'
      + '若二者花色相同，你摸一张牌。',
    type: 'trigger', trigger: 'turnEnd',
    filter: (ctx) => {
      const { player, game } = ctx;
      // 本回合该颜色是否已用过
      const used = player.flags.jianjiUsed || {};
      const colorFree = ['red', 'black'].some((c) => !used[c]);
      if (!colorFree) return false;
      if (!player.countCards('h')) return false;
      // 中央区要有「当前可用」的牌
      return game.centerZone.some((c) => game.cardUsableNow(player, c));
    },
    async content(ctx) {
      const { player, game } = ctx;
      await game.doJianjiLoop(player);
    },
  },
  tongbusuodigongji: {
    id: 'tongbusuodigongji', name: '同步索敌攻击',
    desc: '你使用的牌结算后，若有其他角色的体力或手牌数减少，你摸一张牌。'
      + '以此法获得的牌不计入手牌上限，使用时不受距离限制；'
      + '若将之转化为其他牌使用，你摸一张牌。',
    type: 'trigger', trigger: 'cardUsedAfter',
    scope: 'any',
    filter: (ctx) => {
      const { player, game, event } = ctx;
      if (!event || event.player !== player) return false;
      const snap = event._snapBefore;
      if (!snap) return false;
      return game.anyOtherSuffered(player, snap);
    },
    async content(ctx) {
      const { player, game } = ctx;
      const cards = await player.draw(1);
      // 打标：不计入手牌上限 + 使用时不受距离限制
      for (const c of cards || []) {
        c.gaintag = c.gaintag || [];
        if (!c.gaintag.includes('suodi')) c.gaintag.push('suodi');
      }
      game.log(`${player.name} 发动【同步索敌攻击】，摸一张牌`
        + `（不计入手牌上限、使用无距离限制）`);
      game.emit();
    },
    mod: {
      /** 以【同步索敌攻击】获得的牌使用时不受距离限制 */
      trickNoDistance: (player, game) => {
        if (!game) return false;
        return (player.hand || []).some((c) => (c.gaintag || []).includes('suodi'));
      },
    },
  },
  qienuodeqinjian: {
    id: 'qienuodeqinjian', name: '怯懦的琴键',
    desc: '锁定技，韵律技，转换技。'
      + '平：你体力未满时；仄：其他角色不能使用或打出'
      + '与结算中出现过花色的牌。'
      + '你扣减体力后，①摸三张牌或翻面，②重新隐匿。'
      + '激昂：连招（周始+周始）。',
    type: 'mod', locked: true,
    // 韵律技：平 / 仄
    yunlv: {
      options: ['平', '仄'],
      // 转韵条件：你扣减体力后（受到伤害或流失体力）
      zhuanYun: (ctx) => {
        const ev = ctx.event;
        if (!ev || ev.player !== ctx.player) return false;
        return ev.type === 'damage' || ev.type === 'loseHp';
      },
    },
    // 转换技：① / ②
    zhuanhuanji: {
      options: ['①', '②'],
    },
    // 周始效果（跑完所有选项后触发；「连招（周始+周始）」= 触发两次）
    async zhouShi(ctx) {
      const { player, game } = ctx;
      game.log(`【周始】${player.name} 的【怯懦的琴键】触发周始`
        + `（连招：周始 + 周始，共两次）`);
      // 连招（周始 + 周始）→ 连续触发两次
      await runZhouShiEffect(player, game);
      await runZhouShiEffect(player, game);
    },
    mod: {
      /**
       * 仄：其他角色不能使用或打出「与结算中出现过花色」的牌
       * 只在韵律技处于「仄」时生效。
       *
       * 「结算中出现过花色」取两个来源的并集：
       *   ① 本回合已结算过的牌的花色（game._resolvedSuits）
       *   ② 当前「同一结算」块内出现过的花色（game._blockSuits）
       *      —— 需求方明确要求：块内**累积**封锁，
       *         所以前面几张出现过的花色，后面也不能用。
       */
      cardEnabled(card, player, game) {
        if (!game) return undefined;
        // 找到拥有本技能的角色
        for (const p of game.players) {
          if (!p.hasSkill('qienuodeqinjian')) continue;
          if (p === player) continue;                 // 只约束「其他角色」
          // 必须处于「仄」
          const cur = SKILLS.qienuodeqinjian.yunlv.options[
            (p.storage && p.storage.yunlv_qienuodeqinjian) | 0];
          if (cur !== '仄') continue;

          const suits = new Set(game._resolvedSuits || []);
          for (const s of (game._blockSuits || [])) suits.add(s);
          if (card && suits.has(card.suit)) return false;
        }
        return undefined;
      },
    },
  },
  qianxingdejuexin: {
    id: 'qianxingdejuexin', name: '前行的决心',
    desc: '昂扬技，隐匿技。你登场时，于同一结算内使用'
      + '[0,你手牌数]张牌堆顶的牌。'
      + '若你：反面向上，下次发动技能你可背水；'
      + '已受伤，每个花色首次使用后你从牌堆底摸一张牌。'
      + '乘势：转韵。',
    type: 'trigger', trigger: 'hiddenReveal',
    /*
     * 「隐匿技」标记
     * ------------------------------------------------------------------
     * 需求方给定：**游戏开始时，有隐匿技的角色隐匿**。
     * 引擎在 Player 构造时读这个标记决定是否 enterHidden。
     */
    hiddenSkill: true,
    // 昂扬技：满足「激昂」条件后可重置
    angyang: {
      filter: (ctx) => {
        const ev = ctx.event;
        return !!ev && ev.type === 'damage' && ev.player === ctx.player;
      },
      text: '激昂：技能已重置',
    },
    filter: (ctx) => !!ctx.event && ctx.event.player === ctx.player,
    async content(ctx) {
      const { player, game } = ctx;
      await resolveQianxing(player, game);
    },
    // 乘势：转韵（满足转韵条件时切换选项）
    chengshi: {
      zhuanYun: true,
    },
  },

  /* ==================================================================
   * 璐米欧儿（暗影诗篇 · 势力「影」）
   * ------------------------------------------------------------------
   * 需求方给定文案：
   *   金银合纵  出牌阶段限 3 次，你可以弃置 3 张牌并摸其中花色数张牌；
   *             有◆牌进入弃牌堆的回合结束时，你可获得其中 1 张◆牌并使用此技能。
   *   黑白乱舞  你有 2 张牌被同时弃置时，可用其中的牌发动一次『界乱击』。
   *
   * 与需求方逐条确认过的判定（都是「按字面」的裁定，勿自行改写）：
   *   ① 「◆牌」= 方块牌（◆ 只是字体把 ♦ 显示成了 ◆）。
   *   ② 「摸其中花色数张牌」= 那 3 张牌里不同花色的种数。
   *   ③ 回合结束那一条只看有没有方块牌进过弃牌堆（不看几张）；
   *      获得其中 1 张后，可选择再执行一次「弃 3 摸花色数」。
   *   ④ 「你有 2 张牌被同时弃置」限你自己的牌，且以同一次
   *      Player.discard 调用为准。
   *   ⑤ 『界乱击』不限发动次数，但受其自身「每种花色每回合限一次」约束。
   * ================================================================== */
  jinyinghezong: {
    id: 'jinyinghezong', name: '金银合纵',
    desc: `出牌阶段限${JINYING_USABLE}次，你可以弃置${JINYING_COST}张牌`
      + '并摸其中花色数张牌；'
      + '有◆牌进入弃牌堆的回合结束时，你可获得其中1张◆牌并使用此技能。',
    type: 'active', trigger: 'phaseUse', usable: JINYING_USABLE,
    filter: (ctx) => ctx.player.countCards('he') >= JINYING_COST,
    async content(ctx) {
      return runJinyinghezong(ctx.player, ctx.game);
    },
  },

  /**
   * 金银合纵 · 回合结束的额外发动
   * ------------------------------------------------------------------
   * 本引擎无 subSkill，派生效果一律登记为顶层技能；
   * 但加 sub: true 让它不出独立按钮（与无名杀 get.is.disable 一致）。
   * 这是额外的发动机会，不占出牌阶段的 3 次额度。
   */
  jinyinghezong_end: {
    id: 'jinyinghezong_end', name: '金银合纵', sub: true,
    desc: '有◆牌进入弃牌堆的回合结束时，你可获得其中1张◆牌并使用此技能。',
    type: 'trigger', trigger: 'turnEnd',
    filter: (ctx) => {
      const { player, game, event } = ctx;
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

  heibailuanwu: {
    id: 'heibailuanwu', name: '黑白乱舞',
    desc: '你有2张牌被同时弃置时，可用其中的牌发动一次『界乱击』。',
    /*
     * 「同时弃置」不是回合事件，时机体系里没有对应时点，
     * 故由引擎在 Player.discard 里主动通知（game.notifyDiscardBatch）。
     */
    type: 'trigger', trigger: 'cardsDiscarded',
    async content(ctx) {
      const batch = (ctx.event && ctx.event.batch) || [];
      return runHeibailuanwu(ctx.player, ctx.game, batch);
    },
  },

  /**
   * 『界乱击』（派生技，sub）
   * ------------------------------------------------------------------
   * 需求方给定：出牌阶段可将两张手牌当【万箭齐发】使用（每种花色每回合
   * 限一次）；其他角色打出【闪】响应后摸一张牌；此牌未造成伤害则
   * 结算后你摸等同于目标数的牌。
   *
   * 不由玩家主动点按钮发动 —— 发动机会由【黑白乱舞】提供。
   * 本条目只承接「使用结算结束后」那一条；花色限制与选牌逻辑在
   * runHeibailuanwu / markLuanjiSuits 里。
   */
  luanji_jie: {
    id: 'luanji_jie', name: '界乱击', sub: true,
    desc: '出牌阶段，你可以将两张手牌当【万箭齐发】使用（每种花色每回合限一次）；'
      + '当其他角色打出【闪】响应你使用的【万箭齐发】结算结束后，其摸一张牌；'
      + '当你使用【万箭齐发】结算结束后，若此牌没有造成过伤害，'
      + '你摸等同于此牌目标数的牌。',
    type: 'trigger', trigger: 'luanjiAfter', forced: true,
    async content(ctx) {
      return resolveLuanjiAfter(ctx.player, ctx.game, ctx.event);
    },
  },

  /* ============================ 丰川祥子 ============================ */

  /**
   * 双星伴生之人（转换技）
   * ----------------------------------------------------------------
   * 出牌阶段，你用**一张实体牌**时，可以把这张牌「视为」另一个牌名使用：
   *   ① 弃牌堆里存在的同类牌
   *   ② 场上可见牌里没有的同类牌
   *   ③ 本回合没人使用过的牌名
   * 用完后当前项推进到下一位（转换技的常规流转，由周始记账）。
   *
   * 周始：摸牌至两倍体力上限（至多摸五张），
   * 然后**下次**发动本技能时转化的牌须非法 —— 必须转化出一张此刻
   * 用不出来的牌（如【闪】，或已经用满次的【杀】）。那次使用不产生
   * 任何效果，牌照常进弃牌堆。
   */
  shuangxingbansheng: {
    id: 'shuangxingbansheng', name: '双星伴生之人',
    desc: '转换技，出牌阶段，你可以选择一张手牌，将其视为'
      + '①存在于弃牌堆的同类牌；②不存于场上可见牌的同类牌；'
      + '③本回合未使用过的牌名（用任意手牌印一张即时牌） 使用。'
      + '周始：你摸牌至两倍体力上限（至多摸五张），'
      + '然后下次发动此技能时转化的牌须非法。',
    type: 'active', trigger: 'phaseUse',
    zhuanhuanji: { options: SHUANGXING_ITEMS },
    filter(ctx) {
      const { player, game } = ctx;
      if (!game.isInPlayPhase(player)) return false;
      const idx = shuangxingIndex(player);
      return (player.hand || []).some(
        (c) => shuangxingPicks(game, player, c, idx).length > 0,
      );
    },
    async content(ctx) {
      const { player, game } = ctx;
      const idx = shuangxingIndex(player);

      // ① 选一张要被转化的手牌
      const cards = await game.io.chooseCards(player, {
        prompt: `【双星伴生之人】当前项${SHUANGXING_ITEMS[idx]}`
          + `（${SHUANGXING_TEXT[idx]}）：选择一张手牌转化`,
        position: 'h', min: 1, max: 1, cancelable: true,
        filter: (c) => shuangxingPicks(game, player, c, idx).length > 0,
      });
      if (!cards || !cards.length) return false;
      const source = cards[0];

      // ② 选「视为」哪张牌
      const name = await chooseShuangxingName(ctx, source, idx);
      if (!name) return false;

      // ③ 使用，然后当前项推进到下一位
      await useConvertedCard(game, player, source, name, '双星伴生之人');
      await advanceShuangxing(game, player, idx);
      return true;
    },
    async zhouShi(ctx) {
      const { player, game } = ctx;
      const target = 2 * (player.maxHp || 0);
      const cur = player.countCards('h');
      const n = Math.min(Math.max(0, target - cur), 5);
      game.log(`【周始】${player.name} 摸牌至两倍体力上限 ${target} 张`
        + `（当前 ${cur} 张，至多摸 5 张）`);
      if (n > 0) await player.draw(n);
      if (!player.storage) player.storage = {};
      player.storage.shuangxingIllegalNext = true;
      game.log(`【周始】${player.name} 下次发动【双星伴生之人】时`
        + `转化的牌须非法`);
      game.emit();
    },
  },

  /**
   * 爱恶生死之惑（回合技 = 每回合限一次的主动技）
   * ----------------------------------------------------------------
   * 你把一张手牌按【双星伴生之人】的某一项转化后使用，
   * 然后把【双星伴生之人】的当前项**调整到刚执行的那一项**：
   *   · 按顺序调整（①→②→③→①）→ 本回合此技能可用次数 +1；
   *   · 不是按顺序 → 你失去 1 点体力。
   */
  aieshengsizhihuo: {
    id: 'aieshengsizhihuo', name: '爱恶生死之惑',
    desc: '回合技，你可以执行【双星伴生之人】的对应项'
      + '（将一张手牌转化为对应的牌使用），然后将当前项向之调整；'
      + '若按顺序调整，本回合此技能可用次数 +1，否则你失去 1 点体力。',
    type: 'active', trigger: 'phaseUse', usable: 1,
    filter(ctx) {
      const { player, game } = ctx;
      const hand = player.hand || [];
      if (!hand.length) return false;
      // 至少要有一张手牌、至少一项能转化出牌来
      return hand.some((c) => SHUANGXING_ITEMS.some(
        (_, i) => shuangxingCandidates(game, player, c, i).length > 0));
    },
    async content(ctx) {
      const { player, game } = ctx;
      const cur = shuangxingIndex(player);

      // ① 执行哪一项
      const idx = await chooseExecuteItem(game, player, cur);
      if (idx === null) return false;

      // ② 拿哪张手牌去转化
      const cards = await game.io.chooseCards(player, {
        prompt: `【爱恶生死之惑】：选择一张手牌，转化为`
          + `「${SHUANGXING_TEXT[idx]}」的牌使用`,
        position: 'h', min: 1, max: 1, cancelable: true,
        filter: (c) => shuangxingPicks(game, player, c, idx).length > 0,
      });
      if (!cards || !cards.length) {
        /*
         * 没有符合条件的牌时必须**说明为什么没反应**，
         * 否则玩家看到的就是「点了技能、选了项，然后就没了」。
         */
        game.log(`【爱恶生死之惑】${player.name} 没有可转化为`
          + `「${SHUANGXING_TEXT[idx]}」的手牌，技能结束`);
        return false;
      }
      const source = cards[0];

      // ③ 转化成哪张牌
      const name = await chooseShuangxingName(ctx, source, idx);
      if (!name) return false;

      // ④ 使用，然后调整当前项
      await useConvertedCard(game, player, source, name);
      await adjustShuangxingItem(game, player, cur, idx);
      return true;
    },
  },

  /* ===== 赤刃明霄陈（再探泰拉） ===== */

  /**
   * 破惘长行
   * ------------------------------------------------------------------
   * 有角色的体力/手牌要一次性变动大于 1 时，你可以蓄谋 1 张手牌 /
   * 使用 1 张蓄谋牌，令那个结算中大于 1 的每个变动分别变为 ±1。
   *
   * 本技能**没有触发时机**：真正的拦截在引擎的动作原语里
   * （player.draw / discard / recover / loseHp / game.doDamage，
   *  见 src/mechanics/change.js 的 adjustBigChange），
   * 这里只作为「谁拥有这个机制」的声明。
   */
  powangchangxing: {
    id: 'powangchangxing', name: '破惘长行',
    desc: '有角色的体力或手牌要一次性变动大于 1 时，'
      + '你可以蓄谋 1 张手牌（体力变动）或使用 1 张蓄谋牌（手牌变动），'
      + '令该次结算中大于 1 的每个变动分别变为 +1 或 -1。',
    type: 'mod', locked: true,
    mod: { bigChangeIntercept: () => true },
  },

  /**
   * 修己
   * ------------------------------------------------------------------
   * 回合技：有伤害造成的结算中，你可将伤害结算改为对结算中所有参与者
   * 发动一次以 4 次判定部分代替弃牌的『业炎』；
   * 选择原伤害造成者/受到者为目标则惩罚阈值 ±1。
   *
   * 时机：damageBegin（伤害结算最前面），把整次结算替换掉。
   */
  xiuji: {
    id: 'xiuji', name: '修己',
    desc: '回合技。有伤害造成的结算中，你可以将此伤害结算改为'
      + '对结算中所有参与者发动一次『业炎』（以 4 次判定部分代替弃牌）：'
      + '选择至多三名参与者，造成共计至多 3 点火焰伤害。'
      + '给原伤害的造成者分配 3 点、或给受到者分配 1 点以上时，'
      + '须先以判定与弃牌凑齐 4 种花色。',
    type: 'trigger', trigger: 'damageBegin', usable: 1,
    /*
     * 归属：chen 本人不必是伤害的参与者 ——
     * 「有伤害造成的结算中」是全场监听，故显式声明 global。
     */
    scope: 'global',
    filter: (ctx) => {
      const { player, game, skill } = ctx;
      if (!player.alive || game.over) return false;
      if (skillUsedUp(player, skill, game)) return false;
      return true;
    },
    content: async (ctx) => {
      const { player, game, event, skill } = ctx;
      markSkillUsed(player, skill, game);

      // 本次伤害结算的全部参与者
      const batch = game._dmgBatch;
      const participants = [];
      for (const p of [event.source, event.player, ...(batch ? batch.targets : [])]) {
        if (p && !participants.includes(p)) participants.push(p);
      }

      // 原伤害被替换（不结算），业炎结算完再封锁本批后续目标的伤害
      event.prevented = true;

      game.log(`【修己】${player.name} 将这次伤害结算改为一次『业炎』`
        + `（参与者：${participants.map((p) => p.name).join('、')}）`);
      await runYeyan(game, player, participants, {
        dealer: event.source, victim: event.player,
      });
      if (batch) batch.cancelled = true;
    },
  },
};

/* ==================================================================
 * 璐米欧儿：技能实现
 * ================================================================== */

const SUIT_LABEL = { spade: '♠', heart: '♥', club: '♣', diamond: '♦' };

/** 花色符号，用于日志 */
function suitText(suit) {
  return SUIT_LABEL[suit] || suit || '?';
}

/**
 * 金银合纵的一次结算：弃 3 张，摸「其中花色数」张
 * ------------------------------------------------------------------
 * 「其中花色数」= 弃置的这 3 张牌里不同花色的种数。
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

/** 从弃牌堆里的方块牌中选 1 张（AI 取第一张；返回 null 表示不拿） */
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

/**
 * 黑白乱舞：用被同时弃置的牌发动一次界乱击
 * ------------------------------------------------------------------
 * 这些牌已经进弃牌堆，这里把它们当作「视为使用【万箭齐发】」所用的牌。
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

  markLuanjiSuits(player, game, pick);
  game.log(`【界乱击】${player.name} 将 ${pick.map((c) => c.text).join('、')}`
    + '当【万箭齐发】使用（本回合已用花色：'
    + `${usedLuanjiSuits(player, game).map(suitText).join('、')}）`);

  const ghost = game.makeVirtualCard({ name: 'wanjian' });
  ghost.sourceCards = pick;
  ghost.luanjiFrom = true;
  /*
   * 【万箭齐发】是群体锦囊：使用时**不需要**玩家指定目标，
   * 结算时自动命中所有其他角色。这里必须走 defaultTargetsFor，
   * 否则会出现「发动技能却让你选目标」的多余询问。
   */
  const targets = game.defaultTargetsFor(player, ghost) || [];
  await game.useCard(player, ghost, targets);
  return true;
}

/**
 * 【界乱击】的收尾效果
 * ------------------------------------------------------------------
 * 由 useCard 在【万箭齐发】结算完毕后带着 event 触发（timing='luanjiAfter'）：
 * 此牌未造成过伤害 → 摸「目标数」张。
 * 「打出【闪】的响应者摸一张」在 askShan 里即时处理（见引擎）。
 */
async function resolveLuanjiAfter(player, game, event) {
  const card = event && event.card;
  if (!card || !card.luanjiFrom) return false;

  const targets = (event && event.targets) || [];
  /*
   * 伤害次数优先取 event 上的（引擎在 emitCardUsedAfter 里显式传入），
   * 取不到时回退到 card 自身的记账。
   */
  const damaged = (event && event.luanjiDamaged) || card.luanjiDamaged || 0;

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

/** 是 / 否 询问（AI 默认「是」） */
async function askYesNo(game, player, prompt) {
  if (!player.isHuman) return true;
  const r = await game.io.chooseOption(player, prompt,
    [{ key: 'yes', label: '发动' }, { key: 'no', label: '不发动' }])
    .catch(() => 'no');
  return r === 'yes';
}

/* ==================================================================
 * 丰川祥子：技能实现
 * ================================================================== */

/** 选要执行【双星伴生之人】的哪一项（AI 固定选下一项，即按顺序走） */
async function chooseExecuteItem(game, player, cur) {
  if (!player.isHuman) return (cur + 1) % SHUANGXING_ITEMS.length;
  const options = SHUANGXING_ITEMS.map((label, i) => ({
    key: String(i),
    label: `${label} ${SHUANGXING_TEXT[i]}`,
  }));
  options.push({ key: '-1', label: '取消' });
  const picked = await game.io.chooseOption(player,
    '【爱恶生死之惑】：执行【双星伴生之人】的哪一项？'
    + `\n当前项为 ${SHUANGXING_ITEMS[cur]}`, options).catch(() => null);
  const idx = Number(picked);
  return Number.isInteger(idx) && idx >= 0 && idx < SHUANGXING_ITEMS.length
    ? idx : null;
}

/**
 * 把一张手牌「视为」另一张牌使用
 * ------------------------------------------------------------------
 * 走引擎的 useCard，因此距离、次数、目标合法性、无懈可击等全部照常。
 */
async function useConvertedCard(game, player, source, name, tag = '双星伴生之人') {
  const def = CARDS[name] || {};
  const ghost = game.makeVirtualCard({
    name, suit: source.suit, number: source.number, color: source.color,
  });
  ghost.sourceCards = [source];
  ghost.fromAiesheng = true;
  /*
   * 转化出来的牌若此刻根本用不出来（周始的「须非法」），
   * 直接交给引擎处理（它会弃掉载体并记一条日志），
   * 绝不能去问玩家「选谁为目标」—— 那样会卡在一个假的目标选择上。
   */
  const usable = game.cardUsableNow(player, ghost);
  const targets = usable
    ? (game.defaultTargetsFor(player, ghost)
      ?? await game.pickTargetsForVirtual(player, ghost).catch(() => []))
    : [];
  game.log(`【${tag}】${player.name} 将 ${source.text} `
    + `视为【${def.fullname || name}】使用`);
  await game.useCard(player, ghost, targets);
  // 周始的「下次转化须非法」只用一次
  if (player.storage) player.storage.shuangxingIllegalNext = false;
  return usable;
}

/**
 * 把【双星伴生之人】的当前项向刚执行的那一项调整
 * ------------------------------------------------------------------
 * 按顺序（①→②→③→①）调整 → 本回合此技能可用次数 +1；
 * 否则 → 失去 1 点体力。
 */
async function adjustShuangxingItem(game, player, from, to) {
  const inOrder = to === (from + 1) % SHUANGXING_ITEMS.length;
  await setShuangxingIndex(game, player, to);
  game.log(`【爱恶生死之惑】当前项 ${SHUANGXING_ITEMS[from]}`
    + ` → ${SHUANGXING_ITEMS[to]}`);
  if (inOrder) {
    grantExtraSkillUse(player, SKILLS.aieshengsizhihuo, game);
    game.log('【爱恶生死之惑】按顺序调整，本回合此技能可用次数 +1');
  } else {
    game.log(`【爱恶生死之惑】未按顺序调整，${player.name} 失去 1 点体力`);
    await player.loseHp(1);
  }
}
