/**
 * UI 功能组：settings
 * ------------------------------------------------------------------
 * 左上角的「设置」面板。所有改动立刻生效，并写入 localStorage。
 *
 * 可调项：
 *   · 整体缩放   —— 整个牌桌（含文字、卡牌、面板）等比缩放
 *   · 日志框     —— 宽 / 最大高
 *   · AI 行动延迟 —— 开关 + 随机区间（默认 0.8~2.0 秒）
 *   · 动画开关   —— 黄线指向、脉冲等效果，关掉更省性能
 */
import { $, el } from '../ui-helpers.js';

const STORE_KEY = 'sgs_settings';

/** 默认值（也是「恢复默认」用的那一份） */
export const DEFAULT_SETTINGS = {
  uiScale: 1,          // 0.8 ~ 1.4
  logWidth: 260,       // px
  logHeight: 30,       // vh
  aiDelayOn: true,
  aiDelayMin: 800,     // ms
  aiDelayMax: 2000,    // ms
  animate: true,
  arcLayout: true,     // 对手弧形分布
};

/** 面板上的控件定义：id → { label, min, max, step, unit, apply } */
const CONTROLS = [
  { key: 'uiScale', label: '整体缩放', min: 0.8, max: 1.4, step: 0.05, fmt: (v) => `${Math.round(v * 100)}%` },
  { key: 'logWidth', label: '日志框宽', min: 150, max: 420, step: 10, fmt: (v) => `${v}px` },
  { key: 'logHeight', label: '日志框高', min: 10, max: 60, step: 2, fmt: (v) => `${v}vh` },
  { key: 'aiDelayMin', label: 'AI 延迟下限', min: 0, max: 2000, step: 100, fmt: (v) => `${v}ms` },
  { key: 'aiDelayMax', label: 'AI 延迟上限', min: 200, max: 4000, step: 100, fmt: (v) => `${v}ms` },
];

const TOGGLES = [
  { key: 'aiDelayOn', label: 'AI 行动延迟' },
  { key: 'animate', label: '动画效果' },
  { key: 'arcLayout', label: '对手弧形分布' },
];

export default {

  /** 读设置（坏数据一律回落到默认值） */
  loadSettings() {
    const base = { ...DEFAULT_SETTINGS };
    try {
      const raw = localStorage.getItem(STORE_KEY);
      if (!raw) return base;
      const saved = JSON.parse(raw);
      for (const k of Object.keys(base)) {
        if (typeof saved[k] === typeof base[k]) base[k] = saved[k];
      }
    } catch (e) {
      // localStorage 不可用（隐私模式 / file://）时静默用默认值
    }
    return base;
  },

  saveSettings() {
    try {
      localStorage.setItem(STORE_KEY, JSON.stringify(this.settings));
    } catch (e) {
      /* 忽略写入失败 */
    }
  },

  /** 把设置写进 CSS 变量 / 类名 */
  applySettings() {
    const s = this.settings;
    const root = document.documentElement;
    root.style.setProperty('--sgs-ui-scale', String(s.uiScale));
    root.style.setProperty('--sgs-log-w', `${s.logWidth}px`);
    root.style.setProperty('--sgs-log-maxh', `${s.logHeight}vh`);
    document.body.classList.toggle('sgs-no-anim', !s.animate);
    document.body.classList.toggle('sgs-flat-layout', !s.arcLayout);
    // 弧形分布开关变化后要重排
    if (typeof this.layoutOpponents === 'function') this.layoutOpponents();
  },

  /** 修改一个设置项并立即生效 */
  setSetting(key, value) {
    this.settings[key] = value;
    // 延迟上下限不能交叉
    if (key === 'aiDelayMin' && value > this.settings.aiDelayMax) {
      this.settings.aiDelayMax = value;
    }
    if (key === 'aiDelayMax' && value < this.settings.aiDelayMin) {
      this.settings.aiDelayMin = value;
    }
    this.saveSettings();
    this.applySettings();
    this.syncSettingsUI();
  },

  /** 建面板（只建一次） */
  buildSettingsPanel() {
    if ($('#sgs-settings')) return;
    const panel = el('div', 'sgs-settings');
    panel.id = 'sgs-settings';
    panel.innerHTML = `
      <div class="sgs-set-head">
        <span>设置</span>
        <button class="sgs-set-close" id="sgs-set-close" title="关闭">×</button>
      </div>
      <div class="sgs-set-body" id="sgs-set-body"></div>
      <div class="sgs-set-foot">
        <button class="sgs-act-btn" id="sgs-set-reset">恢复默认</button>
      </div>
    `;
    document.body.appendChild(panel);

    const body = panel.querySelector('#sgs-set-body');
    CONTROLS.forEach((c) => {
      const row = el('div', 'sgs-set-row');
      row.appendChild(el('span', 'sgs-set-label', c.label));
      const input = el('input', 'sgs-set-range');
      input.type = 'range';
      input.min = c.min; input.max = c.max; input.step = c.step;
      input.dataset.key = c.key;
      input.oninput = () => this.setSetting(c.key, Number(input.value));
      const val = el('span', 'sgs-set-val');
      val.dataset.valFor = c.key;
      row.appendChild(input);
      row.appendChild(val);
      body.appendChild(row);
    });
    TOGGLES.forEach((t) => {
      const row = el('div', 'sgs-set-row');
      row.appendChild(el('span', 'sgs-set-label', t.label));
      const box = el('input', 'sgs-set-check');
      box.type = 'checkbox';
      box.dataset.key = t.key;
      box.onchange = () => this.setSetting(t.key, box.checked);
      const wrap = el('span', 'sgs-set-check-wrap');
      wrap.appendChild(box);
      row.appendChild(wrap);
      body.appendChild(row);
    });

    panel.querySelector('#sgs-set-close').onclick = () => this.toggleSettings(false);
    panel.querySelector('#sgs-set-reset').onclick = () => {
      this.settings = { ...DEFAULT_SETTINGS };
      this.saveSettings();
      this.applySettings();
      this.syncSettingsUI();
    };
    this.syncSettingsUI();
  },

  /** 面板控件与 this.settings 同步 */
  syncSettingsUI() {
    const panel = $('#sgs-settings');
    if (!panel) return;
    CONTROLS.forEach((c) => {
      const input = panel.querySelector(`input[data-key="${c.key}"]`);
      const val = panel.querySelector(`[data-val-for="${c.key}"]`);
      if (input) input.value = this.settings[c.key];
      if (val) val.textContent = c.fmt(this.settings[c.key]);
    });
    TOGGLES.forEach((t) => {
      const box = panel.querySelector(`input[data-key="${t.key}"]`);
      if (box) box.checked = !!this.settings[t.key];
    });
  },

  toggleSettings(open) {
    const panel = $('#sgs-settings');
    if (!panel) return;
    const want = open === undefined ? !panel.classList.contains('active') : open;
    panel.classList.toggle('active', want);
    if (want) this.syncSettingsUI();
  },

  /** 一次 AI 行动前的随机延迟（毫秒）；关闭时返回 0 */
  aiDelayMs() {
    const s = this.settings;
    if (!s.aiDelayOn) return 0;
    const lo = Math.max(0, Math.min(s.aiDelayMin, s.aiDelayMax));
    const hi = Math.max(lo, s.aiDelayMax);
    return lo + Math.floor(Math.random() * (hi - lo + 1));
  },

  /** await 一次 AI 延迟 */
  aiPause() {
    const ms = this.aiDelayMs();
    return ms > 0 ? this.sleep(ms) : Promise.resolve();
  },
};
