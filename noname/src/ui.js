/**
 * 界面渲染与交互（barrel）
 * ------------------------------------------------------------------
 * 实现体已按功能组拆到 ./ui/ 下（见 tools/split_ui.cjs）：
 *   ui-helpers.js   DOM helper / 资源路径 / 图片回退（公共工具）
 *   ui-main.js      UI 类的构造与混入
 *   ui/splash.js    开屏、开源声明、模式/身份/武将选择
 *   ui/table.js     建桌、全局事件、挂接 game
 *   ui/render-main.js / render-self.js / detail.js  牌桌、自己面板、详情弹窗
 *   ui/nodes.js     玩家节点、目标选择、提示条
 *   ui/io-cards.js / io-ask.js / io-arrange.js  引擎回调（选牌/选目标/询问/整理）
 *   ui/skill-ui.js  技能按钮、背水、身份标记、收藏
 *   ui/result.js    结算画面
 *
 * 本文件保持原有导出名不变，外部（main.js / 测试）无需改动。
 */
export {
  charImgPath,
  charFallbackPath,
  cardImagePath,
  tableBgPath,
  resolveHomeHref,
  bindImageFallback,
} from './ui-helpers.js';

export { UI, default } from './ui-main.js';