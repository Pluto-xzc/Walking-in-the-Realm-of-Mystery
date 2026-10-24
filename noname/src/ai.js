/**
 * AI 决策
 * ------------------------------------------------------------------
 * 设计原则：
 *   - 不追求最优，追求「合理且不自杀」
 *   - 基于身份推断敌对关系（attitude）
 *   - 牌的价值参考无名杀 card/standard.js 的 useful / value 数值
 *     （函数式的那几项已按其公式在本文件内重新实现，非复制代码）
 */

import { CARDS } from './cards.js';

/* ==========================================================================
 * 牌的价值表
 * --------------------------------------------------------------------------
 * 数值来源：无名杀 card/standard.js 的 ai.basic.useful / value
 *   sha       [5, 3, 1]      第 1/2/3 张【杀】的边际价值递减
 *   shan      [7, 5.1, 2]    越往后越不值钱
 *   wuxie     [6, 4, 3]
 *   taoyuan   [3, 1]
 *   nanman    [5, 1]
 *   guohe     10 / (3 + i)   第 i 张的边际价值
 *   shunshou  8 / (3 + i)
 *   wuzhong   4.5
 *   wugu      0.5            （无名杀给的确实很低）
 *   wanjian   1
 *   juedou    1
 *   jiedao    1
 *   shandian  0
 *   tao       [7, 5.1, 2] 一档（保命牌，见 taoValue）
 *
 * 说明：这些数值是「使用价值」，不是「收藏价值」。
 * 弃牌时应当保留价值高的牌，所以下方 KEEP_VALUE 另有一套。
 * ========================================================================== */

/** 无名杀风格的「第 i 张牌的边际价值」取值 */
function marginal(table, i) {
  if (i < table.length) return table[i];
  return table[table.length - 1];
}

/** 使用价值：这张牌此刻打出去值多少分（用于决定「要不要出」） */
export function useValue(card, player, game, usedCount = 0) {
  const n = card.name;
  switch (n) {
    case 'sha': return marginal([5, 3, 1], usedCount);
    case 'shan': return marginal([7, 5.1, 2], usedCount);
    case 'wuxie': return marginal([6, 4, 3], usedCount);
    case 'taoyuan': return marginal([3, 1], usedCount);
    case 'nanman': return marginal([5, 1], usedCount);
    case 'guohe': return 10 / (3 + usedCount);
    case 'shunshou': return 8 / (3 + usedCount);
    case 'juedou': return 1;
    case 'jiedao': return 1;
    case 'wanjian': return 1;
    case 'wugu': return 0.5;
    case 'wuzhong': return 4.5;
    case 'shandian': return 0;
    case 'lebu': return 3.5;
    case 'tao': return taoUseValue(card, player, game);
    /* ---------- 风林火山 ---------- */
    case 'jiu': return player.hp <= 1 ? 7.3 : 4;
    case 'huogong': return 4;
    case 'tiesuo': return 2.5;
    case 'bingliang': return 3.5;
    default:
      if (CARDS[n] && CARDS[n].type === 'equip') return equipUseValue(card, player);
      return 2;
  }
}

/**
 * 【桃】的使用价值
 * 参考无名杀：只在有人濒死/残血时才值钱，否则接近 0。
 * 越往后（手里桃越多）边际价值越低。
 */
function taoUseValue(card, player, game, i = 0) {
  const allies = game.players.filter((p) => p.alive
    && game.ai.attitude(player, p) < 0            // 友方（态度为负）
    && p.hp <= 2);
  let needs = 0, damaged = 0;
  for (const f of allies) {
    if (f.hp > 3) continue;
    if (f.hp > 1) damaged++; else needs++;
  }
  if (needs && damaged) return 5 * needs + 3 * damaged;
  if (needs) return 5 * needs;
  if (damaged) return 3 * damaged;
  // 自己残血时也该留
  if (player.hp <= 2) return 4;
  return 2 / (1 + i);
}

/** 装备的使用价值：空槽位才值得装，已有同类装备则价值很低 */
function equipUseValue(card, player) {
  const sub = CARDS[card.name].subtype;
  const cur = player.equips[sub];
  if (!cur) return 5;
  // 已有装备：只在新的更好时才值得（简单比较攻击范围/无量化则看名字）
  const curDef = CARDS[cur.name] || {};
  const newDef = CARDS[card.name] || {};
  const curRange = curDef.attackRange || 0;
  const newRange = newDef.attackRange || 0;
  if (newRange > curRange) return 3;
  return 0.5;   // 换装基本没收益
}

/* ==========================================================================
 * 保留价值：弃牌时优先丢哪些
 * 与「使用价值」不同 —— 例如【无懈可击】平时不出，但绝不该丢。
 * ========================================================================== */
export const KEEP_VALUE = {
  tao: 10, wuxie: 8.5, wuzhong: 7, shunshou: 6.5, guohe: 5.5,
  juedou: 4, nanman: 4.5, wanjian: 4.5, wugu: 3.5, taoyuan: 4,
  lebu: 4, jiedao: 3, shandian: 1,
  sha: 4, shan: 6,
  equip: 3.5,
  /* 风林火山 */
  jiu: 6, huogong: 4.5, tiesuo: 3.5, bingliang: 4.5,
};

/**
 * 【火攻】是否值得弃牌造成伤害
 * 参考无名杀：只有伤害收益为正时才弃
 */
export function shouldHuogongDiscard(self, target) {
  // 能造成击杀、或目标血量低时值得
  if (target.hp <= 1) return true;
  return target.hp <= 2;
}

/** 取一张牌的保留价值（用于弃牌与顺手牵羊选牌） */
export function keepValue(card) {
  const def = CARDS[card.name];
  if (!def) return 1;
  if (def.type === 'equip') {
    // 武器/防具比马略值钱
    const sub = def.subtype;
    if (sub === 'equip1') return 4.5;
    if (sub === 'equip2') return 4;
    return 3;
  }
  return KEEP_VALUE[card.name] !== undefined ? KEEP_VALUE[card.name] : 2;
}

export class AI {
  constructor(game) {
    this.game = game;
  }

  /** 这张牌此刻的使用价值（供外部与 decision 使用） */
  useValue(card, player, usedCount = 0) {
    return useValue(card, player, this.game, usedCount);
  }

  /** 这张牌的保留价值（弃牌时用） */
  cardValue(card) {
    return keepValue(card);
  }

  /** 【火攻】是否弃牌造成伤害 */
  shouldHuogongDiscard(player, target) {
    return shouldHuogongDiscard(player, target);
  }

  /**
   * 朱雀羽扇：是否要把这张【杀】当火【杀】使用
   * 判断依据：目标穿藤甲时绝对不要用火（会被 +1），
   * 目标被横置（铁索）时用火能传导，价值高。
   */
  wantFireSha(player, targets) {
    const t = targets && targets[0];
    if (!t) return false;
    // 目标有藤甲 → 千万别用火（火焰伤害 +1 反而害自己人）
    for (const c of Object.values(t.equips).filter(Boolean)) {
      const esid = CARDS[c.name] && CARDS[c.name].equipSkill;
      if (esid === 'tengjia_skill') return false;
    }
    // 目标横置且场上有其他横置角色 → 用火可传导
    if (t.isChained) {
      const others = this.game.players.filter((p) => p.alive && p !== t && p.isChained);
      if (others.length) return true;
    }
    return false;
  }

  /* ---------------- 敌对关系 ---------------- */
  /**
   * 对目标的敌意：>0 敌对（是该打），<0 友好（该保）
   */
  attitude(self, target) {
    if (self === target) return -100;
    if (!target || !target.alive) return 0;
    const g = this.game;
    const si = self.identity;
    const ti = target.identity;

    // 主公方视角
    const isLordSide = (id) => id === 'zhu' || id === 'zhong';
    if (self.isZhu || si === 'zhu') {
      if (ti === 'fan') return 10;
      if (ti === 'nei') return 4;
      return -10;                          // zhong
    }
    switch (si) {
      case 'zhong':
        if (ti === 'zhu') return -20;
        if (ti === 'fan') return 10;
        if (ti === 'nei') return 3;
        return 0;
      case 'fan':
        if (ti === 'zhu') return 12;
        if (ti === 'zhong') return 10;
        if (ti === 'fan') return -8;
        if (ti === 'nei') return 2;
        return 0;
      case 'nei':
        // 内奸希望先削弱强势方，最后单挑
        if (ti === 'zhu') return 3;
        if (ti === 'fan') return 2;
        if (ti === 'zhong') return 2;
        return 0;
      default:
        return 0;
    }
  }

  isEnemy(self, target) { return this.attitude(self, target) > 0; }
  isFriend(self, target) { return this.attitude(self, target) < 0; }

  /** 我方是否处于劣势（用于决定是否拼命） */
  isLosing(self) {
    const g = this.game;
    const alive = g.players.filter((p) => p.alive);
    const enemyScore = alive.filter((p) => this.isEnemy(self, p))
      .reduce((s, p) => s + p.hp, 0);
    const friendScore = alive.filter((p) => this.isFriend(self, p))
      .reduce((s, p) => s + p.hp, 0);
    return enemyScore > friendScore;
  }

  /* ---------------- 选牌 ---------------- */
  pickBestCard(cards, preferLow = true) {
    if (!cards || !cards.length) return null;
    let best = cards[0];
    let bestVal = Infinity;
    for (const c of cards) {
      let v = this.cardValue(c);
      if (!preferLow) v = -v;
      if (v < bestVal) { bestVal = v; best = c; }
    }
    return best;
  }

  /** 弃牌：弃价值最低的 n 张 */
  pickDiscards(cards, n) {
    return cards.slice().sort((a, b) => this.cardValue(a) - this.cardValue(b)).slice(0, n);
  }

  /* ---------------- 响应判断 ---------------- */
  shouldRespond(player, pattern, prompt) {
    const cards = player.getCards('h', (c) => player.matchFilter(c, pattern));
    if (!cards.length) return false;
    if (pattern.name === 'shan') return true;    // 有闪就出
    if (pattern.name === 'sha') return true;
    return false;
  }

  shouldRespondShan(target, source, card) {
    // 手牌很少时保留闪？—— 默认有就出
    return target.countCards('h', (c) => c.name === 'shan') > 0
      || (target.hasSkill('qingguo') && target.countCards('h', (c) => c.color === 'black') > 0);
  }

  shouldRespondSha(player, opponent) {
    return player.countCards('he', (c) => c.name === 'sha') > 0
      || (player.hasSkill('wusheng') && player.countCards('he', (c) => c.color === 'red') > 0);
  }

  shouldUseBagua(target) { return true; }

  shouldSave(self, dying) {
    if (self === dying) return true;                    // 救自己
    if (this.isFriend(self, dying)) return true;        // 救队友
    // 内奸：主公快死时若只剩自己与主公，则不救
    if (self.identity === 'nei' && dying.identity === 'zhu') {
      const alive = this.game.players.filter((p) => p.alive);
      if (alive.length <= 2) return false;
    }
    return false;
  }

  shouldWuxie(self, source, card, currentlyNullified) {
    if (!self.countCards('he', (c) => c.name === 'wuxie')) return false;
    // 已抵消则考虑反抵消：如果原效果对我方有利，就反抵消
    const targets = this.game.players.filter((p) => p.alive);

    // 判断这张锦囊对我方是利是弊
    const beneficial = ['wuzhong', 'taoyuan', 'wugu'].includes(card.name);
    const harmfulToEnemy = ['nanman', 'wanjian', 'juedou'].includes(card.name);

    if (currentlyNullified) {
      // 当前被抵消：若是利牌（不该被抵消），考虑反抵消
      if (beneficial && this.isFriend(self, source)) return true;
      if (harmfulToEnemy && this.isEnemy(self, source)) return true;
      return false;
    }
    // 未被抵消
    if (beneficial && this.isEnemy(self, source)) return true;   // 阻止敌方获益
    if (harmfulToEnemy && this.isFriend(self, source)) return true;
    // 阻止敌方拆我方的牌
    if (['shunshou', 'guohe'].includes(card.name) && this.isEnemy(self, source)) return true;
    return false;
  }

  shouldUseLiuli(self, source, candidates) {
    if (!candidates.length) return false;
    if (self.countCards('he') <= 1) return false;
    // 若候选里有敌人，就流离给敌人
    return candidates.some((c) => this.isEnemy(self, c));
  }

  shouldJiedaoSha(holder, victim) {
    // 对自己有利才杀
    return this.isEnemy(holder, victim) && holder.countCards('he', (c) => c.name === 'sha') > 0;
  }

  /* ---------------- 出牌决策 ---------------- */
  /**
   * 决定是否发动技能
   */
  async decideSkill(player, skill, ctx) {
    // 默认发动多数技能；少数需要谨慎
    switch (skill.id) {
      case 'ganglie': return ctx.event.source && this.isEnemy(player, ctx.event.source);
      case 'fankui': return ctx.event.source && ctx.event.source.countCards('he') > 0;
      case 'jianxiong': return true;
      case 'yiji': return true;
      case 'tiandu': return true;
      case 'luoshen': return true;
      case 'guanxing': return true;
      case 'tieji': return true;
      case 'jizhi': return true;
      case 'lianying': return true;
      case 'xiaoji': return true;
      case 'biyue': return true;
      case 'tuxi': {
        const avail = this.game.players.filter((p) => p !== player && p.alive && p.countCards('h') > 0);
        return avail.length > 0;
      }
      case 'luoyi': return player.countCards('h') <= 2;   // 手牌少时才裸衣
      case 'keji': return true;
      case 'yingzi': return true;
      case 'guicai': return false;                        // 简化：司马懿 AI 不用鬼才
      case 'hujia': return true;
      case 'jijiang': return true;
      case 'cixiong_skill': return true;
      case 'qinglong_skill': return true;
      case 'guanshi_skill': return true;
      case 'qilin_skill': return true;
      case 'bagua_skill': return true;
      case 'hanbing_skill': return ctx.event.target && ctx.event.target.countCards('he') >= 2
        && ctx.event.target.hp > 1;
      default: return true;
    }
  }

  /**
   * 出牌阶段：选择动作
   * 返回 { type:'use'|'skill'|'end', card, targets, skill }
   */
  /**
   * 出牌阶段的决策
   * ------------------------------------------------------------------
   * 改为「给每个可选动作打分，取最高分」的方式。
   * 相比原先的固定 if 顺序，好处是：
   *   - 不会因为某个低价值动作排在前面就先出掉
   *   - 分数可以直接对比（如「出杀」vs「留桃」）
   *   - 调参只需改分值，不必调整分支顺序
   *
   * 分数参考无名杀的 useful/order 思路，但按本项目重新实现。
   */
  decideAction(player) {
    const g = this.game;
    const hand = player.hand;
    const enemies = g.players.filter((p) => p.alive && p !== player && this.isEnemy(player, p));
    const friends = g.players.filter((p) => p.alive && p !== player && this.isFriend(player, p));

    /** 候选动作：{ score, action } */
    const options = [];
    const push = (score, action) => {
      if (score > 0) options.push({ score, action });
    };

    const usedSha = player.flags.usedShaThisTurn || 0;

    /* ---------- 逐张评估手牌 ---------- */
    for (const card of hand) {
      const name = card.name;
      const def = CARDS[name];
      if (!def) continue;

      switch (name) {
        /* 【桃】：自己受伤时才用；濒死时价值极高 */
        case 'tao': {
          if (player.isDamaged()) {
            const urgent = player.hp <= 1 ? 1.8 : 1.0;
            push(taoUseValue(card, player, g) * urgent, { type: 'use', card, targets: [player] });
          }
          break;
        }

        /* 【无中生有】：永远是赚的，价值稳定 */
        case 'wuzhong':
          push(4.5, { type: 'use', card, targets: [player] });
          break;

        /* 【桃园结义】：己方多人残血时才划算 */
        case 'taoyuan': {
          const hurtFriends = friends.filter((p) => p.hp < p.maxHp).length;
          const hurtEnemies = enemies.filter((p) => p.hp < p.maxHp).length;
          const selfHurt = player.hp < player.maxHp ? 1 : 0;
          const gain = hurtFriends + selfHurt - hurtEnemies;
          push(gain >= 2 ? 3 + gain : 0, { type: 'use', card, targets: [] });
          break;
        }

        /* 【五谷丰登】：按净收益（明显低于无名杀之外的经验值，故分很低） */
        case 'wugu':
          push(0.5, { type: 'use', card, targets: [] });
          break;

        /* 【南蛮入侵】/【万箭齐发】：比较敌方与友方的受伤期望 */
        case 'nanman':
        case 'wanjian': {
          const need = name === 'nanman' ? 'sha' : 'shan';
          const willHit = (p) => p.countCards('he', (c) => c.name === need) === 0;
          const hitEnemy = enemies.filter(willHit).length;
          const hitFriend = friends.filter(willHit).length;
          // 敌方中招越多越值；误伤友方要扣分
          const score = hitEnemy * 2.5 - hitFriend * 3.5;
          push(score, { type: 'use', card, targets: [] });
          break;
        }

        /* 【决斗】：手牌充裕才打，否则自伤 */
        case 'juedou': {
          const cands = enemies.filter((p) => !this.cannotBeTarget(p, card));
          if (cands.length) {
            const mySha = player.countCards('he', (c) => c.name === 'sha');
            const t = this.pickTarget(player, cands, card);
            const tSha = t.countCards('he', (c) => c.name === 'sha');
            push(mySha > tSha ? 2.5 : 0, { type: 'use', card, targets: [t] });
          }
          break;
        }

        /* 【顺手牵羊】：拿走敌人的牌，稳定赚 */
        case 'shunshou': {
          const cands = enemies.filter((p) => p.countCards('hej') > 0
            && !this.cannotBeTarget(p, card)
            && (player.hasSkill('qicai') || player.distanceTo(p) <= 1));
          if (cands.length) {
            const t = this.pickTarget(player, cands, card);
            push(8 / (3 + this._usedThisTurn(player, 'shunshou')),
              { type: 'use', card, targets: [t] });
          }
          break;
        }

        /* 【过河拆桥】：比顺手略差（自己拿不到） */
        case 'guohe': {
          const cands = enemies.filter((p) => p.countCards('hej') > 0 && !this.cannotBeTarget(p, card));
          if (cands.length) {
            const t = this.pickTarget(player, cands, card);
            push(10 / (3 + this._usedThisTurn(player, 'guohe')) * 0.8,
              { type: 'use', card, targets: [t] });
          }
          break;
        }

        /* 【乐不思蜀】：拖延敌人关键回合 */
        case 'lebu': {
          const cands = enemies.filter((p) => !this.cannotBeTarget(p, card) && p.judges.length < 2);
          if (cands.length) {
            const t = this.pickTarget(player, cands, card);
            push(3.5, { type: 'use', card, targets: [t] });
          }
          break;
        }

        /* 【借刀杀人】：条件苛刻，价值低 */
        case 'jiedao': {
          const holders = enemies.filter((p) => p.equips.equip1);
          if (holders.length) {
            push(1, { type: 'use', card, targets: [holders[0]] });
          }
          break;
        }

        /* 【闪电】：自己判定区空且收益为正时才放 */
        case 'shandian': {
          const okZone = player.judges.length < 2;
          // 粗略估算：闪电对谁都是 3/4 概率造成 3 点伤害
          const selfRisk = player.hp <= 2 ? -2 : 0;
          push(okZone ? 1 + selfRisk : 0, { type: 'use', card, targets: [player] });
          break;
        }

        /* 【杀】：边际价值随本回合已出杀数递减 */
        case 'sha': {
          if (!this.hasUnlimitedSha(player) && usedSha >= 1) break;
          const cands = enemies.filter((p) => player.inAttackRange(p) && !this.cannotBeTarget(p, card));
          if (cands.length) {
            const t = this.pickTarget(player, cands, card);
            let v = marginal([5, 3, 1], usedSha);
            // 目标低血时更值（有机会击杀）
            if (t.hp <= 1) v += 3;
            // 【酒】加成下这一刀更值
            if ((player.storage.jiu || 0) > 0) v += 2;
            push(v, { type: 'use', card, targets: [t] });
          }
          break;
        }

        /* ---------- 风林火山 ---------- */

        /* 【酒】：残血时当【桃】用；否则留着配合【杀】 */
        case 'jiu': {
          if (player.hp <= 1 && player.isDamaged()) {
            push(7.3, { type: 'use', card, targets: [player] });
          } else if ((player.flags.jiuUsed || 0) === 0) {
            // 手里有杀且能打到人时才值得
            const hasSha = hand.some((c) => c.name === 'sha');
            const canHit = enemies.some((p) => player.inAttackRange(p));
            if (hasSha && canHit) push(4, { type: 'use', card, targets: [player] });
          }
          break;
        }

        /* 【火攻】：目标有手牌且自己花色能对上时 */
        case 'huogong': {
          const cands = enemies.filter((p) => p.countCards('h') > 0 && !this.cannotBeTarget(p, card));
          if (cands.length) {
            const t = this.pickTarget(player, cands, card);
            push(4, { type: 'use', card, targets: [t] });
          }
          break;
        }

        /* 【铁索连环】：多人横置时配合属性伤害，价值上升 */
        case 'tiesuo': {
          const cands = enemies.filter((p) => !this.cannotBeTarget(p, card));
          if (cands.length >= 1) {
            // 已有横置角色时价值更高（可传导）
            const chained = this.game.players.filter((p) => p.alive && p.isChained).length;
            push(chained >= 1 ? 4 : 2.5, { type: 'use', card, targets: cands.slice(0, 2) });
          }
          break;
        }

        /* 【兵粮寸断】：拖慢敌人关键角色 */
        case 'bingliang': {
          const cands = enemies.filter((p) => !this.cannotBeTarget(p, card)
            && player.distanceTo(p) <= 1 && p.judges.length < 2);
          if (cands.length) {
            const t = this.pickTarget(player, cands, card);
            push(3.5, { type: 'use', card, targets: [t] });
          }
          break;
        }

        /* 装备：空槽位才装 */
        default:
          if (def.type === 'equip') {
            const v = equipUseValue(card, player);
            if (v > 1) push(v, { type: 'use', card, targets: [] });
          }
          break;
      }
    }

    /* ---------- 主动技 ---------- */
    const activeSkill = this.pickActiveSkill(player);
    if (activeSkill) {
      // 主动技通常有正收益，给一个中等偏上的基础分
      push(4, { type: 'skill', skill: activeSkill });
    }

    /* ---------- 取最高分 ---------- */
    if (!options.length) return { type: 'end' };
    options.sort((a, b) => b.score - a.score);

    // 【杀】只在没有更好选择时才用：避免为了出杀而放弃无中生有
    const best = options[0];
    if (best.score <= 0) return { type: 'end' };
    return best.action;
  }

  /** 统计本回合已使用某张牌的次数（用于边际递减） */
  _usedThisTurn(player, name) {
    return (player.flags[`used_${name}`] || 0);
  }

  hasUnlimitedSha(player) {
    return this.game.shaUnlimited(player);
  }

  cannotBeTarget(p, card) {
    // 统一走引擎的判定，保证 AI 与规则一致
    return !this.game.canBeTargeted(p, card);
  }

  pickTarget(self, candidates, card) {
    if (!candidates.length) return null;
    // 优先血量低、手牌少的敌人
    return candidates.slice().sort((a, b) => (a.hp - b.hp) || (a.hand.length - b.hand.length))[0];
  }

  pickActiveSkill(player) {
    const g = this.game;
    for (const sid of player.skills) {
      if (player.flags[`skill_${sid}`]) continue;      // 本回合已用（简化：限一次）
      switch (sid) {
        case 'zhiheng': {
          const bad = player.getCards('he').filter((c) => this.cardValue(c) <= 4);
          if (bad.length >= 2) return sid;
          break;
        }
        case 'kurou': {
          if (player.hp >= 3 && player.countCards('h') < 3) return sid;
          break;
        }
        case 'qingnang': {
          const hurt = g.players.filter((p) => p.alive && p.isDamaged()
            && !this.isEnemy(player, p));
          if (hurt.length && player.countCards('h') > 1) return sid;
          break;
        }
        case 'jijian': break;
        case 'lijian': {
          const males = g.players.filter((p) => p !== player && p.alive && p.sex === 'male');
          if (males.length >= 2 && player.countCards('he') > 1) {
            const enemies = males.filter((m) => this.isEnemy(player, m));
            if (enemies.length >= 2) return sid;
          }
          break;
        }
        case 'jieyin': {
          const males = g.players.filter((p) => p !== player && p.alive && p.sex === 'male' && p.isDamaged());
          if (males.length && player.isDamaged() && player.countCards('h') >= 2) return sid;
          break;
        }
        case 'rende': {
          const friends = g.players.filter((p) => p !== player && p.alive
            && this.isFriend(player, p) && p.hand.length < 3);
          if (friends.length && player.countCards('h') > 2) return sid;
          break;
        }
        case 'fanjian': {
          if (player.countCards('h') > 1 && g.players.some((p) => p.alive && this.isEnemy(player, p))) return sid;
          break;
        }
        default: break;
      }
    }
    return null;
  }
}

export default AI;