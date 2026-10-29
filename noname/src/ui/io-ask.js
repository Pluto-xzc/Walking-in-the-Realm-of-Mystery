/**
 * UI 功能组：io-ask
 * 由 tools/split_ui.cjs 从旧 ui.js 切出；混入 UI 原型。
 * 本文件只包含方法定义，新增依赖请在文件顶部补 import。
 */

import { SKILLS } from '../skills.js';
import { skillDesc } from '../skills-util.js';

export default {

/**
 * 是否发动技能
 * ----------------------------------------------------------------
 * 规则（与无名杀一致，见 get.is.locked / content.js createTrigger）：
 *   - 必发效果（锁定技 / forced）**不询问**，直接发动。
 *   - 其余一律弹出确认框，且框内必须带上是哪个技能。
 *
 * 无名杀的判定顺序（get.is.locked，noname/get/is.js）：
 *   info.locked 为函数 → 用其返回值
 *   info.locked === false → 非锁定
 *   info.trigger && info.forced → 锁定（触发型必发）
 *   info.mod → 锁定（规则修改/永续效果）
 *   info.locked 其余真值 → 锁定
 *
 * 本项目对应：skill.locked / skill.forced / type === 'mod'。
 */
isSkillForced(skill) {
  if (!skill) return false;
  if (typeof skill.locked === 'function') return !!skill.locked();
  if (skill.locked === false) return false;
  if (skill.forced) return true;
  if (skill.trigger && skill.forced) return true;
  if (skill.type === 'mod') return true;
  return !!skill.locked;
},

async askSkill(player, skill, ctx) {
  if (!player.isHuman) {
    await this.aiPause();       // AI 思考停顿，避免瞬间结算看不清
    return this.game.ai.decideSkill(player, skill, ctx);
  }
  // 必发效果直接生效，不询问
  if (this.isSkillForced(skill)) return true;

  // 确认框写明「是哪个技能」并附上该技能的**描述**。
  // 描述单独成行：技能描述常常很长，挤在括号里会把标题行拉得很宽、
  // 也不好读。用 \n 分成两行，由 CSS 的 white-space: pre-line 呈现。
  //
  //   是否发动【奸雄】？
  //   当你受到伤害后，你可以获得对你造成伤害的牌。
  const desc = skillDesc(skill).trim();
  const prompt = desc
    ? `是否发动【${skill.name}】？\n${desc}`
    : `是否发动【${skill.name}】？`;
  const use = await this.chooseOption(player, prompt, [
    { key: 'yes', label: '发动' },
    { key: 'no', label: '不发动' },
  ], { skill });
  return use === 'yes';
},

/**
 * 濒死求救
 */
async confirmDying(saver, dying, viaSkill, count) {
  if (!saver.isHuman) return this.game.ai.shouldSave(saver, dying);
  const label = viaSkill ? `${SKILLS[viaSkill].name}（红色牌当桃）` : '桃';
  const r = await this.chooseOption(saver,
    `${dying.name} 濒死，是否使用【${label}】救助？（你有 ${count} 张可选）`,
    [{ key: 'yes', label: '救' }, { key: 'no', label: '不救' }]);
  return r === 'yes';
},

/** 八卦阵 */
async askBagua(player) {
  if (!player.isHuman) return true;
  const r = await this.chooseOption(player, '是否发动【八卦阵】进行判定？',
    [{ key: 'yes', label: '发动' }, { key: 'no', label: '不发动' }]);
  return r === 'yes';
},

/** 无懈可击 */
async askWuxie(player, source, card, currentlyNullified) {
  if (!player.isHuman) return this.game.ai.shouldWuxie(player, source, card, currentlyNullified);
  const action = currentlyNullified ? '反抵消' : '抵消';
  const r = await this.chooseOption(player,
    `${source.name} 使用了【${card.fullname}】，是否使用【无懈可击】${action}？`,
    [{ key: 'yes', label: `使用无懈（${action}）` }, { key: 'no', label: '不使用' }]);
  return r === 'yes';
},

/** 决斗中的杀 */
async askShaForJuedou(player, game) {
  return false; // 由 engine.askSha 处理
}
};
