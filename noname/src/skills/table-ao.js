/**
 * 扩展包 · 光启新篇（势力「奥」）
 * ------------------------------------------------------------------
 * 武将：渡（基础形态「不朽纪行 + 命运同心·朽」／入幻形态「远客归墟 + 命运同心·生」）
 *
 * 本文件只依赖引擎公开接口，规则一律来自需求方文字；无名杀没有同名武将，
 * 因此不存在照抄，属于洁净室实现。
 */

import { CARDS } from '../cards.js';
import { Card } from '../engine/card.js';
import {
  enterHuan, exitHuan, hasDestinyTurn, setDestinyTurn,
} from '../mechanics.js';

/* ============================================================
 * 要素（记录项）
 * ============================================================
 * 「记录完就是：体力值、【杀】、造成的伤害、【树上开花】、【火烧连营】」
 * 五个要素之间可以 1:1 任意转化，代价与产出都由要素本身决定。
 */
/**
 * 转化表（需求方 m06601 定稿）
 * ------------------------------------------------------------------
 * 「三种牌」（杀 / 树上开花 / 火烧连营）可以变成：
 *   自己造成的伤害 +1、奶自己 1 点、另外两种牌。
 * 「造成的伤害 +1」变成别的，等于伤害 −1，此时只能变成：
 *   奶自己 1 点。
 * 「体力值」（掉 1 点体力）可以变成：
 *   自己造成的伤害 +1、三种牌之一。
 *
 * heal 不是记录要素，而是「立刻回复 1 点体力」的一次性效果。
 */
export const DU_CONVERT = {
  sha: ['dmg', 'heal', 'flower', 'fire'],
  flower: ['dmg', 'heal', 'sha', 'fire'],
  fire: ['dmg', 'heal', 'sha', 'flower'],
  // 「造成的伤害 -1」不是在出牌阶段转化，而是造成伤害时「伤害 -1 并回复 1 点体力」
  dmg: [],
  hp: ['dmg', 'sha', 'flower', 'fire'],
};

/** 转化目标的显示名 */
const duDstLabel = (key) => (key === 'heal' ? '奶自己 1 点' : null);

export const DU_ELEMENTS = [
  { key: 'hp', label: '体力值', afterLabel: '体力上限' },
  { key: 'sha', label: '【杀】', cardKey: 'sha' },
  { key: 'dmg', label: '造成的伤害' },
  { key: 'flower', label: '【树上开花】', cardName: '树上开花' },
  { key: 'fire', label: '【火烧连营】', cardName: '火烧连营' },
];

/**
 * 该要素对应的牌堆键
 * ------------------------------------------------------------------
 * · 【杀】直接给键（sha）；
 * · 【树上开花】【火烧连营】还没进牌堆，按**中文牌名**在牌堆里找，
 *   用户补上这两张牌后自动生效，找不到就返回 null（该要素暂不可用）。
 */
function cardKeyOfElement(el) {
  if (!el) return null;
  if (el.cardKey) return CARDS[el.cardKey] ? el.cardKey : null;
  if (!el.cardName) return null;
  return Object.keys(CARDS)
    .find((k) => CARDS[k].name === el.cardName
      || CARDS[k].fullname === el.cardName) || null;
}

/** 该要素是否已经存在（③④ 两张牌可能还没进牌堆） */
function elementReady(el) {
  if (!el) return false;
  if (el.key === 'hp' || el.key === 'dmg') return true;
  return !!cardKeyOfElement(el);
}

/** 某要素当前的存量 */
export function duElementCount(player, key) {
  if (key === 'hp') return player.hp;
  if (key === 'maxhp') return player.maxHp;
  if (key === 'dmg') return player.storage.duCharge | 0;
  const el = DU_ELEMENTS.find((e) => e.key === key);
  const cardKey = cardKeyOfElement(el);
  if (!cardKey) return 0;
  return player.getCards('h', (c) => c.name === cardKey).length;
}

/** 消耗 1 点要素；返回是否成功 */
async function duTake(game, player, key) {
  if (key === 'hp') {
    await player.loseHp(1);
    return true;
  }
  if (key === 'maxhp') {
    if (player.maxHp <= 1) return false;
    player.maxHp -= 1;
    if (player.hp > player.maxHp) player.hp = player.maxHp;
    game.log(`【不朽纪行】${player.name} 失去 1 点体力上限（${player.hp}/${player.maxHp}）`);
    return true;
  }
  if (key === 'dmg') {
    if ((player.storage.duCharge | 0) <= 0) return false;
    player.storage.duCharge -= 1;
    return true;
  }
  const cardKey = cardKeyOfElement(DU_ELEMENTS.find((e) => e.key === key));
  if (!cardKey) return false;
  const cards = player.getCards('h', (c) => c.name === cardKey);
  if (!cards.length) return false;
  await player.discard([cards[0]]);
  return true;
}

/** 获得 1 点要素 */
async function duGive(game, player, key) {
  if (key === 'heal') {
    await player.recover(1);
    game.log(`【不朽纪行】${player.name} 回复 1 点体力（${player.hp}/${player.maxHp}）`);
    return true;
  }
  if (key === 'hp') {
    await player.recover(1);
    return true;
  }
  if (key === 'maxhp') {
    player.maxHp += 1;
    game.log(`【不朽纪行】${player.name} 恢复 1 点体力上限（${player.hp}/${player.maxHp}）`);
    return true;
  }
  if (key === 'dmg') {
    player.storage.duCharge = (player.storage.duCharge | 0) + 1;
    game.log(`【不朽纪行】${player.name} 蓄力 ${player.storage.duCharge} 点（下次造成伤害时生效）`);
    return true;
  }
  const el = DU_ELEMENTS.find((e) => e.key === key);
  const realKey = cardKeyOfElement(el);
  if (!realKey) return false;
  /*
   * 转化出来的牌是「虚拟牌」，但为了在牌桌上看得到花色点数，
   * 统一给它 ♠7 的外形（没有花色会显示成 "?0"）。
   */
  const c = new Card('spade', 7, realKey);
  c.virtual = true;
  await player.gain([c]);
  game.log(`【不朽纪行】${player.name} 获得了 ${el.label}`);
  return true;
}

/**
 * 「每轮每种首次参与转化时，再次触发此技能」
 * ------------------------------------------------------------------
 * 再次触发 = 再走一次「轮次开始时」的效果（摸 1 张牌）。
 * 修改技能后此条被删去。
 */
async function duTouch(game, player, key) {
  if (player.storage.duModified) return;
  const round = game.roundCount | 0;
  player.storage.duTouched = player.storage.duTouched || {};
  const rec = player.storage.duTouched;
  if (rec[key] === round) return;
  rec[key] = round;
  game.log(`【不朽纪行】${key}首次参与转化，再次触发本技能`);
  await player.draw(1);
  game.emit();
}

/** 当前记录项（转换技游标） */
export function duRecordIndex(player) {
  return (player.storage.duRecordIndex | 0) % DU_ELEMENTS.length;
}

/** 记录项的名称（修改技能后「体力值」变「体力上限」） */
export function duRecordLabel(player, index = duRecordIndex(player)) {
  const el = DU_ELEMENTS[index];
  if (!el) return '?';
  return player.storage.duModified ? (el.afterLabel || el.label) : el.label;
}

/** 要素名（受修改影响） */
function duLabel(player, key) {
  const el = DU_ELEMENTS.find((e) => e.key === key);
  if (!el) return key;
  if (key === 'hp' && player.storage.duModified) return el.afterLabel;
  return el.label;
}

const DU_BASE_DESC = '锁定技，转换技。记录：体力值。'
  + '轮次开始时，你摸1张牌并记录①【杀】②造成的伤害③【树上开花】④【火烧连营】'
  + '（并计入已死亡角色数）。你可以将记录的要素等量地任意转化；'
  + '每轮每种首次参与转化时，再次触发此技能。';

const DU_MOD_DESC = '锁定技，转换技。记录：体力上限。'
  + '轮次开始时，你失去1点体力上限并记录①【杀】②造成的伤害③【树上开花】④【火烧连营】'
  + '（并计入已死亡角色数）。你可以将记录的要素等量地任意转化。';

/** 转化规则的补充说明（写进技能描述，玩家右键能看到） */
const DU_CONVERT_DESC = '\n转化规则：三种牌（杀/树上开花/火烧连营）可换「伤害+1」「奶自己1」'
  + '或另外两种牌；「伤害+1」只能换「奶自己1」；「体力值」可换「伤害+1」或三种牌。';

/** 各技能描述：技能可被「周始」改写，所以 desc 支持函数形式 */
function duDesc(skill) {
  const base = skill.duModDesc || DU_BASE_DESC;
  return (player) => (player && player.storage && player.storage.duModified
    ? DU_MOD_DESC + DU_CONVERT_DESC
    : base + DU_CONVERT_DESC);
}

/* ============================================================
 * 技能
 * ============================================================ */

/**
 * 不朽纪行（主动）：出牌阶段把 1 点要素搬运成另 1 点要素
 * ------------------------------------------------------------------
 * 卡面写的是「锁定技，转换技，记录…。你可以将记录的要素等量地任意转化」，
 * 即：记录部分自动跑（见下面的 buxiujixing_round），转化部分是玩家手动发动的。
 * 因此把「转化」放在主技能上（会出按钮），记录作为 sub 触发器。
 */
const buxiujixing = {
  id: 'buxiujixing',
  name: '不朽纪行',
  desc: duDesc({}),
  type: 'active',
  trigger: 'phaseUse',
  usable: 99,
  zhuanhuanji: { options: DU_ELEMENTS.map((e) => e.label) },
  filter: (ctx) => DU_ELEMENTS.some((e) => elementReady(e)
    && duElementCount(ctx.player, e.key) > 0),
  async content(ctx) {
    const { game, player } = ctx;
    const sources = DU_ELEMENTS
      .filter((e) => elementReady(e) && duElementCount(player, e.key) > 0)
      .map((e) => ({ key: `src:${e.key}`, label: `${duLabel(player, e.key)}`
        + `（现有 ${duElementCount(player, e.key)}）` }));
    const pickSrc = await player.chooseOption({
      prompt: '【不朽纪行】选择一个要素作为转化源（消耗 1 点）',
      options: sources,
    });
    if (!pickSrc || !pickSrc.startsWith('src:')) return;
    const srcKey = pickSrc.slice(4);

    const pickDst = await player.chooseOption({
      prompt: `【不朽纪行】把 1 点${duLabel(player, srcKey)}转化为`,
      options: (DU_CONVERT[srcKey] || [])
        .filter((k) => k === 'heal' || elementReady(DU_ELEMENTS.find((e) => e.key === k)))
        .map((k) => ({ key: `dst:${k}`, label: duDstLabel(k) || duLabel(player, k) })),
    });
    if (!pickDst || !pickDst.startsWith('dst:')) return;
    const dstKey = pickDst.slice(4);

    if (!await duTake(game, player, srcKey)) return;
    await duGive(game, player, dstKey);
    game.log(`【不朽纪行】${player.name} 将 1 点${duLabel(player, srcKey)}`
      + `转化为 1 点${duLabel(player, dstKey)}`);
    await duTouch(game, player, srcKey);
    await duTouch(game, player, dstKey);
    game.emit();
  },
};

/** 不朽纪行·记录（锁定，轮次开始时自动跑） */
const buxiujixing_round = {
  id: 'buxiujixing_round',
  name: '不朽纪行·记录',
  sub: true,
  forced: true,
  type: 'trigger',
  trigger: 'turnStart',
  locked: true,
  /** 轮次开始时（roundCount 变化后的第一个回合开始） */
  filter(ctx) {
    const { game, player } = ctx;
    return (game.roundCount | 0) !== (player.storage.duRound | 0);
  },
  async content(ctx) {
    const { game, player } = ctx;
    player.storage.duRound = game.roundCount | 0;

    // ① 转换技推进一项（记录项循环）
    const n = DU_ELEMENTS.length;
    const idx = ((player.storage.duRecordIndex | 0) + 1) % n;
    player.storage.duRecordIndex = idx;
    game.log(`【不朽纪行】${player.name} 记录项推进到「${duRecordLabel(player, idx)}」`);

    // ② 轮次开始的效果：修改前摸 1 张，修改后失去 1 点体力上限
    if (player.storage.duModified) {
      if (player.maxHp > 1) {
        player.maxHp -= 1;
        if (player.hp > player.maxHp) player.hp = player.maxHp;
        game.log(`【不朽纪行】${player.name} 失去 1 点体力上限`
          + `（${player.hp}/${player.maxHp}）`);
      }
    } else {
      await player.draw(1);
    }

    // ③ 记录各要素的当前存量（计入已死亡角色数）
    const dead = game.players.filter((p) => !p.alive).length;
    const parts = DU_ELEMENTS
      .filter(elementReady)
      .map((e) => `${e.label}×${duElementCount(player, e.key)}`);
    game.log(`【不朽纪行】${player.name} 记录：${parts.join('、')}`
      + `（已死亡 ${dead} 名角色计入）`);

    // ④ 跑完一圈 → 周始：修改此技能
    if (idx === 0 && player.storage.duRoundAdvanced) {
      player.storage.duModified = true;
      game.log(`【不朽纪行】周始：${player.name} 的技能被修改`
        + `（记录项改为体力上限）`);
    }
    if (idx !== 0) player.storage.duRoundAdvanced = true;
    game.emit();
  },
};

/** 不朽纪行·伤害窗口（任意角色即将造成伤害时可转化，令伤害 ±1） */
const buxiujixing_shang = {
  id: 'buxiujixing_shang',
  name: '不朽纪行·伤害转化',
  sub: true,
  forced: true,
  type: 'trigger',
  trigger: 'damageBegin',
  scope: 'any',
  filter: (ctx) => {
    const ev = ctx.event;
    if (!ev || ev.prevented || ev.num <= 0) return false;
    // 手上有【杀】，或身上有蓄力，才能转化
    return duElementCount(ctx.player, 'sha') > 0
      || duElementCount(ctx.player, 'dmg') > 0;
  },
  async content(ctx) {
    const { game, player } = ctx;
    const ev = ctx.event;
    const useSha = duElementCount(player, 'sha') > 0;

    const pick = await player.chooseOption({
      prompt: `【不朽纪行】即将造成的 ${ev.num} 点伤害`
        + `（${ev.source ? ev.source.name : '?'} → ${ev.player ? ev.player.name : '?'}）`
        + '，是否转化要素令其 ±1？',
      options: [
        { key: 'up', label: '令伤害 +1' },
        { key: 'down', label: '令伤害 -1' },
        { key: 'no', label: '不发动' },
      ],
    });
    if (pick !== 'up' && pick !== 'down') return;

    const srcKey = useSha ? 'sha' : 'dmg';
    if (!await duTake(game, player, srcKey)) return;
    ev.num += pick === 'up' ? 1 : -1;
    if (ev.num < 1) ev.num = 1;
    if (pick === 'down') {
      // 「造成的伤害 -1」转换成「自己回复 1 点体力」
      game.log(`【不朽纪行】${player.name} 消耗 1 点${duLabel(player, srcKey)}，`
        + `令这次伤害变为 ${ev.num} 点，并回复 1 点体力`);
      await player.recover(1);
    } else {
      game.log(`【不朽纪行】${player.name} 消耗 1 点${duLabel(player, srcKey)}，`
        + `令这次伤害变为 ${ev.num} 点`);
    }
    await duTouch(game, player, srcKey);
    game.emit();
  },
};

/* ---------------- 入幻形态 ---------------- */

const HUAN_FORM = {
  name: '渡（入幻）',
  maxHp: 4,
  skills: [
    'yuankeguixu', 'yuankeguixu_cost',
    'mingyuntongxin_sheng', 'mingyuntongxin_sheng_tui',
  ],
};

/** 命运同心·朽：失救或进入命运回合时入幻 */
const mingyuntongxin_xiu = {
  id: 'mingyuntongxin_xiu',
  name: '命运同心·朽',
  desc: '锁定技，你拥有命运回合；你失救或进入命运回合时入幻，'
    + '重置武将状态与体力上限，并回复体力至X点（X为死亡角色数且至少为1）。',
  type: 'mod',
  locked: true,
  /** 引擎通过 hasDestinyTurn 读取 */
  mod: { destinyTurn: true },
};

/** 入幻触发 */
const mingyuntongxin_xiu_huan = {
  id: 'mingyuntongxin_xiu_huan',
  name: '命运同心·朽·入幻',
  sub: true,
  forced: true,
  type: 'trigger',
  trigger: 'turnStart',
  locked: true,
  filter: (ctx) => {
    const { player } = ctx;
    if (player.altForm === 'huan') return false;
    if (!player.skills.includes('mingyuntongxin_xiu')) return false;
    // 进入命运回合
    return !!ctx.game.isDestinyTurn;
  },
  async content(ctx) {
    await enterDuHuan(ctx.game, ctx.player, '进入命运回合');
  },
};

/** 失救时点也入幻 */
const mingyuntongxin_xiu_fail = {
  id: 'mingyuntongxin_xiu_fail',
  name: '命运同心·朽·失救',
  sub: true,
  forced: true,
  type: 'trigger',
  trigger: 'failedSave',
  locked: true,
  filter: (ctx) => ctx.player.altForm !== 'huan'
    && ctx.player.skills.includes('mingyuntongxin_xiu'),
  async content(ctx) {
    await enterDuHuan(ctx.game, ctx.player, '失救');
  },
};

/** 统一的入幻流程 */
async function enterDuHuan(game, player, reason) {
  if (player.altForm === 'huan') return false;
  const dead = game.players.filter((p) => !p.alive).length;
  const x = Math.max(1, dead);
  game.log(`【命运同心·朽】${player.name} ${reason}，入幻`
    + `（回复体力至 ${x} 点）`);
  await enterHuan(player, {
    name: HUAN_FORM.name,
    hp: x,
    maxHp: HUAN_FORM.maxHp,
    skills: HUAN_FORM.skills.slice(),
  });
  game.emit();
  return true;
}

/** 命运同心·生：离开命运回合时退幻 */
const mingyuntongxin_sheng = {
  id: 'mingyuntongxin_sheng',
  name: '命运同心·生',
  desc: '锁定技，你拥有命运回合；离开命运回合时你退幻，重置武将状态与体力上限，'
    + '若本轮有角色死亡，则回复所有体力。',
  type: 'mod',
  locked: true,
  mod: { destinyTurn: true },
};

const mingyuntongxin_sheng_tui = {
  id: 'mingyuntongxin_sheng_tui',
  name: '命运同心·生·退幻',
  sub: true,
  forced: true,
  type: 'trigger',
  trigger: 'turnEnd',
  locked: true,
  filter: (ctx) => ctx.player.altForm === 'huan' && !!ctx.game.isDestinyTurn,
  async content(ctx) {
    const { game, player } = ctx;
    const diedThisRound = game.players.filter((p) => !p.alive
      && (p.deathRound | 0) === (game.roundCount | 0)).length > 0;
    game.log(`【命运同心·生】${player.name} 离开命运回合，退幻`
      + (diedThisRound ? '（本轮有角色死亡，回复全部体力）' : ''));
    await exitHuan(player);
    if (diedThisRound) {
      await player.recover(player.maxHp - player.hp);
    }
    game.emit();
  },
};

/** 远客归墟：手牌当无次数限制的【杀】，造成伤害时自身体力上限 -1 */
const yuankeguixu = {
  id: 'yuankeguixu',
  name: '远客归墟',
  desc: '出牌阶段限一次，你可将1张手牌当作无次数限制、'
    + '造成伤害时自己体力上限-1的【杀】使用。'
    + '每有一名已死亡的角色须重复发动一次此技能。',
  type: 'active',
  trigger: 'phaseUse',
  usable: 1,
  filter: (ctx) => ctx.game.isInPlayPhase(ctx.player)
    && ctx.player.countCards('h') > 0,
  async content(ctx) {
    const { game, player } = ctx;
    const dead = game.players.filter((p) => !p.alive).length;
    // 「要发动就必须连续使用这么多次」
    const times = 1 + dead;
    for (let i = 0; i < times; i += 1) {
      if (!player.alive || game.over) return;
      if (player.countCards('h') <= 0) {
        game.log(`【远客归墟】${player.name} 没有手牌，停止发动`
          + `（已发动 ${i}/${times} 次）`);
        return;
      }
      const picked = await player.chooseCards({
        prompt: `【远客归墟】选择 1 张手牌当作【杀】使用`
          + `（第 ${i + 1}/${times} 次）`,
        position: 'h',
        min: 1,
        max: 1,
        cancelable: false,
      });
      const src = (picked && picked[0]) || null;
      if (!src) return;

      const card = new Card(src.suit, src.number, 'sha');
      card.virtual = true;
      card.sourceCards = [src];
      // 造成伤害时体力上限 -1
      card.duMaxHpCost = true;

      const targets = await game.pickTargetsForVirtual(player, card);
      if (!targets || !targets.length) return;
      await game.useCard(player, card, targets);
      if (!player.alive || game.over) return;
    }
  },
};

/**
 * 远客归墟·代价
 * ------------------------------------------------------------------
 * 那几张虚拟【杀】带 `duMaxHpCost` 标记：造成伤害后体力上限 -1。
 * 放在技能侧做，引擎不必认识具体武将。
 */
const yuankeguixu_cost = {
  id: 'yuankeguixu_cost',
  name: '远客归墟·代价',
  sub: true,
  forced: true,
  type: 'trigger',
  trigger: 'damageEnd',
  scope: 'source',
  locked: true,
  filter: (ctx) => {
    const ev = ctx.event;
    return !!(ev && ev.card && ev.card.duMaxHpCost && ev.source === ctx.player
      && ev.num > 0);
  },
  async content(ctx) {
    const { game, player } = ctx;
    if (player.maxHp <= 1) return;
    player.maxHp -= 1;
    if (player.hp > player.maxHp) player.hp = player.maxHp;
    game.log(`【远客归墟】${player.name} 造成伤害，体力上限 -1`
      + `（${player.hp}/${player.maxHp}）`);
    game.emit();
  },
};

export default {
  buxiujixing,
  buxiujixing_round,
  buxiujixing_shang,
  mingyuntongxin_xiu,
  mingyuntongxin_xiu_huan,
  mingyuntongxin_xiu_fail,
  mingyuntongxin_sheng,
  mingyuntongxin_sheng_tui,
  yuankeguixu,
  yuankeguixu_cost,
};

export { hasDestinyTurn, setDestinyTurn };
