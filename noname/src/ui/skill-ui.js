/**
 * UI 功能组：skill-ui
 * 由 tools/split_ui.cjs 从旧 ui.js 切出；混入 UI 原型。
 * 本文件只包含方法定义，新增依赖请在文件顶部补 import。
 */













/* === 依赖（由 tools/fix_ui_imports.cjs 生成）=== */
import { canBeishuiNow, consumeBeishui, qinjianOptions } from '../skills.js';
import { IDENTITY_COLOR } from '../match.js';
import { el } from '../ui-helpers.js';

export default {

/* ============================================================
 * 技能按钮
 * ============================================================ */

/** 主动技当前是否可用 */
isSkillUsable(player, skill) {
  const g = this.game;
  if (!g) return false;
  if (!player.alive) return false;
  if (g.currentPlayer !== player) return false;
  // 每回合限一次
  if (player.flags['skill_' + skill.id] === g.turnCount) return false;
  // 技能自带 filter
  if (typeof skill.filter === 'function') {
    try {
      return !!skill.filter({ player, game: g, event: {} });
    } catch (e) { return false; }
  }
  return true;
},

/** 点击技能按钮 */
async onSkillButtonClick(player, skill) {
  if (this.skillBusy) return;
  this.skillBusy = true;
  try {
    const g = this.game;
    // 标记本回合已用
    player.flags['skill_' + skill.id] = g.turnCount;
    await skill.content({
      player, game: g, event: {}, skill,
      ui: this,
    });
    g.emit();
  } catch (e) {
    console.warn('技能发动失败', skill && skill.name, e);
    this.setPrompt(`【${skill.name}】发动失败：${e.message}`);
  } finally {
    this.skillBusy = false;
    this.render();
  }
},

/** 渲染结束回合按钮的显隐（供 renderAction 调用） */
refreshEndTurnBtn() {
  const me = this.game && this.game.players.find((p) => p.isHuman);
  if (me) this.renderEndTurnRow(me);
},

/** 供界面判断是否显示「背水」按钮（转发到 skills.js） */
canBeishui(player) {
  return canBeishuiNow(player);
},

/**
 * 玩家主动按下「背水」按钮
 * ------------------------------------------------------------------
 * 消耗掉本次背水机会，并做一次【怯懦的琴键】的全选发动。
 */
async onBeishuiClick(player) {
  if (this.skillBusy) return;
  this.skillBusy = true;
  try {
    const g = this.game;
    if (!consumeBeishui) return;
    consumeBeishui(player);
    /*
     * 背水的实质：把【怯懦的琴键】那对转换技的选项**标志**置为
     * 「本次全选」。因为该技能是锁定技（由 mod.cardEnabled 等
     * 永续效果驱动，没有 content），所以这里只记录状态，
     * 真正的效果（摸三张/翻面、重新隐匿）仍由技能自身的
     * 触发条件驱动。
     */
    player.storage = player.storage || {};
    player.storage.beishuiActive = g.turnCount;
    const opts = qinjianOptions(player, true);
    g.log(`${player.name} 主动发动「背水」：`
      + `【怯懦的琴键】本次全选 ${opts.join('、')}`);
    this.setPrompt(`已背水：【怯懦的琴键】本次将执行 ${opts.join('、')}`);
    g.emit();
  } catch (e) {
    console.warn('背水发动失败', e);
    this.setPrompt(`背水发动失败：${e.message}`);
  } finally {
    this.skillBusy = false;
    this.render();
  }
},

/* ============================================================
 * 身份标记（玩家推理用）
 * ============================================================ */

/** 打开身份标记菜单 */
openIdentityMark(player, anchor) {
  const existing = document.getElementById('sgs-idmark-menu');
  if (existing) existing.remove();

  const menu = el('div', 'sgs-idmark-menu');
  menu.id = 'sgs-idmark-menu';

  const opts = [
    ['zhu', '主公'], ['zhong', '忠臣'], ['fan', '反贼'], ['nei', '内奸'],
  ];
  for (const [key, label] of opts) {
    const b = el('button', 'sgs-idmark-btn', label);
    b.style.borderColor = IDENTITY_COLOR[key];
    if (this.identityMarks[player.id] === key) b.classList.add('active');
    b.onclick = () => {
      if (this.identityMarks[player.id] === key) delete this.identityMarks[player.id];
      else this.identityMarks[player.id] = key;
      menu.remove();
      this.render();
    };
    menu.appendChild(b);
  }
  // 清除标记
  const clear = el('button', 'sgs-idmark-btn clear', '清除');
  clear.onclick = () => {
    delete this.identityMarks[player.id];
    menu.remove();
    this.render();
  };
  menu.appendChild(clear);

  document.body.appendChild(menu);
  // 定位到角标附近
  const r = anchor.getBoundingClientRect();
  menu.style.left = `${Math.min(r.left, window.innerWidth - 200)}px`;
  menu.style.top = `${r.bottom + 4}px`;

  // 点击别处关闭
  const off = (ev) => {
    if (!menu.contains(ev.target)) {
      menu.remove();
      document.removeEventListener('click', off, true);
    }
  };
  setTimeout(() => document.addEventListener('click', off, true), 0);
},

/* ============================================================
 * 武将收藏（localStorage 持久化）
 * ============================================================ */

loadFavorites() {
  try {
    const raw = localStorage.getItem('sgs_favorites');
    return raw ? JSON.parse(raw) : [];
  } catch (e) { return []; }
},

saveFavorites() {
  try {
    localStorage.setItem('sgs_favorites', JSON.stringify(this.favorites));
  } catch (e) { /* 隐私模式忽略 */ }
},

isFavorite(charId) {
  return this.favorites.includes(charId);
},

toggleFavorite(charId) {
  const i = this.favorites.indexOf(charId);
  if (i >= 0) this.favorites.splice(i, 1);
  else this.favorites.push(charId);
  this.saveFavorites();
  return this.isFavorite(charId);
}
};
