/**
 * 核心引擎：牌堆、玩家、事件、回合流程
 * ------------------------------------------------------------------
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

/**
 * 牌所在区域（zone）的权威定义
 * ------------------------------------------------------------------
 * 统一用这里的常量，避免出现「一处写 'processing'、另一处写 'center'」
 * 这类字符串漂移（曾导致【奸雄】永不触发）。
 *
 *   deck      牌堆
 *   hand      手牌
 *   equip     装备区
 *   judge     判定区
 *   center    中央区（本回合处理区，同时算弃牌堆的一部分）
 *   discard   弃牌堆
 *   flying    临时态：刚从牌堆取出、尚未落入任何区域的牌
 */
export const ZONE = {
  DECK: 'deck',
  HAND: 'hand',
  EQUIP: 'equip',
  JUDGE: 'judge',
  CENTER: 'center',
  DISCARD: 'discard',
  FLYING: 'flying',
};

/** 这些区域的牌可被「获得/拿走」类效果取用 */
export const OBTAINABLE_ZONES = [
  ZONE.HAND, ZONE.EQUIP, ZONE.JUDGE, ZONE.CENTER, ZONE.DISCARD,
];

/** 槽位 short 名，用于日志 */
export const EQUIP_SLOT_MAP_SHORT = {
  equip1: '武器', equip2: '防具', equip5: '宝物', equip4: '进攻马', equip3: '防御马',
};

/** 身份中文名（日志用，避免循环依赖 match.js） */
export const IDENTITY_NAME = { zhu: '主公', zhong: '忠臣', fan: '反贼', nei: '内奸' };

let uid = 0;
export const nextId = () => ++uid;
