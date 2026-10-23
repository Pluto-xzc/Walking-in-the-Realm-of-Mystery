/**
 * AI 决策
 * ------------------------------------------------------------------
 * 设计原则：
 *   - 不追求最优，追求「合理且不自杀」
 *   - 基于身份推断敌对关系（attitude）
 *   - 关键判断：是否出闪/杀/桃/无懈、选牌价值
 */

import { CARDS } from './cards.js';

/** 牌的基础价值（用于弃牌与选牌） */
const CARD_VALUE = {
  tao: 9, wuzhong: 8, wuxie: 7, shunshou: 7, guohe: 6.5,
  juedou: 6, nanman: 6, wanjian: 6.5, wugu: 5.5, taoyuan: 5.5,
  jiedao: 4.5, lebu: 5, shandian: 2,
  sha: 5, shan: 5.5,
  equip: 4,
};

export class AI {
  constructor(game) {
    this.game = game;
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

  cardValue(card) {
    if (!card) return 0;
    if (card.type === 'equip') return CARD_VALUE.equip;
    return CARD_VALUE[card.name] || 3;
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
  decideAction(player) {
    const g = this.game;
    const enemies = g.players.filter((p) => p.alive && p !== player && this.isEnemy(player, p));
    const hand = player.hand;

    // 1. 濒死/受伤：优先桃
    if (player.isDamaged()) {
      const tao = hand.find((c) => c.name === 'tao');
      if (tao && player.hp <= 1) {
        return { type: 'use', card: tao, targets: [player] };
      }
    }

    // 2. 无中生有
    const wuzhong = hand.find((c) => c.name === 'wuzhong');
    if (wuzhong) return { type: 'use', card: wuzhong, targets: [player] };

    // 3. 装备
    for (const c of hand) {
      if (c.type !== 'equip') continue;
      const sub = CARDS[c.name].subtype;
      const cur = player.equips[sub];
      if (!cur || this.cardValue(c) > this.cardValue(cur)) {
        return { type: 'use', card: c, targets: [] };
      }
    }

    // 4. 桃（满血则留着）
    const tao = hand.find((c) => c.name === 'tao');
    if (tao && player.hp < player.maxHp) {
      return { type: 'use', card: tao, targets: [player] };
    }

    // 5. 群体增益
    const taoyuan = hand.find((c) => c.name === 'taoyuan');
    if (taoyuan && player.isDamaged()) {
      return { type: 'use', card: taoyuan, targets: [] };
    }

    // 6. 顺手牵羊 / 过河拆桥（对敌人）
    for (const name of ['shunshou', 'guohe']) {
      const c = hand.find((x) => x.name === name);
      if (!c) continue;
      const cands = enemies.filter((p) => {
        if (p.countCards('hej') === 0) return false;
        if (name === 'shunshou') {
          const def = CARDS.shunshou;
          if (!player.hasSkill('qicai') && player.distanceTo(p) > 1) return false;
        }
        if (this.cannotBeTarget(p, c)) return false;
        return true;
      });
      if (cands.length) {
        const t = this.pickTarget(player, cands, c);
        if (t) return { type: 'use', card: c, targets: [t] };
      }
    }

    // 7. 乐不思蜀
    const lebu = hand.find((c) => c.name === 'lebu');
    if (lebu) {
      const cands = enemies.filter((p) => !this.cannotBeTarget(p, lebu) && p.judges.length < 2);
      if (cands.length) {
        const t = this.pickTarget(player, cands, lebu);
        if (t) return { type: 'use', card: lebu, targets: [t] };
      }
    }

    // 8. 决斗
    const juedou = hand.find((c) => c.name === 'juedou');
    if (juedou && enemies.length) {
      const cands = enemies.filter((p) => !this.cannotBeTarget(p, juedou)
        && player.countCards('he', (c) => c.name === 'sha') >= p.countCards('he', (c) => c.name === 'sha'));
      if (cands.length) {
        const t = this.pickTarget(player, cands, juedou);
        if (t) return { type: 'use', card: juedou, targets: [t] };
      }
    }

    // 9. 群体伤害（敌人多时）
    for (const name of ['nanman', 'wanjian']) {
      const c = hand.find((x) => x.name === name);
      if (!c) continue;
      const need = CARDS[name].name === 'nanman' ? 'sha' : 'shan';
      const hitCount = enemies.filter((p) => p.countCards('he', (x) => x.name === need) === 0).length;
      const friendHit = g.players.filter(
        (p) => p.alive && p !== player && this.isFriend(player, p)
          && p.countCards('he', (x) => x.name === need) === 0,
      ).length;
      if (hitCount >= 1 && hitCount >= friendHit) {
        return { type: 'use', card: c, targets: [] };
      }
    }

    // 10. 杀
    const shas = hand.filter((c) => c.name === 'sha');
    if (shas.length) {
      const usedSha = player.flags.usedShaThisTurn || 0;
      const unlimited = this.hasUnlimitedSha(player);
      if (unlimited || usedSha < 1) {
        const cands = enemies.filter((p) => player.inAttackRange(p) && !this.cannotBeTarget(p, shas[0]));
        if (cands.length) {
          const t = this.pickTarget(player, cands, shas[0]);
          if (t) return { type: 'use', card: shas[0], targets: [t] };
        }
      }
    }

    // 11. 主动技
    const activeSkill = this.pickActiveSkill(player);
    if (activeSkill) return { type: 'skill', skill: activeSkill };

    return { type: 'end' };
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