/**
 * 技能辅助：beishui
 * 技能实现中复用的自由函数
 * 由 tools/split_skills.cjs 从旧 skills.js 切出。
 */

import { SKILLS } from '../skills.js';

/**
 * 「若你反面向上，下次发动技能你可背水」
 * ==================================================================
 * 需求方澄清：
 *   「是发给你一次**背水**的机会，就是给一技能扣减体力后的那个
 *     转换技操控的 ①②，可以直接全选，不转换项用的，
 *     白金磷子就这一个可能背水的地方。」
 * 后续补充：
 *   「背水可以加个按钮，让玩家选择**是否自行背水**。」
 *
 * 即：**反面向上**时，一技能【怯懦的琴键】那对转换技（①/②）
 * 在下一次发动时**获得一次「背水」的机会** ——
 * 玩家可以**自己选择**是否背水：
 *   · 背水 → 直接把 ①② 全选执行；
 *   · 不背水 → 按转换技规则只执行当前那一项。
 *
 * 注意：这是**一次性的机会**，玩家做出选择后即消耗掉
 *（由 finishBeishuiChoice 记录）。
 *
 * @returns {boolean} 是否处于「背水」可选状态
 */
export function canBeishuiNow(player) {
  if (!player || !player.isTurnedOver) return false;
  // 已经在本回合用掉这次机会 → 不再提供
  const tc = player.game ? player.game.turnCount : player.turnSeq;
  if (player.storage && player.storage.beishuiUsedFor === tc) {
    return false;
  }
  return true;
}

/**
 * 消耗掉本次「背水」机会
 * ------------------------------------------------------------------
 * 无论玩家选了背水还是不背水，这次机会都用掉了。
 */
export function consumeBeishui(player) {
  if (!player) return;
  player.storage = player.storage || {};
  player.storage.beishuiUsedFor = player.game
    ? player.game.turnCount : player.turnSeq;
}

/**
 * 询问玩家是否使用「背水」
 * ------------------------------------------------------------------
 * @returns {Promise<boolean>} true = 背水（①② 全选）
 */
export async function askBeishui(player, game) {
  if (!canBeishuiNow(player)) return false;
  const all = (SKILLS.qienuodeqinjian.zhuanhuanji.options || []).slice();
  const g = game || player.game;

  // AI：反面向上时默认选择背水（全选通常更强）
  if (!player.isHuman) {
    const want = true;
    consumeBeishui(player);
    if (g) g.log(`${player.name} 选择背水（${all.join('+')} 全选）`);
    return want;
  }

  const r = await g.io.chooseOption({
    prompt: `【怯懦的琴键】：你反面向上，是否使用「背水」？`
      + `\n背水＝直接把 ${all.join('、')} 全部执行（平常须二选一）`,
    options: ['背水', '不背水'],
  }).catch(() => '不背水');

  const yes = (r === '背水' || r === 'yes');
  consumeBeishui(player);
  if (g) {
    g.log(`${player.name} ${yes ? '使用' : '放弃'}背水`
      + `${yes ? `（${all.join('+')} 全选）` : ''}`);
  }
  return yes;
}

/**
 * 一技能（【怯懦的琴键】）转换技的选项列表
 * ------------------------------------------------------------------
 * @param {Player} player
 * @param {boolean} [beishui] 是否已确认背水。
 *        只有显式传 true 才返回全部选项 —— 这样「背水」一定是
 *        **玩家自己选出来**的，而不是反面向上就自动全选。
 */
export function qinjianOptions(player, beishui = false) {
  const skill = SKILLS.qienuodeqinjian;
  if (!skill || !skill.zhuanhuanji) return [];
  const all = skill.zhuanhuanji.options.slice();
  if (beishui) {
    // 背水：直接全选
    if (player.game) {
      player.game.log(`${player.name} 发动背水，`
        + `【怯懦的琴键】全选 ${all.join('/')}`);
    }
    return all;
  }
  const idx = ((player.storage && player.storage.zhuanhuanji_qienuodeqinjian) | 0)
    % all.length;
  return [all[idx]];
}
