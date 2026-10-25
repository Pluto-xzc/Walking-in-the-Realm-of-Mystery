/**
 * 核心引擎 · Game 方法集 · 伤害 / 濒死 / 死亡 / 判定
 * ------------------------------------------------------------------
 * 由 src/engine.js 拆分而来。伤害分层结算、濒死求桃、死亡与胜负、判定与拼点。
 * 本文件导出普通对象字面量，方法会被混入 Game.prototype，内部 this 即 Game 实例。
 */

import { CARDS, makeEmptyEquips } from '../cards.js';
import { SKILLS } from '../skills.js';
import { flushExcludedOnDeath, triggerFailedSave, markMoDamaged, noteHpChange, isHidden, exitHidden, cannotRespond, clearOccupyOnDeath } from '../mechanics.js';
import { ZONE, IDENTITY_NAME } from './zones.js';

export default {
async doDamage(target, num, source, skill, card, nature = null) {
  if (!target.alive || this.over) return null;

  /*
   * 【隐匿】「受到伤害时**防止那次伤害**后登场」
   * ----------------------------------------------------------------
   * 需求方/无名杀规则：隐匿角色受到伤害时，
   * **先防止该次伤害**，然后登场（恢复可见）。
   * 因此这里在伤害结算最前面拦截。
   */
  if (isHidden(target)) {
    this.log(`${target.name} 处于隐匿状态，防止了这次 ${num} 点伤害并登场`);
    await exitHidden(target);
    this.emit();
    // 返回一个「已防止」的事件对象，保持调用方语义一致
    return {
      player: target, source, num: 0, prevented: true,
      hiddenRevealed: true, hpLoss: 0,
    };
  }

  // 属性来源：显式传入 > 牌的属性 > 无
  const dmgNature = nature || (card && card.nature) || null;

  const ev = {
    player: target, source, num: Math.max(0, num), skill, card,
    cards: card ? [card] : [], nature: dmgNature,
    prevented: false,
    baseNum: Math.max(0, num),   // 未经任何修改的原始伤害
  };

  // 免疫检查
  if (card) {
    const immune = this.isImmune(target, card);
    if (immune) {
      this.log(`${target.name} 因装备效果免疫了【${card.fullname}】`);
      return ev;
    }
  }

  /* ============================================================
   * 伤害数值修改 —— 三级优先级
   * ============================================================
   * 顺序**不可调换**，否则结果会错。设计意图：
   *
   *   第一级 damageModify —— 增减伤
   *     最基础的加减，如藤甲火焰+1、酒+1、古锭刀+1、裸衣+1。
   *     未来武将的「伤害+1 / 伤害-1」也属于这一级。
   *
   *   第二级 finalDamageModify —— 最终伤害修改
   *     在所有增减伤算完之后，对「最终结果」做整体改写。
   *     如「此伤害改为 2」「伤害翻倍」这类效果。
   *
   *   第三级 finalDamage —— 特殊裁定（白银狮子）
   *     **永远最后执行**，看到的是经过前两级修改后的最终数字，
   *     再自己判断要不要动手（如「大于 1 则减为 1」）。
   *
   * 为什么要这样分：白银狮子的规则是「无论对方怎么增伤减伤，
   * 最后到我这儿的伤害如果超过 1，就只受 1」。如果它先于增减伤
   * 执行，后面再被加上去就失去意义了。
   * ============================================================ */

  // ---------- 第一级：增减伤 ----------
  await this.applyDamageModify(ev);

  // damageBegin 时机（技能可在此 prevent 或继续改数值）
  await this.checkSkills('damageBegin', ev);
  if (ev.prevented) { this.emit(); return ev; }
  ev.num = Math.max(0, ev.num);
  if (ev.num === 0) { this.emit(); return ev; }

  // ---------- 第二级：最终伤害修改 ----------
  await this.applyFinalDamageModify(ev);
  ev.num = Math.max(0, ev.num);
  if (ev.num === 0) { this.emit(); return ev; }

  // ---------- 第三级：特殊裁定（白银狮子等），永远最后 ----------
  await this.applyFinalDamage(ev);
  ev.num = Math.max(0, ev.num);
  if (ev.num === 0) { this.emit(); return ev; }

  // 铁索连环：记录本次属性伤害，随后传导给其他横置角色
  const chainTargets = [];
  if (dmgNature && target.isChained) {
    target.isChained = false;      // 传导后重置
    for (const p of this.players) {
      if (p !== target && p.alive && p.isChained) chainTargets.push(p);
    }
  }

  /* ============================================================
   * 护甲抵扣（参考无名杀 hujia）
   * ============================================================
   * 位置：在伤害数值全部修改完成之后、扣体力之前。
   *
   * 无名杀规则原文：「和体力类似，每点护甲可抵挡1点伤害，
   * 但不影响手牌上限。」
   *
   * 抵挡量 = min(最终伤害, 当前护甲)
   * 护甲 -= 抵挡量；实际扣血 = 伤害 - 抵挡量
   *
   * 与白银狮子的区别：白银狮子改的是伤害**数值**（第三级管线），
   * 护甲是在数值确定之后做的**抵扣**，属于更靠后的一步。
   * 所以「护甲 3 挨 5 点伤害」= 护甲挡住 3 点，实际掉 2 点体力。
   * ============================================================ */
  let hpLoss = ev.num;
  if (target.hujia > 0 && ev.num > 0 && !target.hasSkill('nohujia')) {
    const blocked = Math.min(ev.num, target.hujia);
    target.hujia -= blocked;
    hpLoss = ev.num - blocked;
    ev.hujiaBlocked = blocked;      // 供后续技能读取
    this.log(`${target.name} 的护甲抵挡了 ${blocked} 点伤害（剩余护甲 ${target.hujia}）`);
  }

  /* ============================================================
   * 「空上限视为护甲」机制（本项目自定义，无无名杀对应）
   * ============================================================
   * 持有该机制的角色（通常是锁定技效果），其「空掉的体力上限」
   * 即 `maxHp - hp` 会像护甲一样优先吸收伤害。
   *
   * 规则：
   *   吸收量 = min(剩余伤害, maxHp - hp)
   *   只扣减 hp 的那部分才真正掉血；被吸收的部分
   *   **既不增加护甲、也不改变 maxHp**。
   *
   * 因此 maxHp 与 hujia 在此机制下始终不变：
   *   4/4 挨 3 点 → 空上限为 0，全额掉血 → 1/4（空上限变为 3）
   *   1/4 再挨 2 点 → 空上限 3 吸收全部 2 点 → 仍是 1/4
   *
   * 与护甲的顺序：真实护甲先扣（它是实打实的资源），
   * 之后才动用「空上限」。两者都不影响手牌上限。
   *
   * 注意：只用 maxHp - hp，不碰 maxHp 本身；回血照常受
   * maxHp 限制，被当作护甲用掉的空上限不会自动回来。
   * ============================================================ */
  let headroomAbsorbed = 0;
  if (hpLoss > 0 && target.hasSkill('voidhp_armor')) {
    const headroom = Math.max(0, target.maxHp - target.hp);
    if (headroom > 0) {
      headroomAbsorbed = Math.min(hpLoss, headroom);
      hpLoss -= headroomAbsorbed;
      ev.headroomBlocked = headroomAbsorbed;   // 供后续技能与测试读取
      ev.headroomBefore = headroom;
      this.log(`${target.name} 以空余体力上限抵当了 ${headroomAbsorbed} 点伤害`
        + `（空上限 ${headroom - headroomAbsorbed}）`);
    }
  }
  ev.hpLoss = hpLoss;   // 实际扣减的体力（供技能/测试读取）

  /*
   * 【入魔】的伤害统计
   * ----------------------------------------------------------------
   * 规则：「每轮结束时，若本轮你未造成过伤害，你失去 1 点体力。」
   * 因此只要来源确实造成了伤害（hpLoss>0），就记一笔。
   */
  if (source && hpLoss > 0) markMoDamaged(source);

  // 【体力变化】记录（受到伤害）
  const hpBeforeDamage = target.hp;
  target.hp -= hpLoss;
  if (hpLoss > 0) noteHpChange(this, target, 'damage', hpLoss, hpBeforeDamage);
  const natureText = dmgNature === 'fire' ? '火焰' : dmgNature === 'thunder' ? '雷电' : '';
  if (hpLoss > 0) {
    this.log(`${target.name} 受到 ${hpLoss} 点${natureText}伤害（${target.hp}/${target.maxHp}）${source ? `，来源：${source.name}` : ''}`);
  } else if (headroomAbsorbed > 0) {
    this.log(`${target.name} 的空余体力上限完全抵当了这次伤害（${target.hp}/${target.maxHp}）`);
  } else {
    this.log(`${target.name} 的护甲完全抵挡了这次伤害`);
  }
  this.emit();

  await this.checkSkills('damageEnd', ev);

  /*
   * 【同一结算】的延迟处理
   * ----------------------------------------------------------------
   * 需求方给定（白金磷子【前行的决心】）：
   *   「连用 3 张【南蛮】打郭嘉 3 血，他的濒死结算和技能的摸牌
   *     都得等『前行的决心』**完全结算后**才能进行结算」
   *   「血量照常扣，只是不立即走濒死流程」
   *
   * 因此在「同一结算」块内（_deferDepth > 0）时，
   * 把濒死 **排队**而不是立即结算，由块结束时统一依次处理。
   */
  if (target.hp <= 0) {
    if (this._deferDepth > 0) {
      this._deferred = this._deferred || [];
      this._deferred.push({ kind: 'dying', player: target, source });
      this.log(`${target.name} 进入濒死（因「同一结算」暂缓处理）`);
    } else {
      await this.enterDying(target, source);
    }
  }

  // 铁索连环：把本次属性伤害传导给其他横置角色
  // 注意：传导产生的伤害本身也是同属性，会继续链式传导（由递归自然完成）
  if (chainTargets.length) {
    const forwarded = chainTargets.slice();
    this.log(`${target.name} 受到属性伤害，铁索连环传导至 `
      + forwarded.map((p) => p.name).join('、'));
    for (const p of forwarded) {
      if (!p.alive) continue;
      await this.doDamage(p, ev.num, source, 'tiesuo', null, dmgNature);
    }
  }
  return ev;
},

collectDamageSkills(target, source) {
  const out = [];
  /**
   * 收集时**必须记录归属关系**，因为不同级别的技能作用对象不同：
   *   - 受伤者的技能 → 影响「他受到的伤害」
   *   - 来源的技能   → 影响「他造成的伤害」
   *
   * 历史坑：早期版本只 push({skill, owner}) 不区分角色，
   * 导致「自己装着白银狮子去打别人」时，白银狮子错误地
   * 把**别人**受到的伤害压成了 1。
   *
   * role 取值：
   *   'target' 受伤者（装备技 + 武将技）
   *   'source' 伤害来源（装备技 + 武将技）
   *   'global' 全场其他角色（光环类）
   */
  const push = (owner, sk, role) => {
    if (sk && sk.mod) out.push({ skill: sk, owner, role });
  };

  // 受伤者的装备技能 + 武将技能
  if (target) {
    for (const c of Object.values(target.equips).filter(Boolean)) {
      const esid = CARDS[c.name] && CARDS[c.name].equipSkill;
      if (esid) push(target, SKILLS[esid], 'target');
    }
    for (const sid of target.skills) push(target, SKILLS[sid], 'target');
  }

  // 伤害来源的装备技能 + 武将技能
  if (source && source !== target) {
    for (const c of Object.values(source.equips).filter(Boolean)) {
      const esid = CARDS[c.name] && CARDS[c.name].equipSkill;
      if (esid) push(source, SKILLS[esid], 'source');
    }
    for (const sid of source.skills) push(source, SKILLS[sid], 'source');
  }

  // 全场其他角色（光环类增减伤）
  for (const p of this.players) {
    if (p === target || p === source || !p.alive) continue;
    for (const sid of p.skills) {
      const sk = SKILLS[sid];
      if (sk && sk.mod && (sk.mod.damageModify || sk.mod.finalDamage
        || sk.mod.finalDamageModify)) {
        push(p, sk, 'global');
      }
    }
  }
  return out;
},

async applyDamageModify(ev) {
  const target = ev.player;
  const source = ev.source;

  // 只有「受伤者」和「来源」的技能能改这次伤害的数值；
  // 全场光环类也允许，但它们必须自己判断是否该生效。
  for (const { skill, owner, role } of this.collectDamageSkills(target, source)) {
    const mod = skill.mod;

    // 新写法（推荐）—— 把所有者的角色信息一并传入，技能可自行判断
    if (typeof mod.damageModify === 'function') {
      try {
        const r = mod.damageModify(ev.num, ev, owner, role);
        if (typeof r === 'number') {
          if (r !== ev.num) {
            this.log(`【${skill.name}】使伤害 ${ev.num} → ${r}`);
          }
          ev.num = r;
        }
      } catch (e) { this._warnMod(skill, e); }
    }

    // 兼容旧写法：受伤者装备的 damageTaken（只在 owner 是受伤者时执行）
    if (role === 'target' && typeof mod.damageTaken === 'function') {
      try {
        const r = mod.damageTaken(ev.num, ev.card, ev.nature);
        if (typeof r === 'number' && r !== ev.num) {
          this.log(`【${skill.name}】使伤害 ${ev.num} → ${r}`);
          ev.num = r;
        }
      } catch (e) { this._warnMod(skill, e); }
    }

    // 兼容旧写法：来源的 damageFromSha（只在 owner 是来源时执行）
    if (role === 'source' && typeof mod.damageFromSha === 'function'
      && ev.card && ev.card.name === 'sha') {
      try {
        const r = mod.damageFromSha(ev.num, ev.card, target);
        if (typeof r === 'number' && r !== ev.num) {
          this.log(`【${skill.name}】使伤害 ${ev.num} → ${r}`);
          ev.num = r;
        }
      } catch (e) { this._warnMod(skill, e); }
    }
  }

  // 裸衣（旧式 flag，保留兼容）
  if (source && source.hasFlag('luoyi') === this.turnCount && ev.card
    && (ev.card.name === 'sha' || ev.card.name === 'juedou')) {
    ev.num += 1;
    this.log(`${source.name} 的【裸衣】使伤害 +1`);
  }

  // 【酒】：本回合下一张【杀】伤害 +1
  // 只认「本回合产生的、且尚未用掉」的酒意（jiuActive 会校验回合）
  if (source && ev.card && ev.card.name === 'sha' && this.jiuActive(source)) {
    ev.num += source.storage.jiu;
    this.log(`${source.name} 的【酒】生效，伤害 +${source.storage.jiu}`);
    // 用掉即清除（带 jiuSustain 的角色会保留，交由扩展武将决定）
    this.clearJiu(source);
  }
},

async applyFinalDamageModify(ev) {
  for (const { skill, owner, role } of this.collectDamageSkills(ev.player, ev.source)) {
    const mod = skill.mod;
    if (typeof mod.finalDamageModify !== 'function') continue;
    // 最终修改也是「影响这次伤害」的效果，同样只允许
    // 受伤者 / 来源 / 光环 三类参与（role 信息传给技能自行判断）
    try {
      const r = mod.finalDamageModify(ev.num, ev, owner, role);
      if (typeof r === 'number' && r !== ev.num) {
        this.log(`【${skill.name}】使伤害 ${ev.num} → ${r}`);
        ev.num = r;
      }
    } catch (e) { this._warnMod(skill, e); }
  }
},

async applyFinalDamage(ev) {
  for (const { skill, owner, role } of this.collectDamageSkills(ev.player, ev.source)) {
    // ⚠️ 只处理「受伤者自己」的技能，来源/光环一律跳过
    if (role !== 'target') continue;
    const mod = skill.mod;
    if (typeof mod.finalDamage !== 'function') continue;
    try {
      const before = ev.num;
      const r = mod.finalDamage(ev.num, ev, owner, role);
      if (typeof r === 'number' && r !== before) {
        this.log(`${owner.name} 的【${skill.name}】使伤害 ${before} → ${r}`);
        ev.num = r;
      }
    } catch (e) { this._warnMod(skill, e); }
  }
},

_warnMod(skill, err) {
  const msg = `技能【${skill && skill.name}】的伤害修改出错：${err && err.message}`;
  this.log(msg);
  if (typeof console !== 'undefined' && console.warn) console.warn(msg, err);
},

async checkBaiyinLose(player, card) {
  if (!card || card.name !== 'baiyin') return;
  const def = CARDS.baiyin;
  if (!def || def.equipSkill !== 'baiyin_skill') return;
  if (!player.alive) return;
  if (player.hp >= player.maxHp) {
    this.log(`${player.name} 失去【白银狮子】，但体力已满`);
    return;
  }
  player.hp += 1;
  this.log(`${player.name} 失去【白银狮子】，回复 1 点体力（${player.hp}/${player.maxHp}）`);
  this.emit();
},

isImmune(player, card) {
  for (const c of Object.values(player.equips).filter(Boolean)) {
    const esid = CARDS[c.name] && CARDS[c.name].equipSkill;
    const sk = esid && SKILLS[esid];
    if (sk && sk.mod && sk.mod.immunity) {
      try { if (sk.mod.immunity(card)) return true; } catch { /* 忽略 */ }
    }
  }
  return false;
},

async loseHpWithoutDying(player, num = 1) {
  if (!player || !player.alive) return false;
  player.hp -= num;
  this.log(`${player.name} 失去了 ${num} 点体力（${player.hp}/${player.maxHp}）`);
  this.emit();
  return player.hp <= 0;
},

async enterDying(player, source) {
  if (this.over) return;
  this.log(`${player.name} 濒死！`);
  this.emit();

  let guard = 0;
  while (player.hp <= 0 && guard++ < 20) {
    let saved = false;
    // 自己先用桃
    const order = [player, ...this.players.filter((p) => p !== player && p.alive)];
    for (const p of order) {
      if (player.hp > 0) break;
      /*
       * 【跳过牌的询问】：被跳过者**不能在其他角色求桃时使用牌**
       * （需求方给定的第二重后果）
       */
      if (p !== player && cannotRespond(p)) {
        this.log(`${p.name} 被跳过了牌的询问，不能在他人求桃时使用牌`);
        continue;
      }
      // 找出可用的桃（含急救）
      let taoCards = p.getCards('he', (c) => c.name === 'tao');
      let viaSkill = null;
      if (!taoCards.length && p.hasSkill('jijiu')) {
        taoCards = p.getCards('he', (c) => c.color === 'red');
        viaSkill = 'jijiu';
      }
      if (!taoCards.length) continue;

      let use = false;
      if (p.isHuman) {
        const answers = await this.io.confirmDying(p, player, viaSkill, taoCards.length);
        use = answers;
      } else {
        // AI：队友濒死则救
        use = this.ai.shouldSave(p, player);
      }
      if (!use) continue;

      const card = p.isHuman
        ? (await this.io.chooseCards(p, {
          prompt: `对 ${player.name} 使用【桃】`,
          position: 'he', min: 1, max: 1,
          filter: (c) => (viaSkill ? c.color === 'red' : c.name === 'tao'),
          cancelable: true,
        })) || []
        : [taoCards[0]];
      if (!card.length) continue;

      await p.loseCards(card);
      this.toDiscard(...card);
      const heal = (p.isZhu && p.hasSkill('jiuyuan') && p.group === 'wu' && p !== player) ? 2 : 1;
      player.hp += heal;
      this.log(`${p.name} 使用【桃】救助 ${player.name}${viaSkill ? '（急救）' : ''}${heal > 1 ? '（救援 +1）' : ''}`);
      this.emit();
      saved = true;
      break;
    }
    if (!saved) break;
  }

  /*
   * 【失救】时点
   * ----------------------------------------------------------------
   * 需求方给定：「你的濒死结算结束时你死亡时，此时为失救时点，
   * 部分技能可能可以恢复体力从而继续游戏。」
   *
   * 因此在这里（濒死求桃已走完、确认 hp<=0、**尚未阵亡**）
   * 触发 failedSave 时机；技能可在此时恢复体力来续命。
   */
  if (player.hp <= 0) {
    const rescued = await triggerFailedSave(this, player);
    // 被救回则重新走一次濒死确认（体力已 > 0，直接返回）
    if (rescued && player.hp > 0) {
      this.emit();
      return;
    }
  }

  if (player.hp <= 0) await this.killPlayer(player, source);
},

async killPlayer(player, source) {
  player.alive = false;
  player.hp = 0;
  // 阵亡时公开真实身份（身份模式下死者身份必须亮明）
  const wasHidden = !player.identityShown;
  player.identityShown = true;
  this.log(`${player.name} 阵亡${wasHidden ? `，身份为【${IDENTITY_NAME[player.identity] || player.identity}】` : ''}`);
  // 弃置所有牌
  // ⚠️ 必须传数组：toDiscard(cards) 只收一个参数，
  //    写成 toDiscard(...all) 只会处理第一张，其余牌会凭空消失。
  const all = player.getCards('hej');
  for (const c of all) c.zone = 'discard';
  this.toDiscard(all);
  player.hand = [];
  player.equips = makeEmptyEquips();
  player.judges = [];

  // 除外区：主人阵亡时，里面的牌全部进入弃牌堆
  // （本扩「除外」机制规则之一：牌只在主人存活期间被移出游戏）
  flushExcludedOnDeath(player);

  /*
   * 【占用】的到期清理
   * ----------------------------------------------------------------
   * 需求方给定：**未声明占用期限默认双方一人死亡**时解除。
   * 因此角色一死，他作为占用者的记录、以及他身上的占用都要清掉。
   */
  clearOccupyOnDeath(player);

  this.emit();

  // 奖惩
  if (source && source.alive) {
    if (player.identity === 'fan') {
      await source.draw(3);
      this.log(`${source.name} 击杀反贼，摸三张牌`);
    } else if (player.identity === 'zhong' && source.isZhu) {
      const others = source.getCards('hej');
      if (others.length) {
        for (const c of others) c.zone = 'discard';
        // 传数组（同上：展开只会处理第一张）
        this.toDiscard(others);
        source.hand = [];
        source.equips = makeEmptyEquips();
        source.judges = [];
        this.log(`${source.name} 误杀忠臣，弃置所有牌`);
      }
    }
  }

  this.checkGameOver();
},

checkGameOver() {
  const zhu = this.players.find((p) => p.identity === 'zhu');
  const alive = this.players.filter((p) => p.alive);
  if (!zhu || !zhu.alive) {
    const fanAlive = alive.filter((p) => p.identity === 'fan').length;
    const neiAlive = alive.filter((p) => p.identity === 'nei').length;
    if (neiAlive === 1 && alive.length === 1) {
      this.endGame('nei', '内奸');
    } else if (fanAlive > 0) {
      this.endGame('fan', '反贼');
    } else {
      this.endGame('nei', '内奸');
    }
    return;
  }
  const fanAlive = alive.filter((p) => p.identity === 'fan').length;
  const neiAlive = alive.filter((p) => p.identity === 'nei').length;
  if (fanAlive === 0 && neiAlive === 0) {
    this.endGame('zhu', '主公');
  }
},

endGame(winner, label) {
  if (this.over) return;
  this.over = true;
  this.winner = winner;
  this.winnerLabel = label;
  this.log(`游戏结束：${label}阵营胜利`);
  // 亮出所有身份
  for (const p of this.players) p.identityShown = true;
  this.emit();
},

async doJudge(player, reason) {
  const card = this.takeFromDeckTop(1)[0];
  if (!card) return { card: null, suit: null, color: null };
  const ev = { player, card, reason, replaced: false };
  this.log(`${player.name} 判定：${card.text}`);
  this.emit();

  await this.checkSkills('judgeBefore', ev);
  await this.checkSkills('judgeEnd', ev);

  // 判定牌处理
  if (card.zone === ZONE.FLYING) {
    this.toDiscard(card);
    card.zone = 'discard';
  }
  this.emit();
  return { card: ev.card, suit: ev.card.suit, color: ev.card.color, number: ev.card.number };
},

async doJuedou(p1, p2) {
  let attacker = p2;
  let defender = p1;
  let turn = 0;
  this.log(`${p1.name} 与 ${p2.name} 决斗`);
  while (turn++ < 30) {
    const need = 1;
    const res = await this.io.askShaForJuedou(defender, this);
    if (!res) {
      await defender.damage(1, attacker, 'juedou');
      return;
    }
    [attacker, defender] = [defender, attacker];
  }
},

async addJudgeCard(player, card) {
  card.zone = 'judge';
  player.judges.push(card);
  this.log(`${player.name} 的判定区放入【${card.fullname}】`);
  this.emit();
}
};
