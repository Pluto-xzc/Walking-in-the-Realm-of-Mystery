/**
 * 技能辅助：util
 * 技能实现中复用的自由函数
 * 由 tools/split_skills.cjs 从旧 skills.js 切出。
 */

import { SKILLS } from '../skills.js';

/** 技能显示名（用于日志） */
export function skillName(id) {
  return (SKILLS[id] && SKILLS[id].name) || id;
}
