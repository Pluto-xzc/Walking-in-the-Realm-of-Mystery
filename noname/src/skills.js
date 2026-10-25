/**
 * 技能实现（标准包）
 * ------------------------------------------------------------------
 * 技能对象字段：
 *   id        技能标识
 *   name      显示名
 *   desc      技能描述
 *   type      trigger 触发技 / active 主动技 / viewAs 视为技 / mod 规则修改
 *   lord      true 表示主公技
 *   locked    true 表示锁定技
 *   trigger   触发时机名（trigger 技用）
 *   filter    是否满足发动条件
 *   content   技能效果，async (ctx) => {}
 *   mod       规则修改回调（mod 技用）
 *
 * 所有效果通过 ctx（TrickContext，见 engine.js）提供的原子操作实现，
 * 保证引擎与技能解耦。
 */

import { CARDS } from './cards.js';

export const SKILLS = {
  /* ======================= 魏 ======================= */

  /** 曹操·奸雄：受到伤害后，获得造成伤害的牌 */
  jianxiong: {
    id: 'jianxiong', name: '奸雄',
    desc: '当你受到伤害后，你可以获得对你造成伤害的牌。',
    type: 'trigger', trigger: 'damageEnd',
    // 只要事件里带着「造成伤害的那张牌」就应可发动。
    // 历史坑：这里曾写 c.zone === 'processing'，而引擎的处理区已改名为
    // 'center'，导致该技能永不触发。现已改为只看牌是否存在，
    // 并在 content 里过滤掉已被移出牌局的牌。
    filter: (ctx) => {
      const ev = ctx.event;
      if (!ev || ev.num <= 0) return false;
      const cs = (ev.cards && ev.cards.length) ? ev.cards : (ev.card ? [ev.card] : []);
      return cs.length > 0;
    },
    async content(ctx) {
      const ev = ctx.event;
      const cs = (ev.cards && ev.cards.length) ? ev.cards : (ev.card ? [ev.card] : []);
      // 只取当前确实还在场上、可以被获得的牌
      const obtainable = cs.filter((c) => c && [
        'hand', 'equip', 'judge', 'center', 'discard',
      ].includes(c.zone));
      if (obtainable.length) {
        await ctx.player.gain(obtainable, 'gain2');
      }
    },
  },

  /** 曹操·护驾（主公技）：需使用/打出闪时，可令其他魏势力角色代为打出 */
  hujia: {
    id: 'hujia', name: '护驾',
    desc: '主公技。当你需要使用或打出【闪】时，你可以令其他魏势力角色选择是否打出一张【闪】视为你使用或打出。',
    type: 'trigger', trigger: 'askForShan', lord: true,
    filter: (ctx) => ctx.game.players.some(
      (p) => p !== ctx.player && p.group === 'wei' && p.alive && p.countCards('h') > 0
        && p.canUseAsShan(),
    ),
    async content(ctx) {
      const helpers = ctx.game.players.filter(
        (p) => p !== ctx.player && p.group === 'wei' && p.alive && p.countCards('h') > 0,
      );
      for (const h of helpers) {
        const res = await h.chooseToRespond({
          prompt: `${ctx.player.name}发动【护驾】，是否打出一张【闪】？`,
          pattern: { name: 'shan' },
        });
        if (res && res.cards && res.cards.length) {
          ctx.event.hujiaCard = res.cards[0];
          ctx.event.hujiaFrom = h;
          return true;
        }
      }
      return false;
    },
  },

  /** 司马懿·反馈：受到伤害后，可获得伤害来源一张牌 */
  fankui: {
    id: 'fankui', name: '反馈',
    desc: '当你受到伤害后，你可以获得伤害来源的一张牌。',
    type: 'trigger', trigger: 'damageEnd',
    filter: (ctx) => ctx.event.source && ctx.event.source !== ctx.player
      && ctx.event.source.alive && ctx.event.source.countCards('he') > 0,
    async content(ctx) {
      const source = ctx.event.source;
      const cards = await ctx.player.chooseCardFromPlayer(source, 'he', '反馈：选择获得一张牌');
      if (cards && cards.length) await ctx.player.gain(cards, 'gain2');
    },
  },

  /** 司马懿·鬼才：判定牌生效前，可打出一张手牌代替之 */
  guicai: {
    id: 'guicai', name: '鬼才',
    desc: '当一名角色的判定牌生效前，你可以打出一张手牌代替之。',
    type: 'trigger', trigger: 'judgeBefore',
    filter: (ctx) => ctx.player.countCards('h') > 0,
    async content(ctx) {
      const res = await ctx.player.chooseToDiscard({
        prompt: '鬼才：打出一张手牌代替判定牌',
        position: 'h',
      });
      if (res && res.cards && res.cards.length) {
        ctx.event.card = res.cards[0];
        ctx.event.replaced = true;
      }
    },
  },

  /** 夏侯惇·刚烈：受到伤害后，可判定，非红桃则伤害来源受1点伤害或弃两张牌 */
  ganglie: {
    id: 'ganglie', name: '刚烈',
    desc: '当你受到伤害后，你可以进行判定：若结果不为红桃，则伤害来源选择弃置两张手牌或受到你造成的 1 点伤害。',
    type: 'trigger', trigger: 'damageEnd',
    filter: (ctx) => ctx.event.source && ctx.event.source !== ctx.player && ctx.event.source.alive,
    async content(ctx) {
      const source = ctx.event.source;
      const judge = await ctx.player.judge('ganglie');
      if (judge.suit === 'heart') return;
      const canDiscard = source.countCards('h') >= 2;
      let choice = 'damage';
      if (canDiscard) {
        choice = await source.chooseOption({
          prompt: '刚烈：弃置两张手牌，或受到 1 点伤害',
          options: [
            { key: 'discard', label: '弃置两张手牌' },
            { key: 'damage', label: '受到 1 点伤害' },
          ],
        });
      }
      if (choice === 'discard') {
        await source.discardCards(2, 'h', '刚烈：弃置两张手牌');
      } else {
        await source.damage(1, ctx.player, 'ganglie');
      }
    },
  },

  /** 张辽·突袭：摸牌阶段可改为获得至多两名其他角色各一张手牌 */
  tuxi: {
    id: 'tuxi', name: '突袭',
    desc: '摸牌阶段，你可以放弃摸牌，改为获得至多两名其他角色的各一张手牌。',
    type: 'trigger', trigger: 'drawPhaseBefore', locked: false,
    filter: (ctx) => ctx.game.players.filter((p) => p !== ctx.player && p.alive && p.countCards('h') > 0).length > 0,
    async content(ctx) {
      const targets = ctx.game.players.filter(
        (p) => p !== ctx.player && p.alive && p.countCards('h') > 0,
      );
      const picked = await ctx.player.chooseTargets({
        prompt: `突袭：选择至多 ${Math.min(2, targets.length)} 名角色`,
        candidates: targets,
        min: 1,
        max: Math.min(2, targets.length),
      });
      if (!picked || !picked.length) return false;

      /*
       * 选牌方式：由**使用者自己**从目标的暗置手牌中点选一张。
       * ------------------------------------------------------------------
       * 参考无名杀：
       *   player.gainMultiple(targets)
       *     → player.gainPlayerCard(target, 'h', true)
       *       → 手牌以 blank（背面按钮）形式列出，玩家点选
       *
       * 注意：是**玩家选**，不是随机取。
       * 只是看到的牌是背面（信息隔离），玩家凭判断挑位置。
       * 历史 bug：早期用 randomPick 随机拿一张，玩家无法选择。
       */
      for (const t of picked) {
        if (!t.countCards('h')) continue;
        const got = await ctx.player.chooseCardFromPlayer(
          t, 'h', `突袭：选择获得 ${t.name} 的一张手牌`,
        );
        if (got && got.length) {
          await t.loseCards(got);
          await ctx.player.gain(got, 'gain2');
          ctx.game.log(`${ctx.player.name} 发动【突袭】，获得 ${t.name} 的一张手牌`);
        }
      }
      ctx.event.skipDraw = true;
      return true;
    },
  },

  /** 许褚·裸衣：摸牌阶段可少摸一张，本回合【杀】和【决斗】伤害+1 */
  luoyi: {
    id: 'luoyi', name: '裸衣',
    desc: '摸牌阶段，你可以少摸一张牌。若如此做，你本回合使用【杀】或【决斗】造成的伤害 +1。',
    type: 'trigger', trigger: 'drawPhaseBefore',
    async content(ctx) {
      ctx.event.drawDelta = -1;
      ctx.player.addFlag('luoyi', ctx.game.turnCount);
      return true;
    },
  },

  /** 郭嘉·天妒：判定牌生效后，可获得之（仅自己的判定） */
  tiandu: {
    id: 'tiandu', name: '天妒',
    desc: '当你的判定牌生效后，你可以获得此牌。',
    type: 'trigger', trigger: 'judgeEnd',
    // 注意：必须限定判定者是技能拥有者本人，
    // 否则会在他人判定时也触发（曾导致郭嘉刷牌 bug）
    filter: (ctx) => ctx.event.card && ctx.event.player === ctx.player,
    async content(ctx) {
      if (ctx.event.card) await ctx.player.gain([ctx.event.card], 'gain2');
    },
  },

  /** 郭嘉·遗计：受到1点伤害后，可摸两张牌并分配给任意角色 */
  yiji: {
    id: 'yiji', name: '遗计',
    desc: '当你受到 1 点伤害后，你可以摸两张牌，然后将这些牌交给任意角色。',
    type: 'trigger', trigger: 'damageEnd',
    filter: (ctx) => ctx.event.num > 0,
    async content(ctx) {
      const times = ctx.event.num;
      for (let i = 0; i < times; i++) {
        const drawn = await ctx.player.draw(2);
        const others = ctx.game.players.filter((p) => p.alive);
        for (const card of drawn) {
          const t = await ctx.player.chooseTargets({
            prompt: '遗计：将一张牌交给一名角色',
            candidates: others,
            min: 1, max: 1,
          });
          if (t && t.length) await t[0].gain([card], 'gain2');
        }
      }
    },
  },

  /** 甄姬·倾国：可将黑色手牌当【闪】使用或打出 */
  qingguo: {
    id: 'qingguo', name: '倾国',
    desc: '你可以将一张黑色手牌当【闪】使用或打出。',
    type: 'viewAs',
    viewAs: { name: 'shan' },
    filterCard: (card) => card.color === 'black',
    position: 'h',
  },

  /** 甄姬·洛神：回合开始阶段，可判定，黑色则获得并重复 */
  luoshen: {
    id: 'luoshen', name: '洛神',
    desc: '回合开始阶段开始时，你可以进行判定：若结果为黑色，你获得此牌并可以重复此流程。',
    type: 'trigger', trigger: 'turnStart',
    async content(ctx) {
      const gained = [];
      let guard = 0;
      while (guard++ < 20) {
        const judge = await ctx.player.judge('luoshen');
        if (judge.color === 'black') {
          gained.push(judge.card);
          ctx.player.gain([judge.card], 'gain2');
        } else {
          break;
        }
      }
    },
  },

  /* ======================= 蜀 ======================= */

  /** 刘备·仁德：出牌阶段，可将任意张手牌交给其他角色，给出两张后回复1点 */
  rende: {
    id: 'rende', name: '仁德',
    desc: '出牌阶段，你可以将任意张手牌交给其他角色。每回合给出两张牌后，你回复 1 点体力。',
    type: 'active', trigger: 'phaseUse',
    filter: (ctx) => ctx.player.countCards('h') > 0 && ctx.game.players.some((p) => p !== ctx.player && p.alive),
    async content(ctx) {
      const cards = await ctx.player.chooseCards({
        prompt: '仁德：选择要交给他人的手牌',
        position: 'h',
        min: 1, max: ctx.player.countCards('h'),
      });
      if (!cards || !cards.length) return false;
      const targets = await ctx.player.chooseTargets({
        prompt: '仁德：选择一名角色',
        candidates: ctx.game.players.filter((p) => p !== ctx.player && p.alive),
        min: 1, max: 1,
      });
      if (!targets || !targets.length) return false;
      await targets[0].gain(cards, 'gain2', ctx.player);
      ctx.player.storage.rendeCount = (ctx.player.storage.rendeCount || 0) + cards.length;
      if (ctx.player.storage.rendeCount >= 2 && ctx.player.hp < ctx.player.maxHp) {
        ctx.player.storage.rendeCount = 0;
        await ctx.player.recover(1);
      }
      return true;
    },
  },

  /** 刘备·激将（主公技）：需使用/打出杀时，可令其他蜀势力角色代为打出 */
  jijiang: {
    id: 'jijiang', name: '激将',
    desc: '主公技。当你需要使用或打出【杀】时，你可以令其他蜀势力角色选择是否打出一张【杀】视为你使用或打出。',
    type: 'trigger', trigger: 'askForSha', lord: true,
    filter: (ctx) => ctx.game.players.some(
      (p) => p !== ctx.player && p.group === 'shu' && p.alive && p.countCards('h') > 0,
    ),
    async content(ctx) {
      const helpers = ctx.game.players.filter(
        (p) => p !== ctx.player && p.group === 'shu' && p.alive && p.countCards('h') > 0,
      );
      for (const h of helpers) {
        const res = await h.chooseToRespond({
          prompt: `${ctx.player.name}发动【激将】，是否打出一张【杀】？`,
          pattern: { name: 'sha' },
        });
        if (res && res.cards && res.cards.length) {
          ctx.event.jijiangCard = res.cards[0];
          ctx.event.jijiangFrom = h;
          return true;
        }
      }
      return false;
    },
  },

  /** 关羽·武圣：可将红色牌当【杀】使用或打出 */
  wusheng: {
    id: 'wusheng', name: '武圣',
    desc: '你可以将一张红色牌当【杀】使用或打出。',
    type: 'viewAs',
    viewAs: { name: 'sha' },
    filterCard: (card) => card.color === 'red',
    position: 'he',
  },

  /** 张飞·咆哮：锁定技，出牌阶段使用【杀】无次数限制 */
  paoxiao: {
    id: 'paoxiao', name: '咆哮',
    desc: '锁定技。出牌阶段，你使用【杀】无次数限制。',
    type: 'mod', locked: true,
    mod: {
      shaUnlimited: () => true,
    },
  },

  /** 诸葛亮·观星：回合开始阶段，可观星若干张牌并调整顺序 */
  guanxing: {
    id: 'guanxing', name: '观星',
    desc: '回合开始阶段开始时，你可以观看牌堆顶的 X 张牌（X 为存活角色数且至多为 5），将其中任意数量的牌以任意顺序置于牌堆顶，其余置于牌堆底。',
    type: 'trigger', trigger: 'turnStart',
    async content(ctx) {
      const n = Math.min(5, ctx.game.players.filter((p) => p.alive).length);
      const cards = ctx.game.takeFromDeckTop(n);
      const reordered = await ctx.player.arrangeCards(cards, '观星：调整牌的顺序（先点选的在上方）');
      const top = reordered.top || [];
      const bottom = reordered.bottom || [];
      ctx.game.putOnDeckTop(top);
      ctx.game.putOnDeckBottom(bottom);
    },
  },

  /** 诸葛亮·空城：锁定技，无手牌时不能成为【杀】或【决斗】的目标 */
  kongcheng: {
    id: 'kongcheng', name: '空城',
    desc: '锁定技。若你没有手牌，你不能成为【杀】或【决斗】的目标。',
    type: 'mod', locked: true,
    mod: {
      cannotBeTarget: (card, player) => (
        player.countCards('h') === 0 && (card.name === 'sha' || card.name === 'juedou')
      ),
    },
  },

  /** 赵云·龙胆：可将【杀】当【闪】、【闪】当【杀】使用或打出 */
  longdan: {
    id: 'longdan', name: '龙胆',
    desc: '你可以将一张【杀】当【闪】、一张【闪】当【杀】使用或打出。',
    type: 'viewAs',
    viewAs: { name: 'sha' },
    filterCard: (card) => card.name === 'shan',
    position: 'he',
    viewAs2: { name: 'shan', filterCard: (card) => card.name === 'sha' },
  },

  /** 马超·马术：锁定技，计算与其他角色的距离-1 */
  mashu: {
    id: 'mashu', name: '马术',
    desc: '锁定技。你计算与其他角色的距离时 -1。',
    type: 'mod', locked: true,
    mod: {
      distanceFrom: (num) => num - 1,
    },
  },

  /** 马超·铁骑：使用【杀】指定目标后，可判定，红色则目标不能使用【闪】 */
  tieji: {
    id: 'tieji', name: '铁骑',
    desc: '当你使用【杀】指定目标后，你可以进行判定：若结果为红色，该角色不能使用【闪】响应此【杀】。',
    type: 'trigger', trigger: 'targetConfirm',
    filter: (ctx) => ctx.event.card && ctx.event.card.name === 'sha',
    async content(ctx) {
      const judge = await ctx.player.judge('tieji');
      if (judge.color === 'red') {
        ctx.event.noShan = true;
      }
    },
  },

  /** 黄月英·集智：使用锦囊时摸一张牌 */
  jizhi: {
    id: 'jizhi', name: '集智',
    desc: '当你使用一张非延时锦囊牌时，你可以摸一张牌。',
    type: 'trigger', trigger: 'cardUsed',
    filter: (ctx) => ctx.event.card && ctx.event.card.type === 'trick' && !ctx.event.card.delayed,
    async content(ctx) {
      await ctx.player.draw(1);
    },
  },

  /** 黄月英·奇才：锁定技，使用锦囊无距离限制 */
  qicai: {
    id: 'qicai', name: '奇才',
    desc: '锁定技。你使用锦囊牌无距离限制。',
    type: 'mod', locked: true,
    mod: {
      trickNoDistance: () => true,
    },
  },

  /* ======================= 吴 ======================= */

  /** 孙权·制衡：出牌阶段限一次，弃置任意张牌并摸等量牌 */
  zhiheng: {
    id: 'zhiheng', name: '制衡',
    desc: '出牌阶段限一次，你可以弃置任意张牌，然后摸等量的牌。',
    type: 'active', trigger: 'phaseUse', usable: 1,
    filter: (ctx) => ctx.player.countCards('he') > 0,
    async content(ctx) {
      const cards = await ctx.player.chooseCards({
        prompt: '制衡：选择要弃置的牌',
        position: 'he',
        min: 1, max: ctx.player.countCards('he'),
      });
      if (!cards || !cards.length) return false;
      await ctx.player.discard(cards);
      await ctx.player.draw(cards.length);
      return true;
    },
  },

  /** 孙权·救援（主公技）：濒死时，其他吴势力角色可对其使用桃多回复1点 */
  jiuyuan: {
    id: 'jiuyuan', name: '救援',
    desc: '主公技。当你处于濒死状态时，其他吴势力角色对你使用【桃】时，此【桃】回复的体力 +1。',
    type: 'trigger', trigger: 'dying', lord: true,
    filter: () => false, // 由濒死结算内部处理
  },

  /** 甘宁·奇袭：可将黑色牌当过河拆桥使用 */
  qixi: {
    id: 'qixi', name: '奇袭',
    desc: '你可以将一张黑色牌当【过河拆桥】使用。',
    type: 'viewAs',
    viewAs: { name: 'guohe' },
    filterCard: (card) => card.color === 'black',
    position: 'he',
  },

  /** 吕蒙·克己：若未于出牌阶段使用或打出【杀】，可跳过弃牌阶段 */
  keji: {
    id: 'keji', name: '克己',
    desc: '若你未于出牌阶段内使用或打出过【杀】，你可以跳过弃牌阶段。',
    type: 'trigger', trigger: 'discardPhaseBefore',
    filter: (ctx) => !ctx.player.hasFlag('usedShaThisTurn'),
    async content(ctx) {
      ctx.event.skipDiscard = true;
      return true;
    },
  },

  /** 黄盖·苦肉：出牌阶段，可失去1点体力并摸两张牌 */
  kurou: {
    id: 'kurou', name: '苦肉',
    desc: '出牌阶段，你可以失去 1 点体力，然后摸两张牌。',
    type: 'active', trigger: 'phaseUse',
    filter: (ctx) => ctx.player.hp > 0,
    async content(ctx) {
      await ctx.player.loseHp(1);
      await ctx.player.draw(2);
      return true;
    },
  },

  /** 周瑜·英姿：摸牌阶段可多摸一张牌 */
  yingzi: {
    id: 'yingzi', name: '英姿',
    desc: '摸牌阶段，你可以多摸一张牌。',
    type: 'trigger', trigger: 'drawPhaseBefore',
    async content(ctx) {
      ctx.event.drawDelta = 1;
      return true;
    },
  },

  /** 周瑜·反间：出牌阶段限一次，令一名角色选择花色，展示手牌并令其获得其中一张 */
  fanjian: {
    id: 'fanjian', name: '反间',
    desc: '出牌阶段限一次，你可以令一名其他角色选择一种花色，然后观看你的一张手牌并获得之。若此牌花色与其所选不同，该角色受到你造成的 1 点伤害。',
    type: 'active', trigger: 'phaseUse', usable: 1,
    filter: (ctx) => ctx.player.countCards('h') > 0
      && ctx.game.players.some((p) => p !== ctx.player && p.alive),
    async content(ctx) {
      const targets = await ctx.player.chooseTargets({
        prompt: '反间：选择一名角色',
        candidates: ctx.game.players.filter((p) => p !== ctx.player && p.alive),
        min: 1, max: 1,
      });
      if (!targets || !targets.length) return false;
      const target = targets[0];
      const suit = await target.chooseOption({
        prompt: '反间：选择一种花色',
        options: [
          { key: 'spade', label: '♠ 黑桃' },
          { key: 'heart', label: '♥ 红桃' },
          { key: 'club', label: '♣ 梅花' },
          { key: 'diamond', label: '♦ 方片' },
        ],
      });
      const cards = ctx.player.getCards('h');
      /*
       * 参考无名杀 fanjian.content：
       *   target.gainPlayerCard({ target: player, position: 'h', forced: true })
       *
       * 注意是 **目标自己** 从周瑜的手牌中拿一张 —— 不是随机取。
       * 目标先声明花色，再从暗置手牌里挑一张（赌花色）。
       * 历史 bug：早期用 randomPick 随机拿，等于剥夺了目标的赌牌权利。
       */
      const picked0 = await target.chooseCardFromPlayer(
        ctx.player, 'h', '反间：从周瑜的手牌中拿取一张（若花色不符将受到 1 点伤害）',
      );
      const picked = (picked0 && picked0[0]) || cards[0];
      if (!picked) return false;
      await ctx.player.loseCards([picked]);
      await target.gain([picked], 'gain2');
      ctx.game.log(`${target.name} 获得了周瑜的一张手牌`);
      if (picked.suit !== suit) {
        await target.damage(1, ctx.player, 'fanjian');
      }
      return true;
    },
  },

  /** 大乔·国色：可将方块牌当乐不思蜀使用 */
  guose: {
    id: 'guose', name: '国色',
    desc: '你可以将一张方块牌当【乐不思蜀】使用。',
    type: 'viewAs',
    viewAs: { name: 'lebu' },
    filterCard: (card) => card.suit === 'diamond',
    position: 'he',
  },

  /** 大乔·流离：成为【杀】目标时，可弃一张牌将目标转移给他人 */
  liuli: {
    id: 'liuli', name: '流离',
    desc: '当你成为【杀】的目标时，你可以弃置一张牌，将此【杀】转移给你攻击范围内的一名其他角色。',
    type: 'trigger', trigger: 'targeted',
    filter: (ctx) => ctx.event.card && ctx.event.card.name === 'sha' && ctx.player.countCards('he') > 0,
    async content(ctx) {
      const attacker = ctx.event.source;
      const cands = ctx.game.players.filter(
        (p) => p !== ctx.player && p !== attacker && p.alive
          && attacker && attacker.inAttackRange(p),
      );
      if (!cands.length) return false;
      const res = await ctx.player.chooseToDiscard({
        prompt: '流离：弃置一张牌以转移目标',
        position: 'he',
      });
      if (!res || !res.cards || !res.cards.length) return false;
      const t = await ctx.player.chooseTargets({
        prompt: '流离：选择转移的目标',
        candidates: cands, min: 1, max: 1,
      });
      if (!t || !t.length) return false;
      ctx.event.redirectTo = t[0];
      return true;
    },
  },

  /** 陆逊·谦逊：锁定技，不能成为【顺手牵羊】和【乐不思蜀】的目标 */
  qianxun: {
    id: 'qianxun', name: '谦逊',
    desc: '锁定技。你不能成为【顺手牵羊】和【乐不思蜀】的目标。',
    type: 'mod', locked: true,
    mod: {
      cannotBeTarget: (card) => card.name === 'shunshou' || card.name === 'lebu',
    },
  },

  /** 陆逊·连营：失去最后手牌时摸一张 */
  lianying: {
    id: 'lianying', name: '连营',
    desc: '当你失去最后的手牌时，你可以摸一张牌。',
    type: 'trigger', trigger: 'handCardLost',
    filter: (ctx) => ctx.player.countCards('h') === 0,
    async content(ctx) {
      await ctx.player.draw(1);
    },
  },

  /** 孙尚香·结姻：出牌阶段限一次，弃两张手牌令一名已受伤男性角色与自己各回复1点 */
  jieyin: {
    id: 'jieyin', name: '结姻',
    desc: '出牌阶段限一次，你可以弃置两张手牌，令一名已受伤的男性角色与你各回复 1 点体力。',
    type: 'active', trigger: 'phaseUse', usable: 1,
    filter: (ctx) => ctx.player.countCards('h') >= 2
      && ctx.game.players.some((p) => p !== ctx.player && p.alive && p.sex === 'male' && p.hp < p.maxHp),
    async content(ctx) {
      const cands = ctx.game.players.filter(
        (p) => p !== ctx.player && p.alive && p.sex === 'male' && p.hp < p.maxHp,
      );
      const t = await ctx.player.chooseTargets({
        prompt: '结姻：选择一名已受伤的男性角色',
        candidates: cands, min: 1, max: 1,
      });
      if (!t || !t.length) return false;
      const res = await ctx.player.discardCards(2, 'h', '结姻：弃置两张手牌');
      if (!res) return false;
      await ctx.player.recover(1);
      await t[0].recover(1);
      return true;
    },
  },

  /** 孙尚香·枭姬：失去装备区牌时摸两张 */
  xiaoji: {
    id: 'xiaoji', name: '枭姬',
    desc: '当你失去装备区里的一张牌后，你可以摸两张牌。',
    type: 'trigger', trigger: 'equipLost',
    async content(ctx) {
      await ctx.player.draw(2);
    },
  },

  /* ======================= 群 ======================= */

  /** 华佗·急救：濒死时，可将红色牌当桃使用 */
  jijiu: {
    id: 'jijiu', name: '急救',
    desc: '你的回合外，你可以将一张红色牌当【桃】使用。',
    type: 'viewAs',
    viewAs: { name: 'tao' },
    filterCard: (card) => card.color === 'red',
    position: 'he',
    onlyDying: true,
  },

  /** 华佗·青囊：出牌阶段限一次，弃一张手牌令一名角色回复1点 */
  qingnang: {
    id: 'qingnang', name: '青囊',
    desc: '出牌阶段限一次，你可以弃置一张手牌，令一名已受伤的角色回复 1 点体力。',
    type: 'active', trigger: 'phaseUse', usable: 1,
    filter: (ctx) => ctx.player.countCards('h') > 0
      && ctx.game.players.some((p) => p.alive && p.hp < p.maxHp),
    async content(ctx) {
      const cands = ctx.game.players.filter((p) => p.alive && p.hp < p.maxHp);
      const t = await ctx.player.chooseTargets({
        prompt: '青囊：选择一名已受伤的角色',
        candidates: cands, min: 1, max: 1,
      });
      if (!t || !t.length) return false;
      const res = await ctx.player.discardCards(1, 'h', '青囊：弃置一张手牌');
      if (!res) return false;
      await t[0].recover(1);
      return true;
    },
  },

  /** 吕布·无双：锁定技，使用【杀】需两张【闪】，【决斗】需两张【杀】 */
  wushuang: {
    id: 'wushuang', name: '无双',
    desc: '锁定技。当你使用【杀】指定一名角色为目标后，该角色需连续使用两张【闪】才能抵消；当你使用【决斗】时，对方需连续打出两张【杀】。',
    type: 'mod', locked: true,
    mod: {
      shanRequired: (n) => n + 1,
      juedouShaRequired: (n) => n + 1,
    },
  },

  /** 貂蝉·离间：出牌阶段限一次，弃一张牌令两名男性角色决斗 */
  lijian: {
    id: 'lijian', name: '离间',
    desc: '出牌阶段限一次，你可以弃置一张牌，令两名男性角色进行【决斗】。',
    type: 'active', trigger: 'phaseUse', usable: 1,
    filter: (ctx) => ctx.player.countCards('he') > 0
      && ctx.game.players.filter((p) => p !== ctx.player && p.alive && p.sex === 'male').length >= 2,
    async content(ctx) {
      const males = ctx.game.players.filter((p) => p !== ctx.player && p.alive && p.sex === 'male');
      const picked = await ctx.player.chooseTargets({
        prompt: '离间：选择两名男性角色',
        candidates: males, min: 2, max: 2,
      });
      if (!picked || picked.length < 2) return false;
      const res = await ctx.player.chooseToDiscard({
        prompt: '离间：弃置一张牌',
        position: 'he',
      });
      if (!res || !res.cards || !res.cards.length) return false;
      await ctx.player.discard(res.cards);
      // 令第二人向第一人发起决斗
      await ctx.game.doJuedou(picked[1], picked[0]);
      return true;
    },
  },

  /** 貂蝉·闭月：结束阶段摸一张牌 */
  biyue: {
    id: 'biyue', name: '闭月',
    desc: '结束阶段开始时，你可以摸一张牌。',
    type: 'trigger', trigger: 'turnEnd',
    async content(ctx) {
      await ctx.player.draw(1);
    },
  },

  /** 华雄·恃勇：锁定技，受到红色【杀】或【酒】【杀】时，伤害+1 */
  shizhan: {
    id: 'shizhan', name: '恃勇',
    desc: '锁定技。当你受到红色【杀】造成的伤害时，此伤害 +1。',
    type: 'mod', locked: true,
    mod: {
      damageFromSha: (num, card) => (card && card.color === 'red' ? num + 1 : num),
    },
  },

  /* ==================== 装备技能（由装备牌触发） ==================== */

  zhuge_skill: {
    id: 'zhuge_skill', name: '诸葛连弩',
    desc: '出牌阶段，你可以使用任意数量的【杀】。',
    type: 'mod', equip: true,
    mod: { shaUnlimited: () => true },
  },
  qinggang_skill: {
    id: 'qinggang_skill', name: '青釭剑',
    desc: '你的【杀】无视目标防具。',
    type: 'mod', equip: true,
    mod: { ignoreArmor: () => true },
  },
  cixiong_skill: {
    id: 'cixiong_skill', name: '雌雄双股剑',
    desc: '你使用【杀】指定异性目标后，可令其弃一张手牌或令你摸一张牌。',
    type: 'trigger', trigger: 'targetConfirm', equip: true,
    filter: (ctx) => ctx.event.card && ctx.event.card.name === 'sha'
      && ctx.event.target && ctx.event.target.sex !== ctx.player.sex,
    async content(ctx) {
      const target = ctx.event.target;
      const choice = await target.chooseOption({
        prompt: '雌雄双股剑：弃置一张手牌，或令对方摸一张牌',
        options: [
          { key: 'discard', label: '弃置一张手牌' },
          { key: 'draw', label: '令对方摸一张牌' },
        ],
      });
      if (choice === 'discard' && target.countCards('h') > 0) {
        await target.discardCards(1, 'h', '雌雄双股剑');
      } else {
        await ctx.player.draw(1);
      }
    },
  },
  qinglong_skill: {
    id: 'qinglong_skill', name: '青龙偃月刀',
    desc: '你使用的【杀】被【闪】抵消时，可以再使用一张【杀】。',
    type: 'trigger', trigger: 'shaDodged', equip: true,
    async content(ctx) {
      // 简化：摸一张牌作为补偿（完整实现需再出一张杀，避免递归复杂化）
      await ctx.player.draw(1);
      ctx.game.log(`${ctx.player.name} 的【青龙偃月刀】发动，摸一张牌`);
    },
  },
  zhangba_skill: {
    id: 'zhangba_skill', name: '丈八蛇矛',
    desc: '你可以将两张手牌当【杀】使用或打出。',
    type: 'viewAs', equip: true,
    viewAs: { name: 'sha' },
    filterCard: () => true,
    position: 'h',
    needCount: 2,
  },
  guanshi_skill: {
    id: 'guanshi_skill', name: '贯石斧',
    desc: '你使用的【杀】被【闪】抵消时，可以弃置两张牌令此【杀】依然造成伤害。',
    type: 'trigger', trigger: 'shaDodged', equip: true,
    filter: (ctx) => ctx.player.countCards('he') >= 2,
    async content(ctx) {
      const res = await ctx.player.discardCards(2, 'he', '贯石斧：弃置两张牌');
      if (res) ctx.event.forceHit = true;
    },
  },
  fangtian_skill: {
    id: 'fangtian_skill', name: '方天画戟',
    desc: '你使用【杀】时若为最后一张手牌，可以额外指定两个目标。',
    type: 'mod', equip: true,
    mod: { extraTargetWhenLast: () => 2 },
  },
  qilin_skill: {
    id: 'qilin_skill', name: '麒麟弓',
    desc: '你使用【杀】对目标造成伤害时，可以弃置其装备区里的一张坐骑牌。',
    type: 'trigger', trigger: 'damageEnd', equip: true,
    filter: (ctx) => ctx.event.source === ctx.player && ctx.event.card && ctx.event.card.name === 'sha'
      && ctx.event.target && ctx.event.target.countCards('e', { subtype: ['equip3', 'equip4'] }) > 0,
    async content(ctx) {
      const t = ctx.event.target;
      const mounts = t.getCards('e').filter((c) => ['equip3', 'equip4'].includes(c.subtype));
      if (mounts.length) {
        const c = await ctx.player.chooseCardFromList(mounts, '麒麟弓：弃置一张坐骑牌');
        if (c) await t.loseCards([c]);
      }
    },
  },
  bagua_skill: {
    id: 'bagua_skill', name: '八卦阵',
    desc: '当你需要使用或打出【闪】时，你可以判定：若为红色，视为你使用或打出一张【闪】。',
    type: 'trigger', trigger: 'askForShan', equip: true,
    async content(ctx) {
      const judge = await ctx.player.judge('bagua');
      if (judge.color === 'red') {
        ctx.event.baguaShan = true;
        return true;
      }
      return false;
    },
  },
  renwang_skill: {
    id: 'renwang_skill', name: '仁王盾',
    desc: '黑色的【杀】对你无效。',
    type: 'mod', equip: true,
    mod: {
      immunity: (card) => card.name === 'sha' && card.color === 'black',
    },
  },
  tengjia_skill: {
    id: 'tengjia_skill', name: '藤甲',
    desc: '【南蛮入侵】、【万箭齐发】和普通【杀】对你无效。你受到火焰伤害时，此伤害 +1。',
    type: 'mod', equip: true,
    mod: {
      immunity: (card) => ['nanman', 'wanjian'].includes(card.name)
        || (card.name === 'sha' && !card.nature),
      /**
       * 第一级：增减伤
       * 火焰伤害 +1。
       *
       * ⚠️ 必须是**穿着藤甲的人自己受到**的伤害才 +1，
       * 即 role 必须是 'target'（受伤者）。
       *
       * 注意：card 可能为 null（如【火攻】用 nature 参数传入属性），
       * 因此必须同时看 ev.card.nature 与 ev.nature。
       */
      damageModify: (num, ev, owner, role) => {
        if (role !== 'target') return num;   // 只有受伤者自己的藤甲生效
        const nat = ev.nature || (ev.card && ev.card.nature);
        return nat === 'fire' ? num + 1 : num;
      },
    },
  },
  hanbing_skill: {
    id: 'hanbing_skill', name: '寒冰剑',
    desc: '你使用【杀】造成伤害时，可以防止此伤害，改为弃置目标两张牌。',
    type: 'trigger', trigger: 'damageBegin', equip: true,
    filter: (ctx) => ctx.event.source === ctx.player && ctx.event.card
      && ctx.event.card.name === 'sha' && ctx.event.target && ctx.event.target.countCards('he') >= 2,
    async content(ctx) {
      ctx.event.prevented = true;
      await ctx.event.target.discardCards(2, 'he', '寒冰剑');
    },
  },

  /* ==================================================================
   * 风林火山装备技能
   * ================================================================== */

  /** 朱雀羽扇：可将一张普通【杀】当火【杀】使用或打出 */
  zhuque_skill: {
    id: 'zhuque_skill', name: '朱雀羽扇',
    desc: '你可以将一张普通【杀】当火【杀】使用或打出。',
    type: 'mod', locked: true, equip: true,
    mod: {
      /**
       * 提供「火杀」转化能力
       * 引擎在出【杀】时会查询此标记，若为 true 则允许玩家
       * 选择是否将这张【杀】按火焰属性结算。
       * 见 engine.useCard 里的 fireSha 分支。
       */
      canUseAsFireSha: () => true,
    },
  },

  /** 木牛流马：可存放手牌，并将其下的牌如手牌般使用 */
  muniu_skill: {
    id: 'muniu_skill', name: '木牛流马',
    desc: '出牌阶段限一次，你可以将一张手牌置于【木牛流马】下。'
      + '你可以将【木牛流马】下的牌如手牌般使用或打出。',
    type: 'active',
    filter: (ctx) => {
      const p = ctx.player;
      // 未满 5 张且手里有牌时可发动
      return p.countCards('h') > 0 && this.muniuCards(p).length < 5;
    },
    async content(ctx) {
      const p = ctx.player;
      const picked = await p.chooseCards({
        prompt: '木牛流马：请选择一张手牌置于其下',
        position: 'h', min: 1, max: 1, cancelable: true,
      });
      if (!picked || !picked.length) return;
      const game = ctx.game;
      const eq = p.equips.equip5;
      if (!eq) return;
      eq.storage = eq.storage || { cards: [] };
      await p.loseCards(picked);
      for (const c of picked) {
        c.zone = 'equip';          // 视为装备区的附属牌
        c.owner = p;
        eq.storage.cards.push(c);
      }
      game.log(`${p.name} 将 ${picked.map((c) => c.text).join('、')} 置于【木牛流马】下`);
      p.flags.muniuUsed = (p.flags.muniuUsed || 0) + 1;
      game.emit();
    },
  },

  /** 古锭刀：对无手牌的目标造成伤害 +1 */
  guding_skill: {
    id: 'guding_skill', name: '古锭刀',
    desc: '你使用【杀】造成伤害时，若目标没有手牌，此伤害 +1。',
    type: 'mod', locked: true, equip: true,
    mod: {
      /** 第一级：增减伤（必须是**使用者的**古锭刀，故 role 为 source） */
      damageModify: (num, ev, owner, role) => {
        if (role !== 'source') return num;   // 只有出杀者自己装备的古锭刀生效
        if (!ev.card || ev.card.name !== 'sha') return num;
        if (ev.player && ev.player.countCards('h') === 0) return num + 1;
        return num;
      },
    },
  },

  /** 白银狮子：伤害超过 1 时只受 1 点；失去时回复 1 点 */
  baiyin_skill: {
    id: 'baiyin_skill', name: '白银狮子',
    desc: '锁定技。当你受到伤害时，若此伤害大于 1，防止多余伤害。'
      + '当你失去装备区里的【白银狮子】时，回复 1 点体力。',
    type: 'mod', locked: true, equip: true,
    mod: {
      /**
       * 特殊裁定（第三级，永远最后执行）
       * ------------------------------------------------------------------
       * 这是「finalDamage」这一类：不参与前面的增减伤计算，
       * 而是在所有增伤/减伤/最终修改都算完之后，拿到最终数字，
       * 再判断是否要动手。
       *
       * 效果：最终伤害 > 1 时，只受 1 点。
       *
       * ⚠️ 归属限制（由引擎的 applyFinalDamage 保证）：
       * 只有 **role === 'target'**（受伤者自己）的技能才会执行到这一级。
       * 所以「自己穿白银狮子去打别人」不会误触发。
       *
       * 为什么必须最后：
       *   设基础伤害 1，对方有【酒】+1、【藤甲】火焰+1，合计 3。
       *   若白银狮子提前执行（看到 1，不触发），最终仍是 3 点 —— 错误。
       *   最后执行（看到 3，减为 1），最终 1 点 —— 正确。
       *
       * 返回值：
       *   number  → 采纳这个新数值
       *   undefined → 不做修改
       */
      finalDamage: (num, ev, owner, role) => {
        if (role !== 'target') return undefined;  // 双保险：只保护穿它的人
        if (num > 1) return 1;
        return undefined;
      },
    },
  },

  /* ======================= 自定义机制（本项目扩展） ======================= */
  /*
   * 说明：以下两个技能不属于标准包，是为「机制」预留的载体技能。
   * 它们都实现为锁定技（type:'mod' + locked:true），
   * 因此按无名杀语义属于「永续效果」，不会被「不能发动技能」类
   * 机制封锁，也不会被「牌无视技能」类机制屏蔽。
   */

  /**
   * 「空上限视为护甲」
   * ------------------------------------------------------------------
   * 锁定技。你的空余体力上限（体力上限 - 当前体力）如同护甲一般，
   * 会优先代替你承受伤害；被它挡下的伤害不扣体力，
   * 也不改变体力上限与护甲值。
   *
   * 具体结算由引擎 doDamage 读取本技能后执行（见 engine.js）。
   * 例：4/4 挨 3 点 → 1/4（空上限变为 3）；随后再挨 2 点 → 仍为 1/4。
   */
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

  /**
   * 「手牌与体力等价」
   * ------------------------------------------------------------------
   * 锁定技。你进行「摸牌 / 弃牌」时，可以改为不摸/不弃，
   * 而做等量的体力增加/减小；弃牌阶段的弃牌可以一次性地
   * 用扣血（或扣部分血 + 弃部分牌）来完成。
   *
   * 该结算仅视为摸牌/弃牌，不视为回复体力或失去体力。
   * 具体结算由引擎 Player.drawAsHp / payDiscardWithHp /
   * chooseDiscardSplit 提供（见 engine.js）。
   */
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

  /* ======================= 再探泰拉（本扩） ======================= */

  /**
   * 折桠·无我入春时
   * ==================================================================
   * 描述（需求方给定，逐字遵循）：
   *   每个回合此技能只能使用 1 次。有角色受到伤害时，如果那次的伤害
   *   要让体力值确切减小（包含角色没有护甲、或者伤害大于护甲），
   *   那么你可以流失 1 点体力，防止那次的伤害。
   *   如果发动此技能的「让你流失 1 点体力」导致你濒死，则你直接恢复
   *   体力值直到 1，那之后，这个回合没有使用过牌、但是成为过牌的目标
   *   的其他角色，以及你，各获得 1 点护甲。
   *
   * 关键裁定（已与需求方确认）：
   *   ① 「伤害要让体力值确切减小」= 最终伤害值 > 该角色当前护甲
   *      （无护甲即护甲为 0，此时任何 >0 的伤害都算）。
   *   ② 「有角色受到伤害」= **任意角色**，包括别人。
   *   ③ 给护甲时：其他角色需满足「本回合未使用过牌、但成为过牌的目标」；
   *      **你自己默认在名单里**（不需要满足该条件）。
   *
   * 时机：damageBegin —— 在伤害数值三级管线算完之后（引擎保证），
   *       此时 ev.num 已是最终伤害；置 ev.prevented 即可防止。
   */
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

  /**
   * 折桠·星火尽染寒
   * ==================================================================
   * 描述（需求方给定）：
   *   你的出牌阶段开始时，你可以摸 X 张牌（X 是你已经损失的体力值 +2），
   *   这些摸到的牌使用的时候没有距离限制，没有次数限制。
   *   如果你发动了这个技能，这个回合你使用的牌，只能指定符合以下条件
   *   角色，其他角色不能成为目标（若为南蛮这种牌，则不再是全部其他角色
   *   而是符合条件的全部其他角色）：
   *     手牌数不小于你的角色；体力值不小于你的角色
   *
   * 关键裁定（已与需求方确认）：
   *   目标限制覆盖**该回合你使用的所有牌**，而不只是摸到的那 X 张。
   */
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

  /* ======================= 再探泰拉 · 卡达 ======================= */

  /**
   * 卡达·剪辑高手
   * ==================================================================
   * 描述（需求方给定）：
   *   每种颜色每回合各限一次。每回合结束时，你可将一张手牌置入弃牌堆，
   *   视为中央区一张牌使用之；若二者：
   *     类型相同，你重复此流程；
   *     花色相同，你摸一张牌。
   *
   * 关键裁定（已与需求方确认）：
   *   ① 把手牌 A 直接放入弃牌堆（**不经过中央区**），
   *      然后「视为自己使用中央区的一张牌 B」。
   *      B 必须**当前可用**（例如全场没人有武器时不能选【借刀杀人】）。
   *   ② 「二者」= 弃掉的牌 A ↔ 中央区那张牌 B，比较它们的类型与花色。
   *   ③ 这个操作本质是「用 A 转化为 B 使用」，
   *      因此**能触发【同步索敌攻击】**（见该技能的转化处理）。
   *
   * 「每种颜色每回合各限一次」= 弃掉的那张牌的颜色（红/黑）各限一次。
   */
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

  /**
   * 卡达·同步索敌攻击
   * ==================================================================
   * 描述（需求方给定）：
   *   你使用的牌结算后若有其他角色体力或手牌数减少，你摸一张牌；
   *   此技能获得的牌不计入手牌上限且使用时不受距离限制，
   *   若将之转化其他牌使用，你摸一张牌。
   *
   * 关键裁定（已与需求方确认）：
   *   ① 「其他角色体力或手牌数减少」= 与该牌使用前相比，任一其他角色的
   *      体力值或手牌数变小了（自己不算）。
   *   ② 「若将之转化其他牌使用，你摸一张」= 用这些牌**当作别的牌使用**
   *      （如把一张牌当【杀】打出）时，额外摸一张。
   *      折桠的【剪辑高手】也属于这种「转化」。
   *
   * 实现方式：
   *   在牌使用前记录全场快照，结算后比对；
   *   摸到的牌打上 'suodi' 标记 → 不计入手牌上限、无距离限制。
   */
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

  /* ===================== 再探泰拉 · 白金磷子 ===================== */

  /**
   * 白金磷子·怯懦的琴键
   * ==================================================================
   * 描述（需求方给定）：
   *   锁定技，韵律技，转换技。
   *   平：你体力未满时；仄：其他角色不能使用或打出与**结算中出现过
   *   花色**的牌；你**扣减体力后**，① 摸三张牌或翻面，② 重新隐匿。
   *   激昂：连招（周始 + 周始）。
   *
   * 关键裁定（已与需求方确认）：
   *   · **韵律技**转换的是「平 / 仄」这两个选项，
   *     转韵条件 = **你扣减体力后**（受到伤害与流失体力都算）；
   *   · **转换技**转换的是「① / ②」这两项，
   *     同样在你扣减体力后切换；
   *   · 「激昂：连招（周始 + 周始）」= 周始效果**触发两次**。
   *
   * 「结算中出现过的花色」：记录本回合进入过结算的牌的花色集合，
   * 其他角色不得使用/打出这些花色的牌。
   */
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

  /**
   * 白金磷子·前行的决心
   * ==================================================================
   * 描述（需求方给定）：
   *   昂扬技，隐匿技。
   *   你**登场时**，于同一结算内使用 [0, 你手牌数] 张牌堆顶的牌。
   *   若你：反面向上，下次发动技能你可背水；
   *         已受伤，每个花色首次使用后你从牌堆底摸一张牌。
   *   乘势：转韵。
   *
   * 关键裁定（已与需求方确认）：
   *   · [0, 手牌数] = **可使用 0 到（当前手牌数）张之间任意数量**的
   *     牌堆顶的牌；
   *   · 「乘势：转韵」= 满足转韵条件时切换韵律技选项。
   */
  qianxingdejuexin: {
    id: 'qianxingdejuexin', name: '前行的决心',
    desc: '昂扬技，隐匿技。你登场时，于同一结算内使用'
      + '[0,你手牌数]张牌堆顶的牌。'
      + '若你：反面向上，下次发动技能你可背水；'
      + '已受伤，每个花色首次使用后你从牌堆底摸一张牌。'
      + '乘势：转韵。',
    type: 'trigger', trigger: 'hiddenReveal',
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
};

/** 取某角色【木牛流马】下的牌 */
export function muniuCards(player) {
  const eq = player.equips && player.equips.equip5;
  if (!eq || eq.name !== 'muniu' || !eq.storage) return [];
  return eq.storage.cards || [];
}

/* ============================================================
 * 白金磷子 的两个技能：内部辅助函数
 * ============================================================ */

/**
 * 「昂扬：连招（周始 + 周始）」的一次周始效果
 * ------------------------------------------------------------------
 * 按需求方给定，本技能的周始效果就是**再触发一次周始**，
 * 连招意味着连续触发两次。
 * 这里实现为一次「激昂」结算：摸一张牌并重置昂扬技。
 */
async function runZhouShiEffect(player, game) {
  if (!player || !player.alive) return;
  game.log(`【周始】${player.name} 结算一次周始效果`);
  await player.draw(1);
  game.emit();
}

/**
 * 「前行的决心」的登场结算
 * ==================================================================
 * 需求方给定：你登场时，**于同一结算内**使用 [0, 你手牌数] 张牌堆顶的牌。
 *
 * 精确定义（已与需求方逐条确认，用一个例子固定下来）：
 *   假设牌堆顶依次是【杀】【杀】【无中生有】。
 *
 *   ① **窗口 = 牌堆顶 X 张**，X = **当前手牌数**（会随结算变化）。
 *      登场手牌 1 张 → 窗口只看到牌堆顶 1 张（无中生有）。
 *
 *   ② 用掉一张后，那个**位置就空了（"空气"）**，
 *      **不会从第 X+1 张补位进来**。
 *      上例：用掉无中生有 → 手牌变 3 → 窗口扩大为看牌堆顶 3 张，
 *      但第 3 位（无中生有）已用掉 → 实际是「空气、杀、杀」，
 *      所以还能用那 **2 张【杀】**。
 *
 *   ③ 因此**永远不会因为用掉一张而去翻更后面的牌**。
 *
 *   ④ 不能用的牌**按原顺序放回牌堆顶**。
 *
 *   ⑤ 整个「前行」是一段**不可打断的结算块**：
 *      期间的血量照常扣，但**濒死结算排队**，等块走完才依次处理。
 *      这也是为了配合【怯懦的琴键】——「仄」的封锁集合在块内**累积**。
 */
export async function resolveQianxing(player, game) {
  const firstLimit = player.countCards('h');
  game.log(`【前行的决心】${player.name} 登场，`
    + `进入「同一结算」，窗口为牌堆顶 ${firstLimit} 张`);

  game.beginSameResolution('前行的决心');

  /*
   * 窗口模型
   * ----------------------------------------------------------------
   * slots 是按「牌堆顶顺序」排列的数组，长度 = 窗口宽度。
   *   slots[i] = 该位置上的牌；用掉后置为 null（"空气"），
   *   **不再补位**——这正是需求方强调的「不会去翻第 X+1 张」。
   *
   * 窗口宽度会随手牌数增长而变宽：变宽时，只把**新覆盖到的位置**
   * 从牌堆取出填入（这些位置此前不在窗口内，属于"新看到"的牌）。
   */
  const slots = [];        // 窗口内每个位置的牌（null = 已用掉/空）
  const taken = [];        // 从牌堆取出、归本技能管理的牌（用于归还）
  const used = [];
  let width = 0;           // 当前窗口宽度
  let guard = 0;

  /** 确保窗口宽度至少为 w（只扩不缩），并把新覆盖的位置填上牌 */
  const ensureWidth = (w) => {
    while (slots.length < w) {
      slots.push(undefined);        // undefined = 尚未看过该位置
    }
    while (width < w) {
      const idx = width;
      // 该位置若是「已用掉」的（null）就不取牌
      if (slots[idx] === null) { width++; continue; }
      if (slots[idx] !== undefined) { width++; continue; }
      /*
       * ⚠️ 第二个参数 true = 牌堆空时**不要自动洗牌**。
       * 否则牌堆见底时会 reshuffle 弃牌堆，把刚刚用掉的牌又翻回来，
       * 导致同一张牌被反复使用（实测【无中生有】被用了 3 次）。
       * 这也符合「不会去翻更后面的牌」的语义。
       */
      const more = game.takeFromDeckTop(1, true);
      if (!more.length) {
        // 牌堆真的见底了 → 该位置视为"空"，不再填充
        slots[idx] = null;
        width++;
        continue;
      }
      slots[idx] = more[0];
      width++;
    }
  };

  try {
    while (guard++ < 80) {
      // X = 当前手牌数（窗口中已用掉的位置不计入可用张数）
      const limit = player.countCards('h');
      if (used.length >= limit) break;

      // 窗口随上限变宽（只扩不缩；用掉的位置不会补位）
      ensureWidth(limit);

      // 从窗口里找下一个「还没用过、且位置有效」的牌
      let picked = null;
      for (let i = 0; i < slots.length; i++) {
        const c = slots[i];
        if (c === null || c === undefined) continue;   // 空气 / 未覆盖
        if (picked === null) { picked = { i, c }; break; }
      }
      if (!picked) break;      // 窗口内已无可用的牌

      const { i, c: card } = picked;

      /*
       * 不能用（或选择不用）的牌
       * 需求方给定：**不能用或者没有用的牌最后按照原顺序放回牌堆顶**。
       * 因此这里不消耗它，直接结束循环（它仍在 slots 里，最后归还）。
       */
      const usable = game.cardUsableNow(player, card);
      let want = usable;
      if (usable && player.isHuman) {
        want = await game.io.chooseOption({
          prompt: `【前行的决心】：牌堆顶第 ${i + 1} 张【`
            + `${card.fullname || card.name}】，是否使用？`
            + `（已用 ${used.length} / 上限 ${limit}）`,
          options: ['使用', '不用'],
        }).then((r) => r !== '不用' && r !== 'no').catch(() => true);
      }

      if (!want || !usable) {
        game.log(`【前行的决心】${card.fullname || card.name}`
          + `${usable ? '（选择不用）' : '（无法使用）'}，`
          + `将按原顺序放回牌堆顶`);
        break;
      }

      // 真正使用：该位置置空（不再补位）
      slots[i] = null;
      game.log(`【前行的决心】${player.name} 使用牌堆顶第 ${i + 1} 张 `
        + `${card.fullname || card.name}（该位置留空，不补位）`);
      const targets = await game.pickTargetsForVirtual(player, card)
        .catch(() => []);
      await game.useCard(player, card, targets);
      used.push(card);
      game.emit();
    }
  } finally {
    /*
     * 未使用的牌**按原顺序**放回牌堆顶
     * ----------------------------------------------------------------
     * 只归还仍留在窗口里、且尚未用掉的牌；
     * 顺序 = 它们在牌堆顶的原始先后顺序。
     */
    const toReturn = slots.filter((c) => c && c !== null)
      .filter((c) => !used.includes(c));
    if (toReturn.length) {
      game.putOnDeckTop(toReturn);
      game.log(`【前行的决心】${toReturn.length} 张未使用的牌`
        + `按原顺序放回牌堆顶`);
    }

    // 结束「同一结算」块 → 依次处理积压的濒死等
    await game.endSameResolution();
  }

  game.log(`【前行的决心】${player.name} 于同一结算内实际使用了 `
    + `${used.length} 张牌`);
  game.emit();
  return used;
}

/**
 * 「已受伤时，每个花色首次使用后你从牌堆底摸一张牌」
 * ------------------------------------------------------------------
 * 供引擎在「使用牌后」调用：记录该角色本局用过的花色，
 * 每个花色**首次**使用时从牌堆底摸一张。
 */
export async function noteSuitUsed(player, card, game) {
  if (!player || !card || !game) return false;
  if (!player.hasSkill('qianxingdejuexin')) return false;
  // 必须「已受伤」
  if (player.hp >= player.maxHp) return false;
  player.storage = player.storage || {};
  const key = 'qianxing_suits';
  const used = player.storage[key] || [];
  if (used.includes(card.suit)) return false;
  used.push(card.suit);
  player.storage[key] = used;

  // 从牌堆底摸一张
  const bottom = game.takeFromDeckBottom(1);
  if (bottom.length) {
    await player.gain(bottom);
    game.log(`【前行的决心】${player.name} 首次使用 ${card.suitLabel} 花色的牌，`
      + `从牌堆底摸一张牌`);
  }
  game.emit();
  return true;
}

/**
 * 「若你反面向上，下次发动技能你可背水」
 * ------------------------------------------------------------------
 * 返回该角色此刻是否获得「背水」选项。
 */
export function canBeishuiNow(player) {
  return !!(player && player.isTurnedOver);
}

/** 技能显示名（用于日志） */
export function skillName(id) {
  return (SKILLS[id] && SKILLS[id].name) || id;
}

export default SKILLS;