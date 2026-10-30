/**
 * 技能表（barrel）
 * ------------------------------------------------------------------
 * 按**用途**切分到 ./skills/ 下，一个用途一个文件，不按单个武将拆：
 *   table-standard.js   标准武将技
 *   table-equip.js      装备技
 *   table-expansion.js  本扩（自研）武将技 —— 含璐米欧儿的金银合纵等
 *   beishui.js          背水：canBeishuiNow / consumeBeishui / askBeishui / qinjianOptions
 *   qianxing.js         前行的决心：muniuCards / resolveQianxing / noteSuitUsed 等
 *   util.js             skillName
 *
 * 对外导出名与旧版完全一致（SKILLS / 各具名函数 / default），
 * 因此 engine.js、ui.js 与全部测试脚本都无需改动。
 */
import standard from './skills/table-standard.js';
import equip from './skills/table-equip.js';
import expansion from './skills/table-expansion.js';
import mo from './skills/table-mo.js';
import ao from './skills/table-ao.js';
import tongbao from './skills/table-tongbao.js';
import guan from './skills/table-guan.js';
import zhoue from './skills/table-zhou.js';

/* 七张表合成同一个 SKILLS 对象：合并顺序不影响语义（键名互不重叠）。 */
export const SKILLS = {
  ...standard, ...equip, ...expansion, ...mo, ...ao, ...tongbao, ...guan, ...zhoue,
};

export { canBeishuiNow, consumeBeishui, askBeishui, qinjianOptions } from './skills/beishui.js';
export { muniuCards, runZhouShiEffect, resolveQianxing, noteSuitUsed } from './skills/qianxing.js';
export { skillName } from './skills/util.js';

export default SKILLS;
