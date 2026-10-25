/**
 * 装备技
 * 武器/防具/坐骑的 equipSkill
 * 由 tools/split_skills.cjs 从旧 skills.js 切出。
 */

export default {
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
  }
};
