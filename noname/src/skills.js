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
      for (const t of picked) {
        const cards = t.getCards('h');
        if (cards.length) {
          const c = ctx.game.randomPick(cards);
          await ctx.player.gain([c], 'gain2');
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
      const picked = ctx.game.randomPick(cards);
      await target.gain([picked], 'gain2', ctx.player);
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
      damageTaken: (num, card) => (card && card.nature === 'fire' ? num + 1 : num),
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
};

/** 技能显示名（用于日志） */
export function skillName(id) {
  return (SKILLS[id] && SKILLS[id].name) || id;
}

export default SKILLS;