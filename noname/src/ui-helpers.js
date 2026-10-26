/**
 * UI 公共工具：DOM helper、资源路径、图片回退。
 * 由 tools/split_ui.cjs 从旧 ui.js 头部切出，供 src/ui/ 下各功能组复用。
 */

import { CHARACTERS } from './characters.js';

export const $ = (sel, root = document) => root.querySelector(sel);
export const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

export function el(tag, cls, html) {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (html != null) n.innerHTML = html;
  return n;
}

/**
 * 资源路径约定
 * ------------------------------------------------------------------
 * 使用「根绝对路径」，与页面所在层级无关：
 *   武将立绘   /noname/character/<id>.png      ← 你放置的图片
 *   占位立绘   /noname/assets/character/<id>.svg
 *
 * 说明：早期版本用相对路径 `noname/character/...`，当页面位于 /noname/
 * 时会解析成 /noname/noname/character/...（多一层），导致图片全部 404。
 * 改为绝对路径后，无论页面在 /noname/ 还是 /noname/index.html 都正确。
 */

/**
 * 立绘存放约定（**不需要维护任何对照表**）
 * ------------------------------------------------------------------
 * 站点根目录下有 images/character/<武将中文名>.png，本扩武将的原画都放这里；
 * 文件名就是武将的 name，例如 折桠.png / 卡达.png / 白金磷子.png / 璐米欧儿.png。
 * 网页会自行缩放显示（CSS object-fit: cover），大图不影响布局。
 */

/**
 * 站点根前缀
 * ------------------------------------------------------------------
 * 页面固定位于 <站点根>/noname/index.html，因此从 location.pathname
 * 截掉 `/noname/...` 就得到站点根：本地是 `/`，部署在子路径时是 `/repo/`。
 * 所有资源路径都拼这个前缀，换部署位置不用改代码。
 */
export function siteRoot() {
  const m = location.pathname.match(/^(.*?)\/noname(\/|$)/);
  return m && m[1] ? `${m[1]}/` : '/';
}

/** 武将立绘路径（首个候选；不存在时见 bindImageFallback 的逐级回退） */
export function charImgPath(id) {
  return charImgPaths(id)[0];
}

/**
 * 武将立绘的**候选路径链**（按优先级）
 * ------------------------------------------------------------------
 *   ① images/character/<中文名>.png        ← 本扩武将的原画位置
 *   ② images/character/<id>.png            ← 英文 id 命名的备用位置
 *   ③ noname/character/<id>.png            ← 自备立绘
 *   ④ noname/assets/character/<id>.svg     ← 内置占位图（必定存在）
 *
 * 页面按顺序逐个尝试，第一个能加载的就用它 —— 所以无论把原画放在
 * ①②③ 哪一处，或是干脆不传（走 ④ 占位图），显示都不会坏。
 * 仓库里 images/character/ 与 noname/ 同级，都在站点根下。
 */
export function charImgPaths(id) {
  const ch = CHARACTERS[id];
  const name = ch && ch.name;
  const root = siteRoot();
  const list = [];
  if (name && name !== id) list.push(`${root}images/character/${encodeURIComponent(name)}.png`);
  list.push(`${root}images/character/${encodeURIComponent(id)}.png`);
  list.push(`${root}noname/character/${id}.png`);
  list.push(charFallbackPath(id));
  return [...new Set(list)];
}

/** 占位立绘路径（仓库内置，必定存在） */
export function charFallbackPath(id) {
  return `${siteRoot()}noname/assets/character/${id}.svg`;
}

/** 卡牌素材路径 */
export function cardImagePath(name) {
  return `${siteRoot()}noname/assets/card/${name}.svg`;
}

/** 牌桌背景路径 */
export function tableBgPath() {
  return `${siteRoot()}noname/assets/background/table.svg`;
}

/**
 * 推导「主站」地址
 * ------------------------------------------------------------------
 * 站点结构：<主站>/noname/ 是游戏目录，
 * 因此从当前路径去掉 /noname/ 及其之后的部分，就是主站根。
 * 兼容部署在子路径（如 /docs/noname/）的情况。
 */
export function resolveHomeHref() {
  return siteRoot();
}

/**
 * 统一的「立绘逐级回退」绑定
 * ------------------------------------------------------------------
 * 按 charImgPaths 的候选链逐个尝试，全部失败后降级为文字块。
 * 各调用点都使用本函数，避免逻辑分散导致不一致。
 */
export function bindImageFallback(img, charId, name, opts = {}) {
  const { avatar = false, sex = '' } = opts;
  const chain = charImgPaths(charId);
  let idx = 0;
  img.dataset.fallback = '0';
  img.addEventListener('error', function onErr() {
    idx += 1;
    if (idx < chain.length) {
      img.dataset.fallback = String(idx);
      img.src = chain[idx];
      return;
    }
    img.dataset.fallback = 'text';
    img.removeEventListener('error', onErr);
    if (!img.parentNode) return;
    const fb = document.createElement('div');
    fb.className = avatar ? 'sgs-avatar-fallback' : 'pick-fallback';
    fb.innerHTML = avatar
      ? `${name || charId}<span class="sex">${sex}</span>`
      : (name || charId)[0];
    img.replaceWith(fb);
  });
}

/* ============================================================
 * UI 类
 * ============================================================ */
