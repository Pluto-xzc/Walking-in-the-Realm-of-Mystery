/**
 * 技能子程序 · 【业炎】
 * ==================================================================
 * 无名杀依据（`character/extra.js` 的 yeyan，限定技）：
 *   · 出牌阶段，选择至多三名角色，造成**共计至多 3 点**火焰伤害（任意分配）；
 *   · 若给某角色分配 2 点或更多，须先弃置**四张花色各不相同**的手牌。
 *
 * 本扩用法（武将【修己】）：把一次伤害结算改为「对结算中所有参与者发动一次业炎」，
 * 其中**以 4 次判定部分代替弃牌**：
 *   · 先判定 4 次，判定牌的花色算数；
 *   · 只补弃**缺少花色**的手牌；
 *   · 最终凑不齐 4 种花色 → 不弃牌，退回伤害分配，且不能再分配超出限制的伤害。
 *
 * 惩罚阈值（需求方裁定）：给原伤害的**造成者**分配 ≥3 点、或给**受到者**分配 ≥1 点，
 * 都要支付代价（即受害者 1 点就要付）；其余参与者阈值 2。
 */

import { SUITS } from '../cards.js';

/** 业炎的总伤害点数 */
export const YEYAN_TOTAL = 3;

const SUIT_KEYS = Object.keys(SUITS);

/**
 * 执行一次业炎
 * @param {Game} game
 * @param {Player} owner 发动者（造成伤害的来源）
 * @param {Player[]} participants 结算参与者（去重后作为可选目标池）
 * @param {{dealer?:Player, victim?:Player}} [ctx] 原伤害的造成者 / 受到者
 */
export async function runYeyan(game, owner, participants, ctx = {}) {
  const pool = [];
  for (const p of participants) if (p && p.alive && !pool.includes(p)) pool.push(p);
  if (!pool.length) return;

  const dealer = ctx.dealer || null;
  const victim = ctx.victim || null;
  const thresholdOf = (t) => (t === dealer ? 3 : t === victim ? 1 : 2);

  const chosen = await pickTargets(game, owner, pool);
  if (!chosen.length) return;

  let plan = await distribute(game, owner, chosen, thresholdOf, false);
  const needCost = plan.some(([t, n]) => n >= thresholdOf(t));

  if (needCost) {
    const paid = await paySuitCost(game, owner);
    if (!paid) {
      game.log('【业炎】判定与弃牌未能凑齐 4 种花色，'
        + '退回伤害分配（不能分配超出限制的伤害）');
      plan = await distribute(game, owner, chosen, thresholdOf, true);
    }
  }

  for (const [target, num] of plan) {
    await game.doDamage(target, num, owner, 'xiuji', null, 'fire');
  }
}

/** 选目标：至多三名，从参与者中选 */
async function pickTargets(game, owner, pool) {
  const max = Math.min(3, pool.length);
  if (pool.length === 1) return pool.slice();
  const got = await owner.chooseTargets({
    prompt: `【业炎】选择至多 ${max} 名角色（造成共计至多 ${YEYAN_TOTAL} 点火焰伤害）`,
    candidates: pool, min: 1, max,
  }).catch(() => null);
  const list = (got || []).filter((t) => pool.includes(t));
  return list.length ? list : pool.slice(0, max);
}

/**
 * 分配伤害点数
 * @param {boolean} restricted true = 不能分配超出限制（凑不齐花色时）
 * @returns {Promise<Array<[Player, number]>>}
 */
async function distribute(game, owner, chosen, thresholdOf, restricted) {
  /*
   * 凑不齐花色时「不能分配超出限制的伤害」：
   * 阈值 1 的角色连 1 点都不能分，因此直接不参与分配。
   */
  const list = restricted
    ? chosen.filter((t) => thresholdOf(t) - 1 >= 1)
    : chosen.slice();
  if (!list.length) {
    game.log('【业炎】受限制影响没有可分配伤害的角色');
    return [];
  }
  if (list.length !== chosen.length) {
    const skip = chosen.filter((t) => !list.includes(t)).map((t) => t.name);
    game.log(`【业炎】${skip.join('、')} 不能承受超出限制的伤害，不参与分配`);
  }

  const plan = list.map((t) => [t, 1]);
  let remain = YEYAN_TOTAL - list.length;

  while (remain > 0) {
    const options = [];
    plan.forEach(([t, n], i) => {
      const cap = restricted ? thresholdOf(t) - 1 : YEYAN_TOTAL;
      if (n >= cap) return;
      options.push({ key: String(i), label: `${t.name}（当前 ${n} 点）` });
    });
    if (!options.length) break;
    options.push({ key: 'stop', label: '不再分配' });
    const pick = await owner.chooseOption({
      prompt: `【业炎】还剩 ${remain} 点，分配给谁？`,
      options,
    }).catch(() => 'stop');
    if (!pick || pick === 'stop') break;
    const entry = plan[Number(pick)];
    if (!entry) break;
    entry[1] += 1;
    remain -= 1;
  }

  game.log(`【业炎】${owner.name} 分配：`
    + plan.map(([t, n]) => `${t.name} ${n} 点`).join('、'));
  return plan;
}

/**
 * 支付「4 张花色各不相同的手牌」的代价，以判定部分代替
 * @returns {Promise<boolean>} false = 最终凑不齐 4 种花色（不弃任何牌）
 */
async function paySuitCost(game, owner) {
  const have = new Set();
  for (let i = 0; i < 4; i++) {
    const res = await game.doJudge(owner, '业炎').catch(() => null);
    if (res && res.suit) have.add(res.suit);
    if (have.size >= 4) break;
  }
  game.log(`【业炎】判定花色：${[...have].map((s) => SUITS[s].label).join(' ') || '无'}`);

  while (have.size < 4) {
    const need = SUIT_KEYS.filter((s) => !have.has(s));
    const got = await owner.chooseCards({
      prompt: `【业炎】：弃置一张 ${need.map((s) => SUITS[s].label).join('/')} 花色的手牌`
        + '（放弃则退回伤害分配）',
      position: 'h', min: 1, max: 1, cancelable: true,
      filter: (c) => need.includes(c.suit),
    }).catch(() => null);
    const card = (got || [])[0];
    if (!card) return false;
    await owner.discard([card]);
    have.add(card.suit);
  }
  return true;
}
