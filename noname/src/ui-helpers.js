/**
 * UI 公共工具：DOM helper、资源路径、图片回退。
 * 由 tools/split_ui.cjs 从旧 ui.js 头部切出，供 src/ui/ 下各功能组复用。
 */

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
 * 指定立绘的**外部来源**（仓库里已有的图片）
 * ------------------------------------------------------------------
 * 站点结构里，仓库根目录下有 images/character/<原名>.png，
 * 里面已经放好了本扩武将的原画，**不需要再往 noname/character/ 传一份**。
 *
 * 这里把「武将 id」映射到「仓库里的文件名」，charImgPath 会优先用它。
 * 网页会自行缩放显示（CSS object-fit: cover），大图也不影响布局。
 */
const CHAR_IMAGE_ALIAS = {
  // 折桠 → 仓库 images/character/折桠.png
  zheya: '折桠',
  // 卡达 → 仓库 images/character/卡达.png（若不存在会自动回退占位图）
  kada: '卡达',
  // 璐米欧儿 → 仓库 images/character/璐米欧儿.png
  lumioer: '璐米欧儿',
};

/** 武将立绘路径（你放置的 PNG；不存在时自动回退到占位图） */
export function charImgPath(id) {
  // ① 优先用「仓库已有图片」的映射（无需另传文件）
  const alias = CHAR_IMAGE_ALIAS[id];
  if (alias) {
    return `/images/character/${encodeURIComponent(alias)}.png`;
  }
  // ② 其次用 noname/character/<id>.png（自备立绘时用）
  return `/noname/character/${id}.png`;
}

/** 占位立绘路径（仓库内置，必定存在） */
export function charFallbackPath(id) {
  return `/noname/assets/character/${id}.svg`;
}

/** 卡牌素材路径 */
export function cardImagePath(name) {
  return `/noname/assets/card/${name}.svg`;
}

/** 牌桌背景路径 */
export function tableBgPath() {
  return `/noname/assets/background/table.svg`;
}

/**
 * 推导「主站」地址
 * ------------------------------------------------------------------
 * 站点结构：<主站>/noname/ 是游戏目录，
 * 因此从当前路径去掉 /noname/ 及其之后的部分，就是主站根。
 * 兼容部署在子路径（如 /docs/noname/）的情况。
 */
export function resolveHomeHref() {
  const m = location.pathname.match(/^(.*?)\/noname(\/|$)/);
  if (m) {
    const base = m[1];
    return base ? base + '/' : '/';
  }
  return '../';   // 兜底：退到上一级
}

/**
 * 统一的「图片三级回退」绑定
 *   第一级：你放置的 PNG（charImgPath）
 *   第二级：内置 SVG 占位图（charFallbackPath）
 *   第三级：文字块
 *
 * 各调用点都使用本函数，避免逻辑分散导致不一致。
 */
export function bindImageFallback(img, charId, name, opts = {}) {
  const { avatar = false, sex = '' } = opts;
  img.dataset.fallback = '0';
  img.addEventListener('error', function onErr() {
    const stage = img.dataset.fallback;
    if (stage === '0') {
      img.dataset.fallback = '1';
      img.src = charFallbackPath(charId);
      return;
    }
    img.dataset.fallback = '2';
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
