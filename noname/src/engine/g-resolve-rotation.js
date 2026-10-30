/**
 * 轮换牌 · 结算
 * ==================================================================
 * 卡包一《星神的一瞥》（12 张「星神赐福」）与
 * 卡包二《通宝雅集》里的 3 张锦囊的结算集中在这里。
 *
 * 「星神赐福」的通用规则（需求方给定）：
 *   · 不能被【无懈可击】抵消；
 *   · 没有被特别声明时，不能被转化、不计入即时牌/伤害类牌统计；
 *   · 角色成为星神赐福的目标后，本局内被标记，
 *     之后不能再成为星神赐福的目标（IX 虽然让它无效，也照样算被标记）。
 */

import { CARDS } from '../cards.js';

/** 标记「本局受过星神赐福」 */
export function markBlessed(target) {
  if (!target) return;
  target.flags.blessedThisGame = true;
}

export function isBlessed(player) {
  return !!(player && player.flags && player.flags.blessedThisGame);
}

/** 待选牌名的候选（供【迷思】声明用，UI 上不会太长） */
const DECLARE_NAMES = [
  'sha', 'shan', 'tao', 'jiu', 'wuxie', 'juedou', 'guohe', 'shunshou',
  'wanjian', 'nanman', 'wuzhong', 'taoyuan', 'wugu', 'huogong', 'tiesuo', 'jiedao',
];

/** 从某人的手牌里挑一张（对其可见的人调用） */
export async function pickFromHand(game, chooser, owner, prompt) {
  const cards = (owner.hand || []).filter(Boolean);
  if (!cards.length) return null;
  const options = cards.map((c, i) => ({
    key: String(i),
    label: `${c.suitLabel || ''}${c.numberLabel || ''}${c.fullname || c.name}`,
  }));
  const pick = await chooser.chooseOption({ prompt, options });
  const idx = Number(pick);
  return Number.isInteger(idx) && cards[idx] ? cards[idx] : null;
}

export default {
  /* ================================================================
   * 星神赐福的通用入口
   * ================================================================ */
  async resolveBlessing(player, card, targets) {
    const list = (targets || []).filter(Boolean);
    const name = card.name;

    switch (name) {
      case 'nanuke': {
        const t = list[0];
        if (!t) break;
        const hand = player.hand.filter(Boolean);
        let amount = 1;
        if (hand.length >= 2) {
          const yes = await player.chooseOption({
            prompt: `【纳努克】是否弃置两张手牌，令${t.name}改为失去 2 点体力？`,
            options: [{ key: 'yes', label: '弃两张手牌（失去 2 点）' }, { key: 'no', label: '不弃（失去 1 点）' }],
          });
          if (yes === 'yes') {
            const picked = await player.chooseCards({
              prompt: '【纳努克】选择要弃置的两张手牌', position: 'h', min: 2, max: 2, cancelable: false,
            });
            if (picked && picked.length === 2) { await player.discard(picked); amount = 2; }
          }
        }
        await t.loseHp(amount);
        this.log(`【纳努克】${t.name} 失去了 ${amount} 点体力`);
        break;
      }

      case 'lan': {
        const t = list[0];
        if (!t) break;
        this._pendingExtraTurns = this._pendingExtraTurns || [];
        this._pendingExtraTurns.push(t);
        this.log(`【岚】${t.name} 将在当前回合结束后获得一个额外回合`);
        break;
      }

      case 'boshizun': {
        const t = list[0];
        if (!t) break;
        const order = this.orderFrom(t).filter((p) => p !== t && p.alive);
        for (const owner of order) {
          const got = await pickFromHand(this, t, owner, `【博识尊】观看 ${owner.name} 的手牌，选择获得其中一张`);
          if (got) {
            await owner.loseCards([got], 'h');
            await t.gain([got]);
            this.log(`【博识尊】${t.name} 获得了 ${owner.name} 的一张牌`);
          }
        }
        // 本回合这些角色的手牌对目标角色可见
        for (const p of order) {
          p.flags.handVisibleTo = p.flags.handVisibleTo || [];
          if (!p.flags.handVisibleTo.includes(t.id)) p.flags.handVisibleTo.push(t.id);
        }
        break;
      }

      case 'kelipo': {
        const t = list[0];
        if (!t) break;
        t.armor = (t.armor || 0) + 3;
        this.log(`【克里珀】${t.name} 获得了 3 点护甲（现有 ${t.armor}）`);
        break;
      }

      case 'yaoshi': {
        const t = list[0];
        if (!t) break;
        await t.recover(2);
        this.log(`【药师】${t.name} 回复 2 点体力（${t.hp}/${t.maxHp}）`);
        if (t.hp >= t.maxHp) {
          const got = await pickFromHand(this, player, t, `【药师】${t.name} 已回复至上限，你观看其手牌并获得一张`);
          if (got) { await t.loseCards([got], 'h'); await player.gain([got]); }
        }
        break;
      }

      case 'aoboluosi': {
        const t = list[0];
        if (!t) break;
        t.flags.aoboluosi = true;
        t.flags.handLimitOverride = 1;
        this.log(`【奥博洛斯】${t.name} 本回合手牌上限变为 1，造成伤害后可摸牌`);
        break;
      }

      case 'aha': {
        const t = list[0];
        if (!t) break;
        const j = await this.doJudge(t, '阿哈');
        const red = j.color === 'red';
        this.log(`【阿哈】${t.name} 判定为 ${j.card ? j.card.fullname : '?'}（${red ? '红' : '黑'}，${j.number % 2 === 0 ? '偶' : '奇'}）`);
        if (red) await t.recover(1); else await t.loseHp(1);
        if (j.number % 2 === 0) await t.draw(1); else await t.discardCards(1, 'he', '【阿哈】弃置一张牌');
        break;
      }

      case 'tayiziyuluosi': {
        const t = list[0];
        if (!t) break;
        await t.draw(6);
        t.flags.tayiziyuluosiCost = true;
        this.log(`【塔伊兹育罗斯】${t.name} 摸六张牌，本回合用牌前须弃一张牌或失去 1 点体力`);
        break;
      }

      case 'misi': {
        const t = list[0];
        if (!t) break;
        t.flags.misiTimes = (t.flags.misiTimes || 0) + 2;
        this.log(`【迷思】${t.name} 接下来两次使用牌时可以声明牌名`);
        break;
      }

      case 'fuli': {
        const t = list[0];
        if (!t) break;
        await this.resolveFuli(t);
        break;
      }

      default:
        this.log(`【${card.fullname}】没有实现的效果`);
        break;
    }

    // 成为过星神赐福的目标 → 本局标记
    for (const t of list) markBlessed(t);
  },

  /** 【浮黎】按三组类别各取一张弃牌堆的牌 */
  async resolveFuli(target) {
    const groups = [
      ['基本或锦囊', (c) => CARDS[c.name] && (CARDS[c.name].type === 'basic' || CARDS[c.name].type === 'trick')],
      ['武器或防具', (c) => CARDS[c.name] && CARDS[c.name].type === 'equip'
        && (CARDS[c.name].subtype === 'equip1' || CARDS[c.name].subtype === 'equip2')],
      ['坐骑或宝物', (c) => CARDS[c.name] && CARDS[c.name].type === 'equip'
        && (CARDS[c.name].subtype === 'equip3' || CARDS[c.name].subtype === 'equip4'
          || CARDS[c.name].subtype === 'equip5')],
    ];
    for (const [label, fn] of groups) {
      const pool = this.discardPile.filter((c) => fn(c));
      if (!pool.length) continue;
      const yes = await target.chooseOption({
        prompt: `【浮黎】是否从弃牌堆获得一张「${label}」的牌？`,
        options: [{ key: 'yes', label: '获得' }, { key: 'no', label: '放弃' }],
      });
      if (yes !== 'yes') continue;
      const options = pool.slice(0, 12).map((c, i) => ({ key: String(i), label: c.fullname || c.name }));
      const pick = await target.chooseOption({ prompt: `【浮黎】选择一张「${label}」的牌`, options });
      const c = pool[Number(pick)];
      if (!c) continue;
      this.discardPile = this.discardPile.filter((x) => x !== c);
      await target.gain([c]);
      this.log(`【浮黎】${target.name} 从弃牌堆获得了【${c.fullname || c.name}】`);
    }
  },

  /* ================================================================
   * 【IX】：对一张正在使用的牌使用，令其无效
   * ================================================================ */
  async askIX(source, card, targets) {
    if (!card) return false;
    for (const p of this.players) {
      if (!p.alive) continue;
      const ix = p.hand.find((c) => c.name === 'ix');
      if (!ix) continue;
      const yes = await p.chooseOption({
        prompt: `【IX】是否对${source.name}使用的【${card.fullname || card.name}】使用【IX】令其无效？`,
        options: [{ key: 'yes', label: '使用【IX】' }, { key: 'no', label: '不使用' }],
      });
      if (yes !== 'yes') continue;
      await p.loseCards([ix], 'h');
      this.toDiscard([ix]);
      /*
       * 【IX】是「对一张牌使用」，**不取角色为目标**。
       * 需求方裁定：用过【IX】的角色仍然可以成为星神赐福的目标，
       * 被 IX 压掉的牌也不再让任何人获得「成为过目标」的标记
       *（IX 令其无效 ⇒ 没有任何角色真正成为过该赐福的目标）。
       */
      this.log(`【IX】${p.name} 令【${card.fullname || card.name}】无效`);
      return true;
    }
    return false;
  },

  /* ================================================================
   * 【希佩】：受伤时使用，取消那次伤害
   * ================================================================ */
  async askXipei(target, source, num) {
    if (!target || isBlessed(target)) return false;
    for (const p of this.players) {
      if (!p.alive) continue;
      const c = p.hand.find((x) => x.name === 'xipei');
      if (!c) continue;
      const yes = await p.chooseOption({
        prompt: `【希佩】是否对${target.name}使用【希佩】，令这次 ${num} 点伤害变为 0？`,
        options: [{ key: 'yes', label: '使用【希佩】' }, { key: 'no', label: '不使用' }],
      });
      if (yes !== 'yes') continue;
      await p.loseCards([c], 'h');
      this.toDiscard([c]);
      markBlessed(target);
      this._damageMinusOneTurn = true;
      await p.draw(1);
      await target.draw(1);
      if (source && source !== p && source !== target) await source.draw(1);
      this.log(`【希佩】${p.name} 令${target.name}受到的伤害变为 0，本回合所有伤害 -1`);
      return true;
    }
    return false;
  },

  /* ================================================================
   * 【塔伊兹育罗斯】的使用代价
   * ================================================================ */
  async payTayiziyuluosiCost(player) {
    if (!player.flags.tayiziyuluosiCost) return true;
    /*
     * 代价是「弃一张牌」或「失去 1 点体力」，二选一，**必须支付**。
     * 历史 bug：玩家在选牌界面点取消时直接 return false，
     * 于是这张牌用不出来、而标记又不会消失 → 整回合什么牌都用不了。
     * 现在取消一律按「失去 1 点体力」处理，保证一定付得起。
     */
    const pool = player.getCards('he');
    if (!pool.length) {
      await player.loseHp(1);
      this.log(`【塔伊兹育罗斯】${player.name} 没有牌可弃，失去 1 点体力`);
      return true;
    }
    const yes = await player.chooseOption({
      prompt: '【塔伊兹育罗斯】使用或打出牌前，须弃置一张牌或失去 1 点体力',
      options: [{ key: 'discard', label: '弃置一张牌' }, { key: 'hp', label: '失去 1 点体力' }],
    });
    if (yes === 'hp') { await player.loseHp(1); return true; }
    const picked = await player.chooseCards({
      prompt: '【塔伊兹育罗斯】选择要弃置的牌', position: 'he', min: 1, max: 1, cancelable: true,
    });
    if (picked && picked.length) { await player.discard(picked); return true; }
    // 取消选牌 → 兜底改为失去 1 点体力
    await player.loseHp(1);
    this.log(`【塔伊兹育罗斯】${player.name} 放弃弃牌，改为失去 1 点体力`);
    return true;
  },

  /* ================================================================
   * 【迷思】声明牌名 + 质疑
   * ================================================================ */
  async misiDeclare(player, card) {
    if (!player.flags.misiTimes) return { extra: 0 };
    const yes = await player.chooseOption({
      prompt: `【迷思】是否扣置【${card.fullname || card.name}】并声明一个牌名？`,
      options: [{ key: 'yes', label: '声明牌名' }, { key: 'no', label: '不声明' }],
    });
    if (yes !== 'yes') return { extra: 0 };
    const pick = await player.chooseOption({
      prompt: '【迷思】声明此牌为',
      options: DECLARE_NAMES
        .filter((n) => CARDS[n])
        .map((n) => ({ key: n, label: `【${CARDS[n].fullname || CARDS[n].label}】` })),
    });
    player.flags.misiTimes = Math.max(0, (player.flags.misiTimes || 0) - 1);
    const declared = pick || card.name;
    let challenged = false;
    for (const p of this.players) {
      if (!p.alive || p === player) continue;
      const q = await p.chooseOption({
        prompt: `${player.name} 声明此牌为【${CARDS[declared] ? (CARDS[declared].fullname || CARDS[declared].label) : declared}】，是否质疑？`,
        options: [{ key: 'yes', label: '质疑' }, { key: 'no', label: '不质疑' }],
      });
      if (q === 'yes') { challenged = true; this._misiChallenger = p; break; }
    }
    if (!challenged) {
      this.log(`【迷思】无人质疑，此牌按声明结算`);
      return { extra: 0 };
    }
    const same = declared === card.name;
    if (same) {
      this.log(`【迷思】声明与实物相同，此牌额外结算一次`);
      return { extra: 1 };
    }
    this.log(`【迷思】声明与实物不同，质疑者于结算后摸一张牌`);
    this._misiDrawAfter = this._misiChallenger;
    return { extra: 0 };
  },

  /* ================================================================
   * 《通宝雅集》三张锦囊
   * ================================================================ */
  /** 寒门志：手牌最少的所有角色各摸两张，本回合不能使用或打出牌 */
  async resolveHanmenzhi(player) {
    const alive = this.players.filter((p) => p.alive);
    const min = Math.min(...alive.map((p) => p.countCards('h')));
    const targets = alive.filter((p) => p.countCards('h') === min);
    for (const t of targets) {
      await t.draw(2);
      t.flags.cannotUseCardTurn = true;
    }
    this.log(`【寒门志】${targets.map((p) => p.name).join('、')} 各摸两张牌，本回合不能使用或打出牌`);
  },

  /** 争商机：从使用者开始，每人选择是否弃置所有手牌换摸牌 */
  async resolveZhengshangji(player) {
    const order = this.orderFrom(player).filter((p) => p.alive);
    for (const p of order) {
      if (!p.hand.length) continue;
      const yes = await p.chooseOption({
        prompt: '【争商机】是否弃置所有手牌？（每 1 个种类摸 1 张，每 2 个花色再摸 3 张）',
        options: [{ key: 'yes', label: '弃置所有手牌' }, { key: 'no', label: '不弃' }],
      });
      if (yes !== 'yes') continue;
      const cards = p.hand.slice();
      const kinds = new Set(cards.map((c) => (CARDS[c.name] || {}).type || 'other'));
      const suits = new Set(cards.map((c) => c.suit).filter(Boolean));
      await p.discard(cards);
      const gain = kinds.size + Math.floor(suits.size / 2) * 3;
      if (gain > 0) await p.draw(gain);
      this.log(`【争商机】${p.name} 弃置 ${cards.length} 张（${kinds.size} 种类 / ${suits.size} 花色），摸 ${gain} 张`);
    }
  },

  /** 遇良奕：双方手牌摸至 8，本回合使用者仅能对其使用牌 */
  async resolveYuliangyi(player, target) {
    const to8 = (p) => Math.max(0, 8 - p.countCards('h'));
    const a = to8(player);
    const b = to8(target);
    if (a) await player.draw(a);
    if (b) await target.draw(b);
    player.flags.yuliangyiOnly = target.id;
    this.log(`【遇良奕】${player.name} 与${target.name}各将手牌摸至 8 张，`
      + `${player.name} 本回合仅能对${target.name}使用手牌`);
  },
};
