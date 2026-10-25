/**
 * 本扩武将技
 * 本项目自研武将的技能
 * 由 tools/split_skills.cjs 从旧 skills.js 切出。
 */

import { SKILLS } from '../skills.js';
import { resolveQianxing, runZhouShiEffect } from './qianxing.js';

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
  }
};
