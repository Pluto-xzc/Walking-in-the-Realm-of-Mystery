/**
 * 装备技
 * ------------------------------------------------------------------
 * 武器的 attackRange / 坐骑的距离修正写在 src/cards.js 的牌定义上；
 * 这里只放「装备在场时才生效的技能」。
 *
 * 约定：
 *   - type: 'mod'    纯被动，用 mod 钩子（immunity / damageModify / ...）
 *   - type: 'trigger' 由引擎在指定时机询问（condition + content）
 *   - type: 'active'  玩家主动点按钮发动
 *   - equip: true     表示「必须装备着这张牌才生效」
 */

/** 该角色是否装备了拥有某个 equipSkill 的牌 */
const hasEquipSkill = (player, sid) => Object.values(player.equips)
  .filter(Boolean)
  .some((c) => c.equipSkillOf && c.equipSkillOf === sid);

export default {
  /* ============================== 武器 ============================== */
  zhuge_skill: {
    id: 'zhuge_skill', name: '诸葛连弩',
    desc: '出牌阶段，你可以使用任意数量的【杀】。',
    type: 'mod', equip: true,
    mod: { shaUnlimited: () => true },
  },

  qinggang_skill: {
    id: 'qinggang_skill', name: '青釭剑',
    desc: '锁定技，你的【杀】无视目标的防具、护甲与技能。',
    type: 'mod', locked: true, equip: true,
    mod: {
      ignoreArmor: () => true,
      /** 目标的防具技（八卦阵等）不生效；精银甲声明自己不可被无视 */
      ignoreArmorSkills: () => true,
    },
  },

  cixiong_skill: {
    id: 'cixiong_skill', name: '雌雄双股剑',
    desc: '当你使用【杀】指定一名与你性别不同的角色为目标后，'
      + '你可以令其弃置一张手牌，然后你摸一张牌。',
    type: 'trigger', trigger: 'targetConfirm', equip: true,
    filter: (ctx) => ctx.event.card && ctx.event.card.name === 'sha'
      && ctx.event.target && ctx.event.target.sex !== ctx.player.sex,
    async content(ctx) {
      const target = ctx.event.target;
      if (target.countCards('h') > 0) {
        await target.discardCards(1, 'h', '雌雄双股剑：弃置一张手牌');
      }
      await ctx.player.draw(1);
      ctx.game.log(`【雌雄双股剑】${ctx.player.name} 令 ${target.name} 弃牌，然后摸一张牌`);
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
    desc: '你可以将两张牌当作【杀】使用或打出；'
      + '用两张类型相同的牌转化的【杀】造成的伤害 +1。',
    type: 'active', equip: true,
    filter: (ctx) => ctx.game.isInPlayPhase(ctx.player) && ctx.player.countCards('h') >= 2,
    async content(ctx) {
      const p = ctx.player;
      const game = ctx.game;
      const picked = await p.chooseCards({
        prompt: '丈八蛇矛：选择两张手牌当作【杀】使用',
        position: 'h', min: 2, max: 2, cancelable: true,
      });
      if (!picked || picked.length < 2) return;
      const sameType = picked[0].type === picked[1].type;
      const ghost = game.makeVirtualCard({
        name: 'sha',
        sourceCards: picked.slice(),
        fullname: '杀',
      });
      ghost.zhangbaBonus = sameType;
      if (sameType) game.log(`【丈八蛇矛】两张牌类型相同，此【杀】伤害 +1`);
      await game.useCard(p, ghost, null);
    },
    mod: {
      damageModify: (num, ev, owner, role) => {
        if (role !== 'source') return num;
        return ev.card && ev.card.zhangbaBonus ? num + 1 : num;
      },
    },
  },

  guanshi_skill: {
    id: 'guanshi_skill', name: '贯石斧',
    desc: '你使用的【杀】被抵消时，你可以熔铸两张牌，令此【杀】依然造成伤害。',
    type: 'trigger', trigger: 'shaDodged', equip: true,
    filter: (ctx) => ctx.player.countCards('he') >= 2,
    async content(ctx) {
      const res = await ctx.player.discardCards(2, 'he', '贯石斧：熔铸两张牌');
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
    desc: '当你使用【杀】对目标角色造成伤害时，可以弃置其装备区里的一张牌。',
    type: 'trigger', trigger: 'damageEnd', equip: true,
    filter: (ctx) => ctx.event.source === ctx.player && ctx.event.card
      && ctx.event.card.name === 'sha' && ctx.event.player
      && ctx.event.player !== ctx.player && ctx.event.player.countCards('e') > 0,
    async content(ctx) {
      const t = ctx.event.player;
      const equips = t.getCards('e');
      if (!equips.length) return;
      const c = await ctx.player.chooseCardFromList(equips, '麒麟弓：弃置目标一张装备牌');
      if (c) await t.loseCards([c]);
    },
  },

  hanbing_skill: {
    id: 'hanbing_skill', name: '寒冰剑',
    desc: '你使用【杀】造成伤害时，可以防止此伤害，改为弃置目标两张牌。',
    type: 'trigger', trigger: 'damageBegin', equip: true,
    filter: (ctx) => ctx.event.source === ctx.player && ctx.event.card
      && ctx.event.card.name === 'sha' && ctx.event.player
      && ctx.event.player.countCards('he') >= 2,
    async content(ctx) {
      ctx.event.prevented = true;
      await ctx.event.player.discardCards(2, 'he', '寒冰剑');
    },
  },

  zhuque_skill: {
    id: 'zhuque_skill', name: '朱雀羽扇',
    desc: '当你使用【杀】时，你可以将此【杀】改为火【杀】或雷【杀】。',
    type: 'mod', equip: true,
    mod: { elementShaOptions: () => ['fire', 'thunder'] },
  },

  guding_skill: {
    id: 'guding_skill', name: '古锭刀',
    desc: '锁定技，当你使用【杀】对目标角色造成伤害时，'
      + '若该角色没有手牌或装备牌，此伤害 +1。',
    type: 'mod', locked: true, equip: true,
    mod: {
      damageModify: (num, ev, owner, role) => {
        if (role !== 'source') return num;
        if (!ev.card || ev.card.name !== 'sha') return num;
        const t = ev.player;
        if (t && (t.countCards('h') === 0 || t.countCards('e') === 0)) return num + 1;
        return num;
      },
    },
  },

  yitian_skill: {
    id: 'yitian_skill', name: '倚天剑',
    desc: '当你使用【杀】造成伤害后，你可以弃置一张手牌并回复 1 点体力；'
      + '或重铸一张牌，获得 1 点护甲。',
    type: 'trigger', trigger: 'damageEnd', equip: true,
    filter: (ctx) => ctx.event.source === ctx.player && ctx.event.card
      && ctx.event.card.name === 'sha' && ctx.event.player !== ctx.player,
    async content(ctx) {
      const p = ctx.player;
      const choice = await p.chooseOption({
        prompt: '【倚天剑】：选择一项',
        options: [
          { key: 'heal', label: '弃置一张手牌，回复 1 点体力' },
          { key: 'armor', label: '重铸一张牌，获得 1 点护甲' },
          { key: 'skip', label: '不发动' },
        ],
        cancelable: true,
      });
      if (choice === 'heal' && p.countCards('h') > 0) {
        await p.discardCards(1, 'h', '倚天剑：弃置一张手牌');
        await p.recover(1);
      } else if (choice === 'armor' && p.countCards('he') > 0) {
        const picked = await p.chooseCards({
          prompt: '倚天剑：重铸一张牌', position: 'he', min: 1, max: 1, cancelable: true,
        });
        if (picked && picked.length) {
          await p.discard(picked);
          await p.draw(1);
          await p.changeHujia(1);
          ctx.game.log(`【倚天剑】${p.name} 重铸一张牌，获得 1 点护甲`);
        }
      }
    },
  },

  /* ============================== 防具 ============================== */
  bagua_skill: {
    id: 'bagua_skill', name: '八卦阵',
    desc: '当你需要使用或打出【闪】时，你可以进行判定：若结果为红色，'
      + '视为你使用或打出一张【闪】；若结果为红桃或黑桃，你获得判定牌。',
    type: 'trigger', trigger: 'askForShan', equip: true,
    async content(ctx) {
      const judge = await ctx.player.judge('bagua');
      if (judge.suit === 'heart' || judge.suit === 'spade') {
        const card = judge.card;
        const i = ctx.game.discardPile.indexOf(card);
        if (i >= 0) ctx.game.discardPile.splice(i, 1);
        card.zone = 'hand';
        await ctx.player.gain([card]);
        ctx.game.log(`【八卦阵】${ctx.player.name} 获得判定牌 ${card.text}`);
      }
      if (judge.color === 'red') {
        ctx.event.baguaShan = true;
        return true;
      }
      return false;
    },
  },

  renwang_skill: {
    id: 'renwang_skill', name: '仁王盾',
    desc: '锁定技，黑色的【杀】对你无效。轮次技，你成为黑色锦囊牌的目标时，'
      + '可以令之对你无效。',
    type: 'mod', locked: true, equip: true,
    mod: {
      immunity: (card) => card.name === 'sha' && card.color === 'black',
      /** 轮次技：黑色锦囊每轮第一次 */
      trickImmunity: (card, owner) => {
        if (!card || card.type !== 'trick' || card.color !== 'black') return false;
        const used = owner.flags && owner.flags.renwangTrickRound;
        const round = owner.game && owner.game.roundCount;
        if (used === round) return false;
        if (owner.flags) owner.flags.renwangTrickRound = round;
        return true;
      },
    },
  },

  tengjia_skill: {
    id: 'tengjia_skill', name: '藤甲',
    desc: '锁定技，【南蛮入侵】、【万箭齐发】和普通【杀】对你无效；'
      + '当你受到火焰伤害时，伤害值 +1，然后你可以弃置此牌并摸一张牌。',
    type: 'mod', locked: true, equip: true,
    mod: {
      immunity: (card) => ['nanman', 'wanjian'].includes(card.name)
        || (card.name === 'sha' && !card.nature && !card.cisha),

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

  jingyin_skill: {
    id: 'jingyin_skill', name: '精银甲',
    desc: '你可以将一张手牌当【闪】打出；你打出非转化的【闪】时摸一张牌。'
      + '此技能不会被无效，也不能被无视。',
    type: 'mod', equip: true,
    mod: {
      /** 青釭剑等「无视防具技」的效果对本技能无效 */
      armorSkillUnignorable: () => true,
    },
  },

  huxinjing_skill: {
    id: 'huxinjing_skill', name: '护心镜',
    desc: '当你受到致命伤害或大于 1 点的伤害时，你可以弃置此牌防止之，'
      + '然后摸伤害值张牌。',
    type: 'trigger', trigger: 'damageBegin', equip: true,
    filter: (ctx) => {
      const num = ctx.event.num || 0;
      if (num <= 1) return false;
      const t = ctx.event.player;
      return !!t && t.alive;
    },
    async content(ctx) {
      const t = ctx.event.player;
      const num = ctx.event.num || 0;
      const armor = t.equips.equip2;
      if (!armor || armor.name !== 'huxinjing') return false;
      await t.loseCards([armor]);
      t.equips.equip2 = null;
      ctx.event.prevented = true;
      ctx.game.log(`【护心镜】${t.name} 弃置护心镜，防止了这次伤害`);
      await t.draw(num);
      return true;
    },
  },

  /* ============================== 宝物 ============================== */
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

  tianji_skill: {
    id: 'tianji_skill', name: '天机图',
    desc: '锁定技，此牌进入你的装备区时，你弃置一张其他牌；'
      + '此牌离开你的装备区时，你将手牌摸至七张。',
    type: 'mod', locked: true, equip: true,
  },

  baiyin_skill: {
    id: 'baiyin_skill', name: '白银狮子',
    desc: '锁定技，当你受到伤害时，若此伤害大于 1，防止多余伤害。'
      + '当你失去装备区里的【白银狮子】时，回复 1 点体力并摸一张牌。',
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
};

export { hasEquipSkill };
