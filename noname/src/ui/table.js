/**
 * UI 功能组：table
 * 由 tools/split_ui.cjs 从旧 ui.js 切出；混入 UI 原型。
 * 本文件只包含方法定义，新增依赖请在文件顶部补 import。
 */













/* === 依赖（由 tools/fix_ui_imports.cjs 生成）=== */
import { $, el, resolveHomeHref } from '../ui-helpers.js';

export default {

/* ---------------- 牌桌骨架 ---------------- */
buildTable() {
  if ($('#sgs-table')) return;
  const table = el('div', '');
  table.id = 'sgs-table';
  table.innerHTML = `
    <div class="sgs-topbar">
      <button class="sgs-icon-btn" id="sgs-settings-btn" title="界面设置">⚙ 设置</button>
      <span class="sgs-topbar-title font-title">三国杀 · 身份模式</span>
      <button class="sgs-icon-btn" id="sgs-toggle-center">中央区</button>
      <button class="sgs-icon-btn" id="sgs-toggle-pile">弃牌堆</button>
      <button class="sgs-icon-btn" id="sgs-toggle-log">日志</button>
      <button class="sgs-icon-btn" id="sgs-restart">重新开始</button>
      <a class="sgs-icon-btn sgs-home-btn" id="sgs-home" href="/" title="返回主站">← 返回主站</a>
      <span class="sgs-topbar-info" id="sgs-topbar-info"></span>
    </div>
    <div class="sgs-board">
      <div class="sgs-opponents" id="sgs-opponents"></div>
      <!--
        注意：这里**不要**再放 id="sgs-prompt"。
        提示条只有一个，位于自己区域内、紧贴手牌区上端
        （见下方 .sgs-self 里的同名 class 元素）。
        历史上这里曾有一个副本，导致 document.getElementById('sgs-prompt')
        取到的是屏幕中央这一份，提示框因此「飘」在牌桌中间而不是手牌上方。
      -->
      <div class="sgs-center"></div>
      <div class="sgs-log-panel" id="sgs-log"></div>
      <div class="sgs-pile-panel hidden" id="sgs-pile"></div>
      <div class="sgs-pile-panel hidden" id="sgs-center-panel"></div>
    </div>
    <div class="sgs-self" id="sgs-self">
      <!--
        自己区域的 DOM 顺序（从上到下即为视觉顺序）：
          ① 头像 + 名字 + 身份 + 技能按钮 + 体力/护甲文字
          ② 结束回合按钮（在武将信息**下方**、手牌**上方**）
          ③ 提示条
          ④ 操作按钮（确定/取消等）
          ⑤ 手牌区（贴紧屏幕底部）
          ⑥ 装备区
          ⑦ 接续信息（判定牌 / 横置 / token）—— 放在最下面不抢视线
      -->
      <div class="sgs-self-top">
        <div class="sgs-self-avatar" id="sgs-self-avatar"></div>
        <div class="sgs-self-info">
          <div class="sgs-self-name-row">
            <span class="sgs-self-name" id="sgs-self-name"></span>
            <span class="sgs-self-identity" id="sgs-self-identity"></span>
          </div>
          <!--
            体力/护甲行 + 接续信息（判定牌 / 横置 / token）同行显示。
            这两块内容都很短，放同一行可以省下一整行高度，
            让整个自己区域更紧凑、更靠近手牌。
          -->
          <div class="sgs-self-stat-row">
            <div class="sgs-self-stat" id="sgs-self-stat"></div>
            <div class="sgs-self-extras" id="sgs-self-extras"></div>
          </div>
          <!-- 技能按钮：可点击发动 -->
          <div class="sgs-skill-btns" id="sgs-self-skills"></div>
        </div>
        <!--
          选项按钮区 + 选牌提示条：位于武将信息**右侧**的空白处。
          名字/体力之后的横向空白用来放「发动 / 不发动」「确定 / 取消」
          这类按钮，既填满了空位，又不遮挡下方的装备栏。
        -->
        <div class="sgs-self-right" id="sgs-self-right">
          <div class="sgs-self-info-actions" id="sgs-self-info-actions"></div>
          <!--
            选牌/选目标提示条
            ----------------------------------------------------------
            ⚠️ 历史问题：它原本是 position:fixed 贴在屏幕底部，
            正好**压住装备区**（武器/防具/坐骑全被挡住）。
            现在改成普通文档流元素，放在武将信息右侧的空位上，
            既不遮挡装备栏，也不额外占高度。
          -->
          <div class="sgs-select-hint" id="sgs-select-hint">
            <div class="hint-text" id="sgs-hint-text"></div>
            <div class="hint-btns">
              <button class="sgs-act-btn primary" id="sgs-hint-ok">确 定</button>
              <button class="sgs-act-btn" id="sgs-hint-cancel">取 消</button>
            </div>
          </div>
        </div>
      </div>

      <!-- 结束回合按钮：独立一行，位于武将信息下方 -->
      <div class="sgs-endturn-row" id="sgs-endturn-row"></div>

      <!-- 出牌阶段的临时按钮行（如【重铸】） -->
      <div class="sgs-recast-row" id="sgs-recast-row"></div>

      <!--
        提示条与操作按钮：紧贴手牌区上端。
        .sgs-prompt 通过 CSS 的 margin-top:auto 被推到手牌正上方。
      -->
      <div class="sgs-prompt hidden" id="sgs-prompt"></div>
      <div class="sgs-actions" id="sgs-actions"></div>

      <!-- 手牌区：贴紧屏幕底部 -->
      <div class="sgs-self-hand" id="sgs-self-hand"></div>
      <div class="sgs-self-equips" id="sgs-self-equips"></div>
    </div>
  `;
  document.body.appendChild(table);

  // 竖屏遮罩：手机上强制横屏，避免布局错乱
  this.buildOrientationOverlay();

  // 选将弹窗
  const modal = el('div', 'sgs-modal');
  modal.id = 'sgs-char-modal';
  modal.appendChild(el('div', 'sgs-modal-box'));
  document.body.appendChild(modal);

  // 结算弹窗
  const result = el('div', 'sgs-modal');
  result.id = 'sgs-result-modal';
  result.appendChild(el('div', 'sgs-modal-box'));
  document.body.appendChild(result);

  // 观星式排列面板（牌堆顶 / 牌堆底 两栏）
  const arrange = el('div', 'sgs-arrange');
  arrange.id = 'sgs-arrange';
  arrange.innerHTML = `
    <div class="sgs-arrange-inner">
      <div class="sgs-arrange-title">调整牌的顺序</div>
      <div class="sgs-arrange-body" id="sgs-arrange-body"></div>
      <div class="sgs-arrange-btns" id="sgs-arrange-btns"></div>
    </div>
  `;
  document.body.appendChild(arrange);
},

bindGlobal() {
  document.addEventListener('click', (e) => {
    if (e.target.id === 'sgs-settings-btn') {
      this.toggleSettings();
    }
    if (e.target.id === 'sgs-toggle-log') {
      $('#sgs-log').classList.toggle('hidden');
    }
    if (e.target.id === 'sgs-toggle-pile') {
      const pile = $('#sgs-pile');
      const center = $('#sgs-center-panel');
      if (center) center.classList.add('hidden');
      pile.classList.toggle('hidden');
      if (!pile.classList.contains('hidden')) this.renderDiscardPile();
    }
    if (e.target.id === 'sgs-toggle-center') {
      const center = $('#sgs-center-panel');
      const pile = $('#sgs-pile');
      if (pile) pile.classList.add('hidden');
      center.classList.toggle('hidden');
      if (!center.classList.contains('hidden')) this.renderCenterPanel();
    }
    if (e.target.id === 'sgs-restart') {
      if (confirm('确定要重新开始一局吗？')) {
        location.reload();
      }
    }
  });

  // 「返回主站」：从当前页面路径推导站点根
  const home = document.getElementById('sgs-home');
  if (home) home.href = resolveHomeHref();

  // 窗口尺寸变化 → 对手弧形分布要重排
  if (!this._resizeBound) {
    this._resizeBound = true;
    window.addEventListener('resize', () => {
      if (typeof this.layoutOpponents === 'function') this.layoutOpponents();
    });
  }
},

/* ---------------- 引擎 io 接口 ---------------- */
/** 由 match.js 注入 game 后调用 */
attach(game) {
  this.game = game;
  game.io = this;
  // 用合并渲染，避免高频 emit 造成头像闪烁
  game.onUpdate = () => this.scheduleRender();
},

async showSplashForGame() {
  // 引擎内部调用，此处无操作（开屏由外部控制）
},

sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}
};
