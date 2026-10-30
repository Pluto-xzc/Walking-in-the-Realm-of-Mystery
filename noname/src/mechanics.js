/**
 * 扩展机制（本扩新增 + 官方机制扩展）—— 聚合层
 * ==================================================================
 * 实现已按机制域拆分到 src/mechanics/ 下的 12 个文件，本文件只做 re-export。
 * 这样 `import { x } from '../src/mechanics.js'` 和命名空间导入
 * （import * as M）仍然能拿到全部 154 个导出，既有引擎代码与 26 个测试脚本零改动。
 *
 * 设计原则：
 *   ① 一切以无名杀为准（官方机制），语义取自无名杀源码行为；无名杀为 GPL-3.0，
 *      因此只理解语义、不复制代码，全部为洁净室重写。
 *   ② 自创机制在各自文件的注释里标注「本项目扩展 / 本项目新增」。
 *   ③ 所有机制都以可选开关/技能字段形式提供：未声明的技能行为完全不变。
 *
 * 子文件一览（按机制序号 A–AK 顺序）：
 *   · state.js     A–D  昂扬技 / 背水 / 卜算X / 乘势
 *   · zones.js     E–F  除外 / 点燃
 *   · detach.js    G–J  调离 / 额定回合 / 附魔 / 分发
 *   · slots.js     K–L  废除 / 发现
 *   · cards.js     M–P  横置牌 / 即时牌 / 连招技 / 酩酊
 *   · reveal.js    Q–U  明置 / 命运回合 / 否极技 / 契定技 / 熔铸
 *   · forms.js     V–Y  仁区 / 入幻入魔 / 施法 / 失救
 *   · inquiry.js   Z–AB 体力变化 / 调整 / 跳过询问
 *   · xumou.js     AC–AD 蓄谋 / 隐匿
 *   · yunlv.js     AE–AF 韵律技 / 溢出体力
 *   · convert.js   AG–AI 转化 / 周始 / 阵法技
 *   · occupy.js    AJ–AK 智囊牌 / 占用
 *   · change.js    AL     一次性变动拦截（破惘长行）
 *
 * 注意：这些子文件彼此无静态依赖，也不 import 任何其它模块 —— 所有依赖
 * （game / player / CARDS / SKILLS）都由调用方以参数传入。
 */

export * from './mechanics/state.js';
export * from './mechanics/zones.js';
export * from './mechanics/detach.js';
export * from './mechanics/slots.js';
export * from './mechanics/cards.js';
export * from './mechanics/reveal.js';
export * from './mechanics/forms.js';
export * from './mechanics/inquiry.js';
export * from './mechanics/xumou.js';
export * from './mechanics/yunlv.js';
export * from './mechanics/convert.js';
export * from './mechanics/occupy.js';
export * from './mechanics/change.js';
export * from './mechanics/poison.js';
export * from './mechanics/preach.js';

/*
 * default 导出：历史上 mechanics.js 的默认导出是一个包含全部函数的大对象，
 * 保持同样的形状（命名空间对象即该大对象）以免破坏 `import M from` 的用法。
 */
import * as all from './mechanics/index.js';
export default all;
