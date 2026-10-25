/**
 * 核心引擎 · Game 方法集 · 技能时机与使用限制
 * ------------------------------------------------------------------
 * 由 src/engine.js 拆分而来。checkSkills 时机触发、技能封印、距离与目标合法性、修正器（mod）。
 * 本文件导出普通对象字面量，方法会被混入 Game.prototype，内部 this 即 Game 实例。
 */

import { CARDS } from '../cards.js';
import { SKILLS } from '../skills.js';
import { tryResetAngyang, markAngyangUsed, isDetached, checkCombo, markQidingUsed, tryZhuanYun, cannotBlockTriggerSkill } from '../mechanics.js';

export default {
skillScopeMatches(skill, owner, event) {
  if (!event) return true;
  // 技能显式声明优先
  const scope = skill.scope;
  if (scope === 'any') return true;                  // 无归属限制（罕见）
  if (scope === 'global') return true;               // 全局监听
  if (scope === 'source') return event.source === owner;
  if (scope === 'target') return event.target === owner;
  if (scope === 'player') return event.player === owner;

  // 按时机推断默认归属
  switch (skill.trigger) {
    // 受到伤害 / 濒死 → 归属为受伤者
    case 'damageEnd':
    case 'damageBegin':
    case 'dying':
      return event.player === owner;

    // 判定相关 → 归属为判定者
    case 'judgeBefore':
    case 'judgeEnd':
      return event.player === owner;

    // 回合/阶段相关 → 归属为回合主角
    case 'turnStart':
    case 'turnEnd':
    case 'drawPhaseBefore':
    case 'discardPhaseBefore':
    case 'phaseUse':
      return event.player === owner;

    // 使用牌 → 归属为使用者
    case 'cardUsed':
      return event.player === owner;

    // 打出牌 → 归属为打出者
    case 'cardResponded':
      return event.player === owner;

    // 使用或打出 → 两者都触发
    case 'cardUsedOrResponded':
      return event.player === owner;

    // 成为牌的目标 → 归属为目标
    case 'cardTargeted':
      return (event.targets || []).includes(owner);

    // 指定目标后 → 归属为【杀】的来源
    case 'targetConfirm':
      return event.source === owner;

    // 成为目标 → 归属为目标
    case 'targeted':
      return event.target === owner;

    // 【杀】被闪避 → 归属为来源
    case 'shaDodged':
      return event.source === owner || event.player === owner;

    // 失去牌 → 归属为失去者
    case 'equipLost':
    case 'handCardLost':
      return event.player === owner;

    // 摸牌结束 → 归属为摸牌者
    case 'drawEnd':
      return event.player === owner;

    /*
     * 【界乱击】结算完毕 → 归属为**使用者**
     *（「你使用【万箭齐发】结算结束后」看的是使用者自己）
     */
    case 'luanjiAfter':
      return event.player === owner;

    /*
     * 有一批牌被弃置 → 归属为**被弃置牌的原主**
     *（「你有 2 张牌被同时弃置时」）
     * 同一次弃置动作可能涉及多名角色，故逐张比对而非比对单个 event.player。
     */
    case 'cardsDiscarded':
      return (event.batch || []).some((c) => c && c._discardOwner === owner);

    // 询问响应类（护驾/激将/八卦）→ 由 content 内部自行处理
    case 'askForShan':
    case 'askForSha':
      return event.player === owner;

    default:
      return true;
  }
},

async checkSkills(timing, event) {
  for (const p of this.players) {
    if (!p.alive) continue;
    /*
     * 候选技能 = 武将技 + **装备技**
     * ----------------------------------------------------------------
     * ⚠️ 历史 bug：这里原先只遍历 p.skills（武将技能），
     *    导致装备技能（贯石斧/青龙偃月刀/麒麟弓等）**永远不会被触发**。
     *    玩家实测「装备贯石斧使用杀，对面打出闪后没触发贯石斧」即此因。
     *    装备技不在 p.skills 里，而是挂在装备牌的 equipSkill 字段上。
     */
    const sids = p.skills.slice();
    for (const c of Object.values(p.equips)) {
      if (!c) continue;
      const esid = CARDS[c.name] && CARDS[c.name].equipSkill;
      if (esid && !sids.includes(esid)) sids.push(esid);
    }
    for (const sid of sids) {
      const sk = SKILLS[sid];
      if (!sk || sk.type !== 'trigger' || sk.trigger !== timing) continue;

      // ① 归属闸门：技能拥有者必须是事件相关方
      if (!this.skillScopeMatches(sk, p, event)) continue;

      // ② 装备技：必须确实装备着对应装备
      if (sk.equip && !this.playerHasEquipSkill(p, sid)) continue;

      // ③ 「不能因此发动技能」闸门（参考无名杀 event._notrigger）
      //    注意：只有 type === 'trigger' 的技能会走到这里，
      //    永续效果（type === 'mod'，如仁王盾）根本不在本循环内，
      //    因此它们天然不受此类机制影响 —— 与无名杀一致。
      if (this.isSkillBlocked(p, sk, event)) continue;

      // ③.5 「牌无视技能」闸门：按结算阶段切断
      //     只屏蔽截止阶段及更早的触发技，之后的阶段照常。
      //     同样地，mod 类永续效果不受影响（不在本循环内）。
      if (this.isStageIgnored(event, timing)) continue;

      // ④ 技能自身的 filter
      const ctx = { player: p, game: this, event, skill: sk };
      let ok = true;
      try { ok = sk.filter ? sk.filter(ctx) : true; } catch { ok = false; }
      if (!ok) continue;

      /*
       * ④.5 【连招技】的连续性判定
       * ----------------------------------------------------------------
       * 带 comboSkill 标签的技能，要求「连续的两张牌」符合括号内条件。
       * 判定完全对照无名杀的写法：
       *   const evt = getLastUsed(player);      // 上一张使用的牌
       *   if (!evt || !evt.card) return false;
       *   return <条件(evt.card, event.card)>;
       * 见 mechanics.js 的 checkCombo / getLastUsedCard。
       */
      if (timing === 'comboCheck' || sk.comboSkill) {
        let comboOk = true;
        try {
          comboOk = checkCombo(p, event.card, sk, {
            game: this, event, timing,
          });
        } catch { comboOk = false; }
        if (!comboOk) continue;
      }

      // ⑤ 询问是否发动
      const willUse = await this.io.askSkill(p, sk, ctx);
      if (willUse) {
        this.log(`${p.name} 发动【${sk.name}】`);
        await sk.content(ctx);
        // 昂扬技：发动后进入「已用」状态
        if (sk.angyang) markAngyangUsed(p, sid);

        /*
         * 【契定技】
         * ----------------------------------------------------------------
         * 无名杀原文（`poptip.js` 的 sxrm_qidingSkill）：
         *   「发动一次后，此技能『契定技』的标签改为『锁定技』
         *     并删除技能描述中的『可以』。」
         * 因此发动成功后标记为已契定（此后按锁定技处理）。
         */
        if (sk.qidingSkill) markQidingUsed(p, sk);
      }
    }
  }
  // ⑥ 昂扬技重置检查
  //    每个技能时机结算完后，逐角色检查其昂扬技的「激昂」条件；
  //    条件成立且处于已用状态 → 重置（可反复重置多次）。
  //
  // ⑦ 韵律技转韵检查
  //    同一位置检查「转韵」条件；达成则切换韵律技当前生效的选项。
  //    （与转换技的区别：不是在发动后自动切换，而是靠条件触发）
  for (const p of this.players) {
    if (!p.alive) continue;
    tryResetAngyang(this, p, event);
    tryZhuanYun(this, p, event);
  }
  this.emit();
},

isSkillBlocked(player, skill, event) {
  if (!event) return false;
  /*
   * 【跳过技能的询问】：被跳过者**不能封锁触发类技能发动**
   * ----------------------------------------------------------------
   * 需求方给定：「技能的询问被跳过，则其不能封锁触发类技能发动」。
   * 因此「不能发动技能」类机制对这个角色**失效** ——
   * 他仍然可以正常发动触发技。
   */
  if (cannotBlockTriggerSkill(player)) {
    return false;
  }
  // 该事件上登记了「不能发动技能」的角色
  if (Array.isArray(event.noTriggerPlayers) && event.noTriggerPlayers.includes(player)) {
    return true;
  }
  // 事件被整体标记为不触发技能
  if (event.noTrigger === true) return true;
  // 角色自身被标记（如某技能令其本回合不能发动技能）
  if (player.flags && player.flags.noTriggerSkills) return true;
  return false;
},

blockSkills(event, player) {
  if (!event) return;
  if (!Array.isArray(event.noTriggerPlayers)) event.noTriggerPlayers = [];
  if (!event.noTriggerPlayers.includes(player)) event.noTriggerPlayers.push(player);
},

blockAllSkills(event) {
  if (event) event.noTrigger = true;
},

stageIndex(timing) {
  const o = this.constructor.STAGE_ORDER;
  return Object.prototype.hasOwnProperty.call(o, timing) ? o[timing] : 99;
},

ignoreSkillsUntil(event, untilStage) {
  if (!event) return;
  event.ignoreSkillsUntil = this.stageIndex(untilStage);
},

isStageIgnored(event, timing) {
  if (!event || typeof event.ignoreSkillsUntil !== 'number') return false;
  return this.stageIndex(timing) <= event.ignoreSkillsUntil;
},

playerHasEquipSkill(p, sid) {
  const eqs = Object.values(p.equips).filter(Boolean);
  return eqs.some((c) => CARDS[c.name] && CARDS[c.name].equipSkill === sid);
},

canBeTargeted(player, card) {
  if (!player || !player.alive || !card) return false;
  /*
   * 【调离】：被调离的角色**不能成为牌的目标**
   * （需求方给定规则；无名杀无此机制）
   */
  if (isDetached(player)) return false;
  // 空城：无手牌时不能成为【杀】或【决斗】的目标
  if (player.hasSkill('kongcheng') && player.countCards('h') === 0
    && (card.name === 'sha' || card.name === 'juedou')) return false;
  // 谦逊：不能成为【顺手牵羊】和【乐不思蜀】的目标
  if (player.hasSkill('qianxun')
    && (card.name === 'shunshou' || card.name === 'lebu')) return false;
  return true;
},

shaUnlimited(player) {
  if (player.hasSkill('paoxiao')) return true;
  return this.playerHasEquipSkill(player, 'zhuge_skill');
},

canUseAsFireSha(player) {
  // 装备技能
  for (const c of Object.values(player.equips).filter(Boolean)) {
    const esid = CARDS[c.name] && CARDS[c.name].equipSkill;
    const sk = esid && SKILLS[esid];
    if (sk && sk.mod && sk.mod.canUseAsFireSha && sk.mod.canUseAsFireSha(player)) {
      return true;
    }
  }
  // 武将技能
  for (const sid of player.skills) {
    const sk = SKILLS[sid];
    if (sk && sk.mod && sk.mod.canUseAsFireSha && sk.mod.canUseAsFireSha(player)) {
      return true;
    }
  }
  return false;
},

trickNoDistance(player) {
  if (player.hasSkill('qicai')) return true;
  if (player.flags && player.flags.xinghuoActive === this.turnCount) return true;
  // 通用：任意 mod 声明的 trickNoDistance
  for (const { skill } of this.collectTargetLimitSkills(player)) {
    const fn = skill.mod && skill.mod.trickNoDistance;
    if (typeof fn !== 'function') continue;
    let ok = false;
    try { ok = !!fn(player, this); } catch { ok = false; }
    if (ok) return true;
  }
  return false;
},

cardNoDistance(player, card) {
  if (!card) return false;
  if (card.type === 'trick') return this.trickNoDistance(player);
  // 【杀】：发动【星火尽染寒】的本回合无距离限制
  if (player.flags && player.flags.xinghuoActive === this.turnCount) return true;
  return false;
},

applyModFor(player, name, ...args) {
  if (!player || !player.alive) return args[args.length - 1];
  this._runMods([player], name, args);
  return args[args.length - 1];
},

applyModForPair(a, b, name, ...args) {
  const list = [];
  if (a && a.alive) list.push(a);
  if (b && b.alive && b !== a) list.push(b);
  this._runMods(list, name, args);
  return args[args.length - 1];
},

applyModGlobal(name, ...args) {
  this._runMods(this.players.filter((p) => p.alive), name, args);
  return args[args.length - 1];
},

_runMods(players, name, args) {
  for (const p of players) {
    // 武将技能
    for (const sid of p.skills) {
      const sk = SKILLS[sid];
      if (sk && sk.type === 'mod' && sk.mod && sk.mod[name]) {
        try {
          const r = sk.mod[name](...args);
          if (r !== undefined) args[args.length - 1] = r;
        } catch { /* 忽略单个技能异常 */ }
      }
    }
    // 装备技能
    for (const c of Object.values(p.equips).filter(Boolean)) {
      const esid = CARDS[c.name] && CARDS[c.name].equipSkill;
      const sk = esid && SKILLS[esid];
      if (sk && sk.mod && sk.mod[name]) {
        try {
          const r = sk.mod[name](...args);
          if (r !== undefined) args[args.length - 1] = r;
        } catch { /* 忽略 */ }
      }
    }
  }
},

playerHasModSkill(player, name) {
  for (const sid of player.skills) {
    const sk = SKILLS[sid];
    if (sk && sk.type === 'mod' && sk.mod && sk.mod[name]) return true;
  }
  for (const c of Object.values(player.equips).filter(Boolean)) {
    const esid = CARDS[c.name] && CARDS[c.name].equipSkill;
    const sk = esid && SKILLS[esid];
    if (sk && sk.mod && sk.mod[name]) return true;
  }
  return false;
}
};
