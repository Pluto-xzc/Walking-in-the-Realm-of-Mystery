/**
 * 核心引擎 · Game 方法集：扩展牌结算
 * ------------------------------------------------------------------
 * 四副牌堆里新增的锦囊 / 特殊基本牌的结算逻辑。
 * 拆成独立文件，避免 g-resolve.js 继续膨胀。
 *
 * 约定：每个方法都是 `async resolveXxx(player, targets)`，由 g-play.js 的
 * 结算 switch 调用；`player` 是使用者，`targets` 是已选好的目标。
 */

import { CARDS } from '../cards.js';
import { ZONE } from './zones.js';

/** 取一张牌的展示名（火杀 / 雷杀 / 刺杀 已经写在 fullname 里） */
const nameOf = (card) => (card ? card.fullname || card.name : '牌');

/**
 * 【调兵遣将】等的「按座位顺序」列表（含使用者自己）
 * 与已有的 orderFrom 一致，这里只做薄封装，便于阅读。
 */
function orderFrom(start, list) {
  const all = list.slice().sort((a, b) => a.seat - b.seat);
  const i = all.indexOf(start);
  if (i < 0) return all;
  return [...all.slice(i), ...all.slice(0, i)];
}

export default {
  /* ================================================================
   * 【逐近弃远】距离 > 1 弃置，距离 = 1 获得
   * ================================================================ */
  async resolveZhujin(player, targets) {
    const t = targets && targets[0];
    if (!t || !t.alive) return;
    if (!t.getCards('hej').length) {
      this.log(`【逐近弃远】${t.name} 区域内没有牌`);
      return;
    }
    const far = player.distanceTo(t) > 1;
    const picked = await player.chooseCardFromPlayer(
      t, 'hej', `逐近弃远：${far ? '弃置' : '获得'} ${t.name} 的一张牌`,
    );
    if (!picked || !picked.length) return;
    const c = picked[0];
    await t.loseCards(picked);
    if (far) {
      this.toDiscard(picked, { direct: true });
      this.log(`${player.name} 弃置了 ${t.name} 的 ${c.text}`);
    } else {
      await player.gain(picked, 'gain2');
      this.log(`${player.name} 获得了 ${t.name} 的 ${c.text}`);
    }
  },

  /* ================================================================
   * 【洞烛先机】卜算 2，然后摸两张
   * ================================================================ */
  async resolveDongzhu(player) {
    const n = Math.min(2, this.deck.length);
    if (n > 0) {
      const top = this.takeFromDeckTop(n);
      // 卜算：让玩家挑一张先摸的，剩下的按选择顺序放回牌堆顶
      let order = top.slice();
      if (player.isHuman && top.length > 1) {
        const first = await this.io.chooseCards(player, {
          prompt: '洞烛先机（卜算）：选择先摸到的那张牌',
          position: 'list', min: 1, max: 1, cardList: top, cancelable: false,
        });
        if (first && first.length) {
          order = [first[0], ...top.filter((c) => c !== first[0])];
        }
      } else if (order.length > 1) {
        order = order.slice().sort((a, b) => this.ai.cardValue(a) - this.ai.cardValue(b));
      }
      // 数组尾部是牌堆顶 → 先摸的放最后
      for (const c of order) { c.zone = ZONE.DECK; this.deck.push(c); }
      this.log(`${player.name} 发动【洞烛先机】卜算了 ${n} 张牌`);
    }
    await player.draw(2);
  },

  /* ================================================================
   * 【增兵减灶】目标摸三张，然后弃一张非基本牌或弃两张牌
   * ================================================================ */
  async resolveZengbing(player, targets) {
    const t = targets && targets[0];
    if (!t || !t.alive) return;
    await t.draw(3);
    const nonBasic = t.getCards('h', (c) => c.type !== 'basic');
    if (!nonBasic.length) {
      const all = t.getCards('h');
      if (all.length < 2) return;
      const picked = await t.chooseCards({
        prompt: '增兵减灶：弃置两张牌',
        position: 'h', min: 2, max: 2, cancelable: false,
      });
      if (picked && picked.length) {
        await t.discard(picked);
        this.log(`${t.name} 因【增兵减灶】弃置了 ${picked.map((c) => c.text).join('、')}`);
      }
      return;
    }
    const twoCards = t.getCards('h').length >= 2;
    const pick = twoCards
      ? await this.io.chooseOption(t, '增兵减灶：请选择一项',
        [{ key: 'one', label: '弃置一张非基本牌' }, { key: 'two', label: '弃置两张牌' }])
      : 'one';
    if (pick === 'two') {
      const picked = await t.chooseCards({
        prompt: '增兵减灶：弃置两张牌',
        position: 'h', min: 2, max: 2, cancelable: false,
      });
      if (picked && picked.length) {
        await t.discard(picked);
        this.log(`${t.name} 因【增兵减灶】弃置了 ${picked.map((c) => c.text).join('、')}`);
      }
      return;
    }
    const picked = await t.chooseCards({
      prompt: '增兵减灶：弃置一张非基本牌',
      position: 'h', min: 1, max: 1, filter: (c) => c.type !== 'basic', cancelable: false,
    });
    if (picked && picked.length) {
      await t.discard(picked);
      this.log(`${t.name} 因【增兵减灶】弃置了 ${picked[0].text}`);
    }
  },

  /* ================================================================
   * 【树上开花】弃至多两张，摸等量；弃了装备牌则多摸两张
   * ================================================================ */
  async resolveShushangkaihua(player) {
    let picked = [];
    if (player.countCards('h') > 0) {
      picked = (await player.chooseCards({
        prompt: '树上开花：弃置至多两张牌（弃置装备牌可多摸两张）',
        position: 'h', min: 0, max: Math.min(2, player.countCards('h')), cancelable: true,
      })) || [];
    }
    const hadEquip = picked.some((c) => c.type === 'equip');
    if (picked.length) {
      await player.discard(picked);
      this.log(`${player.name} 发动【树上开花】弃置了 ${picked.map((c) => c.text).join('、')}`);
    }
    const n = picked.length + (hadEquip ? 2 : 0);
    if (n > 0) {
      await player.draw(n);
      this.log(`${player.name} 发动【树上开花】摸了 ${n} 张牌`);
    }
  },

  /* ================================================================
   * 【水淹七军】弃两张装备牌，或受 1 点雷电伤害
   * ================================================================ */
  async resolveShuiyan(player, targets) {
    const t = targets && targets[0];
    if (!t || !t.alive) return;
    const equips = t.getCards('he', (c) => c.type === 'equip');
    if (equips.length < 2) {
      this.log(`${t.name} 没有两张装备牌可弃，受到【水淹七军】的伤害`);
      await t.damage(1, player, 'shuiyan', null, 'thunder');
      return;
    }
    const pick = await this.io.chooseOption(t, '【水淹七军】：请选择一项', [
      { key: 'discard', label: '弃置两张装备牌' },
      { key: 'damage', label: '受到 1 点雷电伤害' },
    ]);
    if (pick === 'damage') {
      await t.damage(1, player, 'shuiyan', null, 'thunder');
      return;
    }
    const picked = await t.chooseCards({
      prompt: '水淹七军：弃置两张装备牌',
      position: 'he', min: 2, max: 2, filter: (c) => c.type === 'equip', cancelable: false,
    });
    if (picked && picked.length) {
      // 先离开装备区，再进弃牌堆
      await t.loseCards(picked);
      this.toDiscard(picked, { direct: true });
      this.log(`${t.name} 因【水淹七军】弃置了 ${picked.map((c) => c.text).join('、')}`);
    }
  },

  /* ================================================================
   * 【挟令】结束出牌阶段，回合结束时获得额外阶段
   * ================================================================ */
  async resolveXieling(player) {
    const PHASES = [
      { key: 'judge', label: '判定阶段' },
      { key: 'draw', label: '摸牌阶段' },
      { key: 'use', label: '出牌阶段' },
      { key: 'discard', label: '弃牌阶段' },
    ];
    const canPay = player.countCards('h') > 0;
    const first = await this.io.chooseOption(player, '【挟令】：是否结束出牌阶段？', [
      { key: 'one', label: '获得一个额外阶段' },
      { key: 'two', label: canPay ? '弃一张牌，获得两个不同额外阶段' : '（手牌不足，无法选此项）' },
    ]);
    const phases = [];
    if (first === 'two' && canPay) {
      for (let i = 0; i < 2; i++) {
        const left = PHASES.filter((p) => !phases.includes(p.key));
        if (!left.length) break;
        const pick = await this.io.chooseOption(
          player, `【挟令】：选择第 ${i + 1} 个额外阶段`, left,
        );
        phases.push(pick);
      }
      const paid = await player.chooseCards({
        prompt: '挟令：弃置一张牌', position: 'h', min: 1, max: 1, cancelable: false,
      });
      if (paid && paid.length) await player.discard(paid);
    } else {
      const pick = await this.io.chooseOption(player, '【挟令】：选择一个额外阶段', PHASES);
      phases.push(pick);
    }
    player.flags.xielingExtra = phases;
    player.addFlag('endUsePhase', true);
    this.log(`${player.name} 发动【挟令】，结束出牌阶段，`
      + `回合结束时获得：${phases.map((k) => PHASES.find((p) => p.key === k).label).join('、')}`);
  },

  /** 回合结束时执行【挟令】攒下的额外阶段 */
  async resolveXielingExtra(player) {
    const phases = player.flags.xielingExtra;
    if (!phases || !phases.length) return;
    player.flags.xielingExtra = null;
    for (const key of phases) {
      if (!player.alive || this.over) return;
      if (key === 'judge') await this.phaseJudge(player);
      else if (key === 'draw') await this.phaseDraw(player);
      else if (key === 'use') await this.phaseUse(player);
      else if (key === 'discard') await this.phaseDiscard(player);
    }
  },

  /* ================================================================
   * 【舌战群儒】你摸一张；其他角色可与你同时拼点，你最大或无人应战则摸两张
   * ================================================================ */
  async resolveShezhan(player) {
    await player.draw(1);
    const mine = player.getCards('h');
    if (!mine.length) return;
    const myPick = (await player.chooseCards({
      prompt: '【舌战群儒】：选择一张手牌拼点',
      position: 'h', min: 1, max: 1, cancelable: false,
    }))[0] || mine[0];
    const myNum = myPick.number;

    let contenders = 0;
    let beaten = false;
    for (const p of this.players) {
      if (p === player || !p.alive || !p.countCards('h')) continue;
      const cards = p.getCards('h');
      // AI：手牌大且把你当敌人时才应战
      let join;
      if (p.isHuman) {
        join = await this.io.chooseOption(p, `【舌战群儒】：是否与 ${player.name} 拼点？`, [
          { key: 'yes', label: '应战' }, { key: 'no', label: '不应战' },
        ]);
        join = join === 'yes';
      } else {
        const best = cards.reduce((a, b) => (a.number >= b.number ? a : b));
        join = best.number >= 10 && this.ai.isEnemy(p, player);
      }
      if (!join) continue;
      contenders += 1;
      const theirs = p.getCards('h').reduce((a, b) => (a.number >= b.number ? a : b));
      if (theirs.number > myNum) beaten = true;
      await p.loseCards([theirs]);
      this.toDiscard([theirs], { direct: true });
      this.log(`${p.name} 与 ${player.name} 拼点：${theirs.text}`);
    }

    await player.loseCards([myPick]);
    this.toDiscard([myPick], { direct: true });

    if (contenders === 0) {
      this.log(`无人与 ${player.name} 拼点，【舌战群儒】生效`);
      await player.draw(2);
    } else if (!beaten) {
      this.log(`${player.name} 的拼点牌最大，【舌战群儒】生效`);
      await player.draw(2);
    } else {
      this.log(`${player.name} 的拼点牌不是最大，【舌战群儒】未生效`);
    }
  },

  /* ================================================================
   * 【调兵遣将】亮出牌堆顶 X 张，依次与手牌交换
   * ================================================================ */
  async resolveDiaobing(player) {
    await player.draw(1);
    const alive = this.players.filter((p) => p.alive);
    const x = Math.ceil(alive.length / 2);
    const pool = this.takeFromDeckTop(Math.min(x, this.deck.length));
    if (!pool.length) return;
    this.log(`【调兵遣将】亮出 ${pool.map((c) => c.text).join('、')}`);

    // 目标：自己 + 有手牌的其他角色
    const order = orderFrom(player, alive).filter((p) => p === player || p.countCards('h'));
    for (const p of order) {
      if (!p.alive) continue;
      const avail = pool.filter((c) => c.zone === 'reveal' || pool.includes(c));
      if (!avail.length) break;
      if (!p.countCards('h')) continue;
      const pick = await this.io.chooseOption(p, '【调兵遣将】：是否用手牌换一张亮出的牌？', [
        { key: 'yes', label: '交换' }, { key: 'no', label: '不换' },
      ]);
      if (pick !== 'yes') continue;
      const hand = await p.chooseCards({
        prompt: '调兵遣将：选择一张手牌用于交换',
        position: 'h', min: 1, max: 1, cancelable: true,
      });
      if (!hand || !hand.length) continue;
      const take = await p.chooseCards({
        prompt: '调兵遣将：选择要换到的牌',
        position: 'list', min: 1, max: 1, cardList: avail, cancelable: true,
      });
      if (!take || !take.length) continue;
      const got = take[0];
      const idx = pool.indexOf(got);
      pool[idx] = hand[0];
      await p.loseCards([hand[0]]);
      await p.gain([got], 'gain2');
      this.log(`${p.name} 用 ${hand[0].text} 换走了 ${got.text}`);
    }

    // 剩余的亮出牌放回牌堆顶（按当前顺序）
    for (const c of pool) { c.zone = ZONE.DECK; this.deck.push(c); }
    this.emit();
  },

  /* ================================================================
   * 【出其不意】判定，不弃同花色手牌则受 1 点无来源伤害
   * ================================================================ */
  async resolveChuqi(player, targets) {
    const t = targets && targets[0];
    if (!t || !t.alive) return;
    const j = await t.judge('chuqi');
    const same = t.getCards('h', (c) => c.suit === j.suit);
    if (!same.length) {
      this.log(`${t.name} 没有 ${j.card ? j.card.suitLabel : ''} 花色的手牌，受到【出其不意】的伤害`);
      await t.damage(1, null, 'chuqi', null);
      return;
    }
    const pick = await this.io.chooseOption(t, `【出其不意】：弃置一张 ${j.card.suitLabel} 花色的手牌？`, [
      { key: 'yes', label: '弃置' }, { key: 'no', label: '不弃（受到 1 点伤害）' },
    ]);
    if (pick !== 'yes') {
      await t.damage(1, null, 'chuqi', null);
      return;
    }
    const picked = await t.chooseCards({
      prompt: '出其不意：弃置一张同花色手牌',
      position: 'h', min: 1, max: 1, filter: (c) => c.suit === j.suit, cancelable: false,
    });
    if (picked && picked.length) await t.discard(picked);
  },

  /* ================================================================
   * 【火烧联营】距离最小的所有其他角色各受 1 点火焰伤害（无来源）
   * ================================================================ */
  async resolveHuoshaolianying(player) {
    const others = this.players.filter((p) => p.alive && p !== player);
    if (!others.length) return;
    const min = Math.min(...others.map((p) => player.distanceTo(p)));
    const targets = others.filter((p) => player.distanceTo(p) === min);
    this.log(`【火烧联营】目标：${targets.map((p) => p.name).join('、')}`);
    for (const t of targets) {
      if (!t.alive) continue;
      await t.damage(1, null, 'huoshaolianying', null, 'fire');
    }
  },

  /* ================================================================
   * 【远交近攻】手牌+体力最小的其他角色摸 1，你摸 3
   * ================================================================ */
  async resolveYuanjiao(player) {
    const others = this.players.filter((p) => p.alive && p !== player);
    if (!others.length) return;
    const score = (p) => p.countCards('h') + p.hp;
    const min = Math.min(...others.map(score));
    const cands = others.filter((p) => score(p) === min);
    let t = cands[0];
    if (cands.length > 1) {
      const pick = await this.io.chooseTargets(player, {
        prompt: '远交近攻：选择一名目标', candidates: cands, min: 1, max: 1,
      });
      t = (pick && pick[0]) || cands[0];
    }
    this.log(`${player.name} 对 ${t.name} 使用【远交近攻】`);
    await t.draw(1);
    await player.draw(3);
  },

  /* ================================================================
   * 【金蝉脱壳】成为即时牌目标时弃置此牌，令之对自己无效
   * ================================================================ */
  async filterJinchan(player, card, targets) {
    if (!targets || !targets.length) return targets;
    const def = CARDS[card.name] || {};
    // 只对「即时牌」生效（装备与延时锦囊不算）
    if (def.type === 'equip' || def.delayed) return targets;

    const kept = [];
    for (const t of targets) {
      const jin = t.getCards('h', (c) => c.name === 'jinchan');
      if (!jin.length) { kept.push(t); continue; }
      const isLast = t.countCards('h') === 1;
      const pick = await this.io.chooseOption(t,
        `【金蝉脱壳】：弃置此牌令【${nameOf(card)}】对你无效？（摸 ${isLast ? 2 : 1} 张）`,
        [{ key: 'yes', label: '弃置并抵消' }, { key: 'no', label: '不发动' }]);
      if (pick !== 'yes') { kept.push(t); continue; }
      const c = jin[0];
      await t.loseCards([c]);
      this.toDiscard([c], { direct: true });
      await t.draw(isLast ? 2 : 1);
      this.log(`${t.name} 弃置【金蝉脱壳】，令【${nameOf(card)}】对自己无效`);
    }
    return kept;
  },
};
