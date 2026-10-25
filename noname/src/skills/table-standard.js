/**
 * 标准武将技
 * identity/主公技与普通武将技
 * 由 tools/split_skills.cjs 从旧 skills.js 切出。
 */

export default {
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
  qingguo: {
    id: 'qingguo', name: '倾国',
    desc: '你可以将一张黑色手牌当【闪】使用或打出。',
    type: 'viewAs',
    viewAs: { name: 'shan' },
    filterCard: (card) => card.color === 'black',
    position: 'h',
  },
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
  wusheng: {
    id: 'wusheng', name: '武圣',
    desc: '你可以将一张红色牌当【杀】使用或打出。',
    type: 'viewAs',
    viewAs: { name: 'sha' },
    filterCard: (card) => card.color === 'red',
    position: 'he',
  },
  paoxiao: {
    id: 'paoxiao', name: '咆哮',
    desc: '锁定技。出牌阶段，你使用【杀】无次数限制。',
    type: 'mod', locked: true,
    mod: {
      shaUnlimited: () => true,
    },
  },
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
  longdan: {
    id: 'longdan', name: '龙胆',
    desc: '你可以将一张【杀】当【闪】、一张【闪】当【杀】使用或打出。',
    type: 'viewAs',
    viewAs: { name: 'sha' },
    filterCard: (card) => card.name === 'shan',
    position: 'he',
    viewAs2: { name: 'shan', filterCard: (card) => card.name === 'sha' },
  },
  mashu: {
    id: 'mashu', name: '马术',
    desc: '锁定技。你计算与其他角色的距离时 -1。',
    type: 'mod', locked: true,
    mod: {
      distanceFrom: (num) => num - 1,
    },
  },
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
  jizhi: {
    id: 'jizhi', name: '集智',
    desc: '当你使用一张非延时锦囊牌时，你可以摸一张牌。',
    type: 'trigger', trigger: 'cardUsed',
    filter: (ctx) => ctx.event.card && ctx.event.card.type === 'trick' && !ctx.event.card.delayed,
    async content(ctx) {
      await ctx.player.draw(1);
    },
  },
  qicai: {
    id: 'qicai', name: '奇才',
    desc: '锁定技。你使用锦囊牌无距离限制。',
    type: 'mod', locked: true,
    mod: {
      trickNoDistance: () => true,
    },
  },
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
  jiuyuan: {
    id: 'jiuyuan', name: '救援',
    desc: '主公技。当你处于濒死状态时，其他吴势力角色对你使用【桃】时，此【桃】回复的体力 +1。',
    type: 'trigger', trigger: 'dying', lord: true,
    filter: () => false, // 由濒死结算内部处理
  },
  qixi: {
    id: 'qixi', name: '奇袭',
    desc: '你可以将一张黑色牌当【过河拆桥】使用。',
    type: 'viewAs',
    viewAs: { name: 'guohe' },
    filterCard: (card) => card.color === 'black',
    position: 'he',
  },
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
  yingzi: {
    id: 'yingzi', name: '英姿',
    desc: '摸牌阶段，你可以多摸一张牌。',
    type: 'trigger', trigger: 'drawPhaseBefore',
    async content(ctx) {
      ctx.event.drawDelta = 1;
      return true;
    },
  },
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
  guose: {
    id: 'guose', name: '国色',
    desc: '你可以将一张方块牌当【乐不思蜀】使用。',
    type: 'viewAs',
    viewAs: { name: 'lebu' },
    filterCard: (card) => card.suit === 'diamond',
    position: 'he',
  },
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
  qianxun: {
    id: 'qianxun', name: '谦逊',
    desc: '锁定技。你不能成为【顺手牵羊】和【乐不思蜀】的目标。',
    type: 'mod', locked: true,
    mod: {
      cannotBeTarget: (card) => card.name === 'shunshou' || card.name === 'lebu',
    },
  },
  lianying: {
    id: 'lianying', name: '连营',
    desc: '当你失去最后的手牌时，你可以摸一张牌。',
    type: 'trigger', trigger: 'handCardLost',
    filter: (ctx) => ctx.player.countCards('h') === 0,
    async content(ctx) {
      await ctx.player.draw(1);
    },
  },
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
  xiaoji: {
    id: 'xiaoji', name: '枭姬',
    desc: '当你失去装备区里的一张牌后，你可以摸两张牌。',
    type: 'trigger', trigger: 'equipLost',
    async content(ctx) {
      await ctx.player.draw(2);
    },
  },
  jijiu: {
    id: 'jijiu', name: '急救',
    desc: '你的回合外，你可以将一张红色牌当【桃】使用。',
    type: 'viewAs',
    viewAs: { name: 'tao' },
    filterCard: (card) => card.color === 'red',
    position: 'he',
    onlyDying: true,
  },
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
  wushuang: {
    id: 'wushuang', name: '无双',
    desc: '锁定技。当你使用【杀】指定一名角色为目标后，该角色需连续使用两张【闪】才能抵消；当你使用【决斗】时，对方需连续打出两张【杀】。',
    type: 'mod', locked: true,
    mod: {
      shanRequired: (n) => n + 1,
      juedouShaRequired: (n) => n + 1,
    },
  },
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
  biyue: {
    id: 'biyue', name: '闭月',
    desc: '结束阶段开始时，你可以摸一张牌。',
    type: 'trigger', trigger: 'turnEnd',
    async content(ctx) {
      await ctx.player.draw(1);
    },
  },
  shizhan: {
    id: 'shizhan', name: '恃勇',
    desc: '锁定技。当你受到红色【杀】造成的伤害时，此伤害 +1。',
    type: 'mod', locked: true,
    mod: {
      damageFromSha: (num, card) => (card && card.color === 'red' ? num + 1 : num),
    },
  }
};
