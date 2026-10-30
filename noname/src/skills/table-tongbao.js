/**
 * 轮换牌 · 卡包二《通宝雅集》· 装备技
 * ==================================================================
 * 这 8 张装备随卡包一起进牌堆，只有装备着才生效。
 * 结构与 table-equip.js 一致：
 *   type: 'mod'     纯被动
 *   type: 'trigger' 引擎在指定时机询问
 *   equip: true     必须装备才生效
 */

const equipped = (player, sid) => Object.values(player.equips || {})
  .filter(Boolean)
  .some((c) => c.equipSkill === sid);

/** 该角色装备区里是否有某张牌 */
const hasCard = (player, name) => Object.values(player.equips || {})
  .filter(Boolean)
  .some((c) => c.name === name);

export default {
  /* ============================ 大炎通宝 ============================ */
  tongbao_dayan_skill: {
    id: 'tongbao_dayan_skill', name: '大炎通宝',
    desc: '锁定技，此装备也视为防具牌，占用防具区；离开你的装备区时你摸一张牌。',
    type: 'mod', locked: true, equip: true,
    mod: {
      /** 同时算作防具（青釭剑「无视防具」等判定会用到） */
      asArmor: () => true,
      /** 离开装备区时摸一张 */
      onEquipLeave: () => 'draw1',
    },
  },

  /* ============================== 旱热 ============================== */
  tongbao_hanre_skill: {
    id: 'tongbao_hanre_skill', name: '旱热',
    desc: '锁定技，每回合首张被使用的红色牌对你造成的伤害 -1。',
    type: 'mod', locked: true, equip: true,
    mod: {
      /*
       * 注意引擎的调用签名是 damageModify(num, ev, owner)；不是 (player, num, ctx)。
       * 「每回合首张被使用的红色牌」用 owner.flags 记录，flags 每回合自动清空。
       *
       * 只减「打到装备者身上」的伤害。引擎会把装备技分别以 target / source 两种角色
       * 收进候选（他人打你、你打别人都会轮到它），所以这里必须自己卡住：
       * 需求方 m08271 指出，原来没卡条件，导致自己使用红牌造成的伤害也被 -1。
       */
      damageModify: (num, ev, owner) => {
        if (!ev || !owner) return num;
        if (ev.player !== owner) return num;      // 只有自己挨打才减
        if (!ev.card || ev.card.color !== 'red') return num;
        if (owner.flags && owner.flags.hanreUsed) return num;
        owner.flags = owner.flags || {};
        owner.flags.hanreUsed = true;
        return Math.max(0, num - 1);
      },
    },
  },

  /* ============================== 虹彩 ============================== */
  tongbao_hongcai_skill: {
    id: 'tongbao_hongcai_skill', name: '虹彩',
    desc: '锁定技，你成为过所有颜色的牌的目标的回合结束后，你摸两张牌。',
    type: 'trigger', trigger: 'turnEnd', equip: true,
    filter: (ctx) => {
      const seen = ctx.player.flags.hongcaiColors || [];
      return seen.includes('red') && seen.includes('black');
    },
    async content(ctx) {
      await ctx.player.draw(2);
      ctx.player.flags.hongcaiColors = [];
      ctx.game.log(`【虹彩】${ctx.player.name} 已集齐两色目标，回合结束摸两张牌`);
    },
  },

  /* ============================ 武人之争 ============================ */
  tongbao_wuren_skill: {
    id: 'tongbao_wuren_skill', name: '武人之争',
    desc: '你使用【杀】结算后，可进行一次判定：红色，本回合你的伤害类牌造成的伤害 +1；'
      + '黑色，本回合你造成的伤害视为流失体力。',
    type: 'trigger', trigger: 'cardUsedAfter', equip: true,
    filter: (ctx) => ctx.event.card && ctx.event.card.name === 'sha',
    async content(ctx) {
      const { game, player } = ctx;
      const j = await game.doJudge(player, '武人之争');
      if (j.color === 'red') {
        player.flags.wurenBonus = true;
        game.log(`【武人之争】判定为红色，本回合${player.name}的伤害类牌伤害 +1`);
      } else {
        player.flags.wurenLoseHp = true;
        game.log(`【武人之争】判定为黑色，本回合${player.name}造成的伤害视为流失体力`);
      }
    },
  },

  /* ============================ 百业俱兴 ============================ */
  tongbao_baiye_skill: {
    id: 'tongbao_baiye_skill', name: '百业俱兴',
    desc: '锁定技，你的防御距离 +1；若你有防御马，每回合你首次成为伤害类牌的目标结算后，你摸一张牌。',
    type: 'mod', locked: true, equip: true,
    mod: {
      /** 防御距离 +1（等同 +1 马） */
      defenseDistance: () => 1,
    },
  },

  /* ============================== 战血流 ============================== */
  tongbao_zhanxue_skill: {
    id: 'tongbao_zhanxue_skill', name: '战血流',
    desc: '锁定技，你的手牌上限 -1；你成为牌的目标时，使用者本回合的手牌上限 -1。',
    type: 'mod', locked: true, equip: true,
    mod: {
      handLimit: (player, limit) => limit - 1,
    },
  },

  /* ============================== 一字落 ============================== */
  tongbao_yizi_skill: {
    id: 'tongbao_yizi_skill', name: '一字落',
    desc: '锁定技，你不能于摸牌阶段外获得牌；你的摸牌阶段不会被跳过且额定摸牌数 +2。',
    type: 'mod', locked: true, equip: true,
    mod: {
      /** 摸牌阶段额定摸牌数 +2 */
      drawPhaseCount: (player, n) => n + 2,
      /** 摸牌阶段外不能获得牌 */
      noGainOutsideDrawPhase: () => true,
    },
  },

  /* ============================ 百灶盛景 ============================ */
  tongbao_baizao_skill: {
    id: 'tongbao_baizao_skill', name: '百灶盛景',
    desc: '每回合你首次不因此牌的效果失去牌后，扣置于该牌上；此牌离开你的装备区时，'
      + '你摸两倍扣置牌种类数量的牌。轮次技，你可移去一张扣置牌以视为使用或打出之。',
    type: 'trigger', trigger: 'loseCards', equip: true,
    filter: (ctx) => !ctx.player.flags.baizaoThisTurn,
    async content(ctx) {
      const { game, player } = ctx;
      const card = Object.values(player.equips).find((c) => c && c.name === 'baizaoshengjing');
      if (!card) return;
      // 记一张「虚拟扣置」，用数量表示；种类按被失去的牌统计
      player.flags.baizaoThisTurn = true;
      const lost = (ctx.event && ctx.event.cards) || [];
      card._baizaoKinds = card._baizaoKinds || new Set();
      for (const c of lost) card._baizaoKinds.add((c && c.name) || 'unknown');
      game.log(`【百灶盛景】${player.name} 首次失去牌，扣置于【百灶盛景】`
        + `（已记 ${card._baizaoKinds.size} 种）`);
    },
  },

  /* ============================ 诡异代币 ============================ */
  tongbao_guiji_skill: {
    id: 'tongbao_guiji_skill', name: '诡异代币',
    desc: '锁定技，此牌进入/离开你的装备区时你摸/弃两张牌；你造成的伤害不会被减少。',
    type: 'mod', locked: true, equip: true,
    mod: {
      /** 造成的伤害不能被减少 */
      noDamageReduce: () => true,
    },
  },
};
