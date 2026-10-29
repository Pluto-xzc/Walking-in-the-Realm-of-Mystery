/**
 * 核心引擎：牌堆、玩家、事件、回合流程 —— 聚合层
 * ------------------------------------------------------------------
 * 实现已拆分到 src/engine/ 下，本文件负责组装并对外导出：
 *
 *   zones.js     ZONE / OBTAINABLE_ZONES 等常量与共享小工具
 *   card.js      Card 类
 *   player.js    Player 类
 *   game.js      Game 类的构造函数与静态成员
 *   g-core.js    Game 方法集：区域与牌堆
 *   g-skill.js   Game 方法集：技能时机与使用限制
 *   g-damage.js  Game 方法集：伤害 / 濒死 / 死亡 / 判定
 *   g-turn.js    Game 方法集：回合流程
 *   g-play.js    Game 方法集：出牌与装备
 *   g-resolve.js Game 方法集：牌与技能结算
 *
 * Game 的方法集以「普通对象 + Object.assign 混入原型」的方式组装，
 * 目的是让 `class Game` 始终只有一个身份：new Game() 与 instanceof Game
 * 的行为和拆分前完全一致（match.js 与测试脚本都依赖这两点）。
 *
 * 设计对齐无名杀的核心概念，但大幅简化：
 *   - 事件（Event）：一次结算单元，含时机触发
 *   - 时机（timing）：damageBegin / damageEnd / judgeBefore ...
 *   - 异步：全部用 async/await，等待玩家输入即为 await
 *
 * 与无名杀的关键差异（有意为之）：
 *   - 不做步骤数组（step 机），统一用 async 函数
 *   - 不做 Promise 队列代理，直接用 await
 *   - 状态显式建模，便于调试与重放
 */

import { Game } from './engine/game.js';
import core from './engine/g-core.js';
import skill from './engine/g-skill.js';
import damage from './engine/g-damage.js';
import turn from './engine/g-turn.js';
import play from './engine/g-play.js';
import resolve from './engine/g-resolve.js';
import resolveExtra from './engine/g-resolve-extra.js';
import resolveRotation from './engine/g-resolve-rotation.js';

/* 把各职责模块的方法挂到 Game.prototype 上。顺序无关：方法名互不重叠。 */
Object.assign(Game.prototype, core, skill, damage, turn, play, resolve, resolveExtra,
  resolveRotation);

export { ZONE, OBTAINABLE_ZONES } from './engine/zones.js';
export { Card } from './engine/card.js';
export { Player } from './engine/player.js';
export { Game };
