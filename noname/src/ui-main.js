/**
 * 界面渲染与交互
 * ------------------------------------------------------------------
 * 负责：
 *   - 渲染牌桌、玩家、手牌
 *   - 提供引擎所需的 io 接口（选牌 / 选目标 / 确认）
 *   - 开屏开源声明与资源加载
 */

import { CARDS, numberLabel, SUITS, EQUIP_SLOTS, EQUIP_SLOT_MAP } from './cards.js';
import { CHARACTERS, GROUPS, PACKS, packOf, pickerTabs } from './characters.js';
import { SKILLS } from './skills.js';
import { IDENTITY_LABEL, IDENTITY_COLOR, CHOICE_NUM } from './match.js';

import splash from './ui/splash.js';
import table from './ui/table.js';
import renderMain from './ui/render-main.js';
import detail from './ui/detail.js';
import skillUi from './ui/skill-ui.js';
import nodes from './ui/nodes.js';
import renderSelf from './ui/render-self.js';
import ioCards from './ui/io-cards.js';
import ioAsk from './ui/io-ask.js';
import ioArrange from './ui/io-arrange.js';
import result from './ui/result.js';
import settings from './ui/settings.js';
import targetLine from './ui/target-line.js';

/* UI 的实现体按功能组切分在 ./ui/ 下（见 tools/split_ui.cjs），
 * 这里只保留构造与混入，方法查找仍走原型链，UI 的对外身份不变。 */
export class UI {
  constructor() {
    this.game = null;
    this.selectedCards = new Set();
    this.selectedTargets = [];
    this.resolver = null;
    this.mode = null;          // 'cards' | 'targets' | 'action' | 'confirm' | 'arrange'
    this.promptText = '';
    this.config = {};
    /**
     * 身份标记（玩家自己的推测）
     * ------------------------------------------------------------------
     * 键为 player.id，值为 'zhu' | 'zhong' | 'fan' | 'nei'。
     * 纯本地记录，**不影响任何规则判定**，仅供玩家自己推理用。
     * 角色死亡后会公开真实身份，此时自动清除该标记。
     */
    this.identityMarks = {};
    /** 收藏的武将（localStorage 持久化） */
    this.favorites = this.loadFavorites();
    /** 界面设置（缩放 / 面板尺寸 / AI 延迟 …，localStorage 持久化） */
    this.settings = this.loadSettings();
  }

  /* ---------------- 生命周期 ---------------- */
  init() {
    this.ensureSplash();
    this.buildTable();
    this.buildSettingsPanel();
    this.bindGlobal();
    this.applySettings();
  }
}

Object.assign(
  UI.prototype,
  splash,
  table,
  renderMain,
  detail,
  skillUi,
  nodes,
  renderSelf,
  ioCards,
  ioAsk,
  ioArrange,
  result,
  settings,
  targetLine,
);

export default UI;
