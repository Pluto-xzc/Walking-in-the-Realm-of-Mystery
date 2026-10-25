/**
 * 技能表（barrel）
 * ------------------------------------------------------------------
 * 旧 skills.js 是「一个 1400 行的大对象 + 若干自由函数」。
 * 现按用途拆分到 ./skills/ 下（见 tools/split_skills.cjs）：
 *   table-standard.js   标准武将技（41 个）
 *   table-equip.js      装备技（16 个）
 *   table-expansion.js  本扩武将技（8 个）
 *   lumioer.js          璐米欧儿：金银合纵 / 黑白乱舞 / 界乱击
 *   beishui.js          背水相关：canBeishuiNow / consumeBeishui / askBeishui / qinjianOptions
 *   qianxing.js         前行的决心：muniuCards / resolveQianxing / noteSuitUsed 等
 *   util.js             skillName
 *
 * 对外导出名与旧版完全一致（SKILLS / 各具名函数 / default），
 * 因此 engine.js、ui.js 与全部测试脚本都无需改动。
 */
import standard from './skills/table-standard.js';
import equip from './skills/table-equip.js';
import expansion from './skills/table-expansion.js';
import lumioer from './skills/lumioer.js';

/* 三张表合成同一个 SKILLS 对象：合并顺序不影响语义（键名互不重叠，
 * 若要排查某技能来自哪张表，看它属于武将技 / 装备技 / 本扩技即可）。 */
export const SKILLS = { ...standard, ...equip, ...expansion, ...lumioer };

export { canBeishuiNow, consumeBeishui, askBeishui, qinjianOptions } from './skills/beishui.js';
export { muniuCards, runZhouShiEffect, resolveQianxing, noteSuitUsed } from './skills/qianxing.js';
export { skillName } from './skills/util.js';

export default SKILLS;