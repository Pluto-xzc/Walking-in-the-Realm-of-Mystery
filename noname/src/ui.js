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

const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

function el(tag, cls, html) {
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
  }

  /* ---------------- 生命周期 ---------------- */
  init() {
    this.ensureSplash();
    this.buildTable();
    this.bindGlobal();
  }

  /** 确保开屏容器存在（由 showSplash 填充内容） */
  ensureSplash() {
    if (document.getElementById('sgs-splash')) return;
    const splash = document.createElement('div');
    splash.id = 'sgs-splash';
    document.body.appendChild(splash);
  }

  /**
   * 竖屏遮罩（手机端强制横屏）
   * ------------------------------------------------------------------
   * 手牌/装备区/对手区在竖屏下会被严重压缩，容易出现布局错乱，
   * 因此窄屏竖屏时盖一层提示，转横屏后自动消失。
   *
   * 判定条件（纯 CSS，见 .sgs-rotate-overlay）：
   *   屏幕方向为 portrait 且宽度 <= 900px
   * 桌面浏览器通常不会命中（高度不会远大于宽度）。
   */
  buildOrientationOverlay() {
    if (document.getElementById('sgs-orient')) return;
    const ov = el('div', 'sgs-rotate-overlay');
    ov.id = 'sgs-orient';
    ov.innerHTML = `
      <div class="sgs-rotate-inner">
        <div class="sgs-rotate-icon">📱</div>
        <div class="sgs-rotate-title">请横屏游玩</div>
        <div class="sgs-rotate-sub">手机竖屏下牌桌会被压缩，可能导致操作异常。<br>
          请把手机转为横屏后继续。</div>
      </div>
    `;
    document.body.appendChild(ov);
  }

  /* ---------------- 开屏 ---------------- */
  /**
   * 显示开屏，返回 Promise（用户点击「开始游戏」后 resolve）
   * @param {object} stats { chars, cards }
   * @param {function} onProgress 进度回调 (0~1, text)
   */
  showSplash(stats, onProgress) {
    return new Promise((resolve) => {
      this.ensureSplash();
      const splash = $('#sgs-splash');
      splash.style.display = 'flex';

      const totalChars = stats.chars;
      const totalCards = stats.cards;

      // 构建内容
      splash.innerHTML = '';

      const inner = el('div', 'sgs-splash-inner');

      const logo = el('div', 'sgs-logo', '三国杀');
      const sub = el('div', 'sgs-logo-sub', '标 准 包 · 单 机 版');
      inner.appendChild(logo);
      inner.appendChild(sub);

      // 开源声明
      const notice = el('div', 'sgs-notice');
      notice.innerHTML = `
        <h3>开源声明与素材来源</h3>
        <ul>
          <li>本页面的<span class="hl">全部可玩内容（规则、武将、卡牌、技能）均参考自开源项目《无名杀》</span>（Noname）。</li>
          <li>《无名杀》基于 <span class="hl">GPL-3.0</span> 协议开源，项目地址：
            <a href="https://github.com/libnoname/noname" target="_blank" rel="noopener">github.com/libnoname/noname</a></li>
          <li>本实现为<span class="hl">独立重写</span>的精简版，仅保留标准包内容，不含《无名杀》的任何源代码文件。</li>
          <li>卡牌名称、武将名称、技能描述等属于《三国杀》游戏机制范畴，相关权利归其原始权利人所有。</li>
          <li>本页面<span class="hl">仅供学习与个人娱乐，不作任何商业用途</span>。如涉及权利问题，请联系站点作者删除。</li>
          <li>武将立绘图片来源见站点说明；若未提供则使用程序生成的占位图。</li>
        </ul>
      `;
      inner.appendChild(notice);

      // 加载区
      const loading = el('div', 'sgs-loading');
      const loadText = el('div', 'sgs-loading-text', '正在准备资源…');
      const prog = el('div', 'sgs-progress');
      const bar = el('div', 'sgs-progress-bar');
      prog.appendChild(bar);
      loading.appendChild(loadText);
      loading.appendChild(prog);
      inner.appendChild(loading);

      // 开始按钮 + 返回主站
      const btnRow = el('div', 'sgs-btn-row');
      const btn = el('button', 'sgs-btn', '开 始 游 戏');
      btn.disabled = true;
      btnRow.appendChild(btn);
      const backLink = el('a', 'sgs-btn sgs-btn-ghost', '返 回 主 站');
      backLink.href = resolveHomeHref();
      btnRow.appendChild(backLink);
      inner.appendChild(btnRow);

      // 统计
      const stat = el('div', 'sgs-logo-sub');
      stat.textContent = `武将 ${totalChars} 名 · 卡牌 ${totalCards} 张 · 身份模式 5 人局`;
      inner.appendChild(stat);

      splash.appendChild(inner);

      // 资源预加载：武将图（主图 + 内置占位图）
      const tasks = [];

      // 武将图：优先 PNG，缺失则用内置 SVG
      Object.keys(CHARACTERS).forEach((id) => {
        tasks.push({ type: 'char', id, url: charImgPath(id), fb: charFallbackPath(id) });
      });

      const done = { ok: 0, fail: 0, total: tasks.length, cached: 0 };
      let finished = false;

      // ---- 缓存检测 ----
      // 资源版本号：素材有更新时改这里，即可让所有客户端重新拉取。
      const ASSET_VERSION = '1';
      const CACHE_KEY = 'sgs_assets_v' + ASSET_VERSION;

      const readCache = () => {
        try {
          const raw = localStorage.getItem(CACHE_KEY);
          return raw ? JSON.parse(raw) : null;
        } catch (e) { return null; }
      };
      const writeCache = (obj) => {
        try { localStorage.setItem(CACHE_KEY, JSON.stringify(obj)); } catch (e) { /* 隐私模式忽略 */ }
      };

      const cached = readCache();
      const isAllCached = cached && cached.total === tasks.length && cached.stamp === ASSET_VERSION;

      const updateProgress = () => {
        const p = done.total ? (done.ok + done.fail) / done.total : 1;
        bar.style.width = `${Math.round(p * 100)}%`;
        if (isAllCached) {
          loadText.textContent = `资源已缓存，无需重新下载（${done.total} 项）`;
        } else {
          loadText.textContent = `首次进入需要下载资源，请稍候… ${done.ok + done.fail}/${done.total}`;
        }
        if (typeof onProgress === 'function') onProgress(p, loadText.textContent);
      };

      const finish = () => {
        if (finished) return;
        finished = true;
        bar.style.width = '100%';
        if (isAllCached) {
          loadText.textContent = '资源已缓存，秒开';
        } else if (done.fail > 0) {
          loadText.textContent = `资源加载完成（${done.fail} 项缺失，将使用占位图）`;
        } else {
          loadText.textContent = '资源加载完成（已缓存，下次秒开）';
        }
        // 记录缓存
        writeCache({ stamp: ASSET_VERSION, total: tasks.length, at: Date.now() });
        btn.disabled = false;
        btn.focus();
      };

      // 若已全部缓存，直接跳过下载
      if (isAllCached) {
        done.ok = tasks.length;
        bar.style.width = '100%';
        updateProgress();
        finish();
        btn.onclick = () => { splash.style.display = 'none'; resolve(); };
        return;
      }

      // 预加载（并发 8）
      let cursor = 0;
      const CONC = 8;
      const worker = () => {
        if (cursor >= tasks.length) {
          if (done.ok + done.fail >= tasks.length) finish();
          return;
        }
        const t = tasks[cursor++];
        const img = new Image();
        const settle = (ok) => {
          if (ok) done.ok++; else done.fail++;
          updateProgress();
          if (done.ok + done.fail >= tasks.length) finish();
          worker();
        };
        img.onload = () => settle(true);
        img.onerror = () => {
          // 主图缺失：尝试内置占位图，成功则仍计为「可用」
          if (t.fb && !t._triedFb) {
            t._triedFb = true;
            img.onerror = () => settle(false);
            img.onload = () => settle(true);
            img.src = t.fb;
            return;
          }
          settle(false);
        };
        img.src = t.url;
      };
      for (let i = 0; i < CONC; i++) worker();
      updateProgress();

      btn.onclick = () => {
        splash.style.display = 'none';
        resolve();
      };
    });
  }

  /* ---------------- 选将界面 ---------------- */
  /**
   * 选将界面
   * ------------------------------------------------------------------
   * 结构（从上到下）：
   *   标题 / 势力标签栏（全部 ⭐魏蜀吴群） / 武将网格（可滚动） / 底部固定确认栏
   *
   * 要点：
   *   - 确认栏固定在底部，不必滚到底才能点
   *   - 每张武将卡右上角有收藏星标，点击切换收藏
   *   - 收藏持久化到 localStorage
   */
  /**
   * 选择对局模式
   * ------------------------------------------------------------------
   * 官方：先随机分发身份 → 按身份给候选武将（主公多、反贼少）
   * 自由：自选身份 + 全部武将池任选（测试武将 / 自由对局用）
   *
   * @returns {Promise<'official'|'free'>}
   */
  chooseMode() {
    return new Promise((resolve) => {
      const modal = $('#sgs-char-modal');
      modal.classList.add('active');
      const box = $('.sgs-modal-box', modal);
      box.innerHTML = '';
      box.classList.add('sgs-char-box');

      box.appendChild(el('div', 'sgs-modal-title', '选 择 模 式'));
      box.appendChild(el('div', 'sgs-modal-sub', '官方模式为默认玩法；自由模式用于测试武将与自由对局'));

      const list = el('div', 'sgs-mode-list');
      const MODES = [
        {
          key: 'official',
          title: '官 方 模 式',
          desc: '先随机分发身份，再按身份给出候选武将',
          detail: `主公 ${CHOICE_NUM.zhu} 名 / 忠臣 ${CHOICE_NUM.zhong} 名`
            + ` / 内奸 ${CHOICE_NUM.nei} 名 / 反贼 ${CHOICE_NUM.fan} 名候选`,
        },
        {
          key: 'free',
          title: '自 由 模 式',
          desc: '自己选身份，并从全部武将中任选',
          detail: '用于测试武将技能或自由对局',
        },
      ];
      MODES.forEach((m) => {
        const card = el('div', 'sgs-mode-pick');
        card.appendChild(el('div', 'sgs-mode-title', m.title));
        card.appendChild(el('div', 'sgs-mode-desc', m.desc));
        card.appendChild(el('div', 'sgs-mode-detail', m.detail));
        card.addEventListener('click', () => {
          modal.classList.remove('active');
          box.classList.remove('sgs-char-box');
          resolve(m.key);
        });
        list.appendChild(card);
      });
      box.appendChild(list);
    });
  }

  /**
   * 选择身份
   * ------------------------------------------------------------------
   * 官方身份模式的流程是「先给身份，再按身份给候选武将」。
   * 这里为「自选身份」模式提供界面：让玩家挑一个身份用于测试/自由对局。
   *
   * @param {string[]} options 可选身份（如 ['zhu','zhong','fan','nei']）
   * @param {string} title
   * @returns {Promise<string>} 选中的身份
   */
  chooseIdentity(options, title = '选 择 身 份') {
    return new Promise((resolve) => {
      const modal = $('#sgs-char-modal');
      modal.classList.add('active');
      const box = $('.sgs-modal-box', modal);
      box.innerHTML = '';
      box.classList.add('sgs-char-box');

      box.appendChild(el('div', 'sgs-modal-title', title));
      box.appendChild(el('div', 'sgs-modal-sub',
        '自选身份用于测试武将或自由对局；正常对局请用「身份随机」'));

      const list = el('div', 'sgs-identity-list');
      const DESC = {
        zhu: '主公：体力上限 +1，从常备主公里选择',
        zhong: '忠臣：保护主公，与主公同生共死',
        fan: '反贼：击杀主公即可获胜',
        nei: '内奸：存活到最后，与主公单挑获胜',
      };
      options.forEach((id) => {
        const card = el('div', 'sgs-identity-pick');
        card.style.setProperty('--id-color', IDENTITY_COLOR[id] || '#888');
        const badge = el('span', 'sgs-identity-badge-inline', IDENTITY_LABEL[id] || id);
        card.appendChild(badge);
        card.appendChild(el('div', 'sgs-identity-desc', DESC[id] || ''));
        // 用 addEventListener 而不是 onclick，避免被后续赋值覆盖；
        // 同时整张卡片可点（子元素点击会冒泡上来）。
        card.addEventListener('click', () => {
          modal.classList.remove('active');
          box.classList.remove('sgs-char-box');
          resolve(id);
        });
        list.appendChild(card);
      });
      box.appendChild(list);

      // 可以返回（走随机）
      const back = el('button', 'sgs-act-btn', '返回（身份随机）');
      back.onclick = () => {
        modal.classList.remove('active');
        box.classList.remove('sgs-char-box');
        resolve(null);
      };
      const footer = el('div', 'sgs-char-footer');
      footer.appendChild(el('div', 'sgs-char-picked', ''));
      footer.appendChild(back);
      box.appendChild(footer);
    });
  }

  /**
   * 选择武将
   * @param {string[]} charIds 候选武将
   * @param {boolean} isLord 是否为主公（文案与提示不同）
   * @param {object} [ctx] 额外上下文
   * @param {string} [ctx.identity] 当前身份，用于标题提示
   * @param {string} [ctx.ruleText] 规则说明（如「主公候选 10 人」）
   * @param {boolean} [ctx.freeMode] 是否自由模式（全部武将池）
   */
  chooseCharacter(charIds, isLord, ctx = {}) {
    return new Promise((resolve) => {
      const modal = $('#sgs-char-modal');
      modal.classList.add('active');

      const box = $('.sgs-modal-box', modal);
      box.innerHTML = '';
      box.classList.add('sgs-char-box');

      box.appendChild(el('div', 'sgs-modal-title',
        isLord ? '选 择 主 公' : '选 择 武 将'));
      // 副标题：把「当前身份 + 候选规则」讲清楚
      const subText = ctx.ruleText
        || (isLord ? '你是主公，请从常备主公中选择一名' : '请选择一名武将开始游戏');
      box.appendChild(el('div', 'sgs-modal-sub', subText));

      // ---------------- 标签栏 ----------------
      // 分类与势力合并生成：若两者指同一个东西（如「再探泰拉」=「舟」），
      // 只保留一个，避免出现内容完全相同的两个标签。
      const TABS = [
        { key: 'all', label: '全' },
        { key: 'fav', label: '⭐' },
        ...pickerTabs(),
      ];
      let currentTab = 'all';
      let picked = null;

      const tabBar = el('div', 'sgs-char-tabs');
      const grid = el('div', 'sgs-char-grid');

      // 底部固定确认栏（不随网格滚动）
      const footer = el('div', 'sgs-char-footer');
      const pickedLabel = el('div', 'sgs-char-picked', '未选择');
      const confirmBtn = el('button', 'sgs-act-btn primary', '确 定');
      confirmBtn.disabled = true;
      confirmBtn.onclick = () => {
        if (!picked) return;
        modal.classList.remove('active');
        box.classList.remove('sgs-char-box');
        resolve(picked);
      };
      footer.appendChild(pickedLabel);
      footer.appendChild(confirmBtn);

      /** 按当前标签页渲染网格 */
      const renderGrid = () => {
        grid.innerHTML = '';
        let list = charIds.slice();
        if (currentTab === 'fav') {
          list = list.filter((id) => this.isFavorite(id));
        } else if (currentTab.startsWith('pack:')) {
          const pk = currentTab.slice(5);
          list = list.filter((id) => packOf(id) === pk);
        } else if (currentTab.startsWith('group:')) {
          const gk = currentTab.slice(6);
          list = list.filter((id) => CHARACTERS[id].group === gk);
        }

        if (!list.length) {
          const empty = currentTab === 'fav'
            ? '还没有收藏的武将（点击武将卡右上角的 ☆ 收藏）'
            : currentTab.startsWith('pack:') ? '该分类暂无武将' : '该势力暂无武将';
          grid.appendChild(el('div', 'sgs-char-empty', empty));
          return;
        }

        list.forEach((id) => {
          const ch = CHARACTERS[id];
          const card = el('div', 'sgs-char-pick');
          if (picked === id) card.classList.add('selected');
          card.style.setProperty('--grp-color', GROUPS[ch.group].color);

          // 右上角收藏星标
          const fav = el('div', 'sgs-char-fav', this.isFavorite(id) ? '★' : '☆');
          if (this.isFavorite(id)) fav.classList.add('on');
          fav.title = this.isFavorite(id) ? '取消收藏' : '收藏此武将';
          fav.onclick = (ev) => {
            ev.stopPropagation();          // 不要触发选将
            const now = this.toggleFavorite(id);
            fav.textContent = now ? '★' : '☆';
            fav.classList.toggle('on', now);
            fav.title = now ? '取消收藏' : '收藏此武将';
            if (currentTab === 'fav' && !now) renderGrid();   // 在收藏页取消则移出列表
          };
          card.appendChild(fav);

          /*
           * 卡片排版（按需求）：首行名字 → 技能名 + 描述 → 势力
           * 不显示原画（美术非重点，信息密度优先）。
           *
           * DOM：
           *   .pick-name-row   名字 + 势力小标签
           *   .pick-skill-list 每个技能一行：技能名（大字）+ 描述（小字）
           */
          const nameRow = el('div', 'pick-name-row');
          nameRow.appendChild(el('span', 'pick-name', ch.name));
          card.appendChild(nameRow);

          const skillList = el('div', 'pick-skill-list');
          ch.skills.forEach((sid) => {
            const s = SKILLS[sid];
            if (!s) return;
            const row = el('div', 'pick-skill-row');
            const t = el('div', 'pick-skill-title', s.name);
            if (s.locked) t.classList.add('locked');
            row.appendChild(t);
            const d = el('div', 'pick-skill-desc', s.desc || '');
            row.appendChild(d);
            skillList.appendChild(row);
          });
          card.appendChild(skillList);

          // 势力标签放最后
          const footRow = el('div', 'pick-foot');
          const grpTag = el('span', 'pick-group', GROUPS[ch.group].label);
          grpTag.style.background = GROUPS[ch.group].color;
          footRow.appendChild(grpTag);
          // 体力也顺带标出，方便选将时判断
          const hpVal = ch.hp != null ? ch.hp : ch.maxHp;
          footRow.appendChild(el('span', 'pick-hp', `体力 ${hpVal}`));
          card.appendChild(footRow);

          // 整卡悬停时右键可看技能详情
          card.oncontextmenu = (ev) => {
            ev.preventDefault();
            const s = SKILLS[ch.skills[0]];
            if (s) this.showSkillDetail({ name: ch.name }, s, ev);
          };

          card.onclick = () => {
            $$('.sgs-char-pick', grid).forEach((c) => c.classList.remove('selected'));
            card.classList.add('selected');
            picked = id;
            confirmBtn.disabled = false;
            pickedLabel.textContent = `已选：${ch.name}`;
            pickedLabel.classList.add('has');
          };
          grid.appendChild(card);
        });
      };

      // 渲染标签栏
      TABS.forEach((t) => {
        const b = el('button', 'sgs-char-tab', t.label);
        if (t.key === currentTab) b.classList.add('active');
        b.onclick = () => {
          currentTab = t.key;
          $$('.sgs-char-tab', tabBar).forEach((x) => x.classList.remove('active'));
          b.classList.add('active');
          renderGrid();
        };
        tabBar.appendChild(b);
      });

      box.appendChild(tabBar);
      box.appendChild(grid);
      box.appendChild(footer);

      renderGrid();
    });
  }

  /* ---------------- 牌桌骨架 ---------------- */
  buildTable() {
    if ($('#sgs-table')) return;
    const table = el('div', '');
    table.id = 'sgs-table';
    table.innerHTML = `
      <div class="sgs-topbar">
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
  }

  bindGlobal() {
    document.addEventListener('click', (e) => {
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
  }

  /* ---------------- 引擎 io 接口 ---------------- */
  /** 由 match.js 注入 game 后调用 */
  attach(game) {
    this.game = game;
    game.io = this;
    // 用合并渲染，避免高频 emit 造成头像闪烁
    game.onUpdate = () => this.scheduleRender();
  }

  async showSplashForGame() {
    // 引擎内部调用，此处无操作（开屏由外部控制）
  }

  sleep(ms) {
    return new Promise((r) => setTimeout(r, ms));
  }

  /** 渲染整个牌桌 */
  render() {
    const g = this.game;
    if (!g) return;
    const me = g.players.find((p) => p.isHuman) || g.players[0];
    if (!me) return;

    $('#sgs-table').classList.add('active');

    this.renderOpponents(me);
    this.renderSelf(me);
    this.renderLog();
    this.renderProcessing();

    $('#sgs-topbar-info').textContent =
      `回合 ${g.turnCount} · 牌堆 ${g.deck.length} · 弃牌 ${g.discardPile.length}`;
  }

  /**
   * 合并高频渲染请求
   * ------------------------------------------------------------------
   * 引擎每次 log/emit 都会触发 render，若直接重绘会导致
   *   ① 头像 <img> 被反复重建 → 图片闪烁
   *   ② CSS 动画被反复重启 → 武将牌「闪一下」
   * 这里用 requestAnimationFrame 合并同一帧内的多次调用。
   */
  scheduleRender() {
    if (this._rafPending) return;
    this._rafPending = true;
    const run = () => {
      this._rafPending = false;
      this.render();
    };
    if (typeof requestAnimationFrame === 'function') requestAnimationFrame(run);
    else setTimeout(run, 16);
  }

  renderOpponents(me) {
    const g = this.game;
    const wrap = $('#sgs-opponents');

    // 按「行动顺序」排列：从 1 号位（主公）开始，依次 2→3→4→5。
    // 与引擎的实际回合轮转顺序一致，便于预判下一个行动者。
    const sorted = g.players
      .filter((p) => p !== me)
      .slice()
      .sort((a, b) => {
        // 存活者在前，阵亡者在后；各自内部按座位号
        if (a.alive !== b.alive) return a.alive ? -1 : 1;
        return a.seat - b.seat;
      });

    // 座位顺序是否变化 —— 只有变化时才重建节点，否则原地更新
    const wantOrder = sorted.map((p) => p.id).join(',');
    const needRebuild = wrap.dataset.order !== wantOrder
      || wrap.children.length !== sorted.length;

    if (needRebuild) {
      wrap.dataset.order = wantOrder;
      wrap.innerHTML = '';
      sorted.forEach((p) => {
        wrap.appendChild(this.buildPlayerNode(p, false));
      });
    } else {
      // 原地更新（不重建 <img>，避免头像闪烁）
      [...wrap.children].forEach((node) => {
        const pid = +node.dataset.pid;
        const p = g.players.find((x) => x.id === pid);
        if (p) this.updatePlayerNode(node, p, me);
      });
    }

    // 可选中状态
    $$('.sgs-player', wrap).forEach((n) => {
      const pid = +n.dataset.pid;
      const p = g.players.find((x) => x.id === pid);
      const ok = this.mode === 'targets' && this.targetCandidates
        && this.targetCandidates.includes(p) && !this.selectedTargets.includes(p);
      n.classList.toggle('targetable', !!ok);
      const av = n.querySelector('.sgs-avatar-wrap');
      if (av) {
        if (this.selectedTargets.includes(p)) {
          av.style.boxShadow = '0 0 0 3px #7fd4a8, 0 0 22px rgba(127,212,168,0.8)';
        } else if (av.style.boxShadow) {
          av.style.boxShadow = '';
        }
      }
    });
  }

  /**
   * 更新已存在的玩家节点（不重建 DOM）
   * ------------------------------------------------------------------
   * 目的：避免每次重绘都重建 <img>，从而消除头像闪烁与动画重启。
   * 只更新会变化的部分：体力、手牌数、徽章、状态类。
   */
  updatePlayerNode(node, p, me) {
    const g = this.game;
    if (!node) return;

    node.classList.toggle('dead', !p.alive);
    node.classList.toggle('current-turn', g.currentPlayer === p);
    // 横置状态（铁索连环）
    node.classList.toggle('chained', !!p.isChained);

    /*
     * 【隐匿】状态
     * ------------------------------------------------------------------
     * 隐匿是「会变化的状态」（受伤/回合开始会登场，之后可能重新隐匿），
     * 因此这条原地更新路径也必须处理，否则会出现
     * 「进了隐匿但界面还是旧的」这种不一致。
     */
    const hidden = !!p.hidden;
    node.classList.toggle('is-hidden-player', hidden);
    const avWrap = node.querySelector('.sgs-avatar-wrap');
    const hasHiddenAvatar = !!(avWrap && avWrap.querySelector('.sgs-hidden-avatar'));
    if (hidden !== hasHiddenAvatar) {
      // 隐匿状态与当前渲染不符 → 重建该节点（换个头像代价可接受）
      const parent = node.parentNode;
      if (parent) {
        const fresh = this.buildPlayerNode(p, p.isHuman);
        parent.replaceChild(fresh, node);
        return;
      }
    }

    // 体力点：数量或状态变化时重建
    const avWrap2 = avWrap;
    if (avWrap2) {
      const hp = avWrap2.querySelector('.sgs-hp');
      if (hidden) {
        // 隐匿：体力值与上限都不可见 → 只放「体力 ?」占位
        if (!hp || !hp.querySelector('.sgs-hp-hidden')) {
          if (hp) hp.remove();
          const nhp = el('div', 'sgs-hp');
          nhp.appendChild(el('div', 'sgs-hp-hidden', '体力 ?'));
          nhp.title = '隐匿状态：体力值与体力上限不可见';
          avWrap2.appendChild(nhp);
        }
      } else {
        const needRebuild = !hp
          || !!hp.querySelector('.sgs-hp-hidden')
          || hp.children.length !== p.maxHp
          || [...hp.children].some((d, i) => d.classList.contains('on') !== (i < p.hp));
        if (needRebuild) {
          if (hp) hp.remove();
          const nhp = el('div', 'sgs-hp');
          for (let i = 0; i < p.maxHp; i++) {
            const d = el('div', 'sgs-hp-dot');
            d.classList.add(i < p.hp ? 'on' : 'off');
            nhp.appendChild(d);
          }
          avWrap2.appendChild(nhp);
        }
      }
    }

    // 名字（隐匿时显示「未知」）
    const nameEl = node.querySelector('.sgs-pname');
    if (nameEl && nameEl.textContent !== p.name) nameEl.textContent = p.name;

    // 徽章行（手牌/装备/判定/蓄谋/隐匿）由下方统一重建，见 badges.dataset.sig

    {
      const avWrap2b = avWrap;
      // 横置锁链标记：按需增删
      const hasMark = !!(avWrap2b && avWrap2b.querySelector('.sgs-chain-mark'));
      if (p.isChained && !hasMark && avWrap2b) {
        const chain = el('div', 'sgs-chain-mark');
        chain.innerHTML = '<span class="chain-link">⛓</span>';
        chain.title = '处于横置（连环）状态：受到属性伤害会传导';
        avWrap2b.appendChild(chain);
      } else if (!p.isChained && hasMark && avWrap2b) {
        const m = avWrap2b.querySelector('.sgs-chain-mark');
        if (m) m.remove();
      }
    }

    {

      // 身份角标
      const idBadge = avWrap.querySelector('.sgs-identity-badge');
      if (idBadge) {
        if (p.identityShown) {
          idBadge.textContent = IDENTITY_LABEL[p.identity];
          idBadge.style.background = IDENTITY_COLOR[p.identity];
          idBadge.classList.remove('hidden');
        } else {
          idBadge.textContent = '?';
          idBadge.classList.add('hidden');
        }
      }
    }

    // 徽章区（手牌数 / 装备 / 判定）
    const badges = node.querySelector('.sgs-badges');
    if (badges) {
      const eqs = Object.values(p.equips).filter(Boolean);
      const parts = [];
      parts.push(`手 ${p.hand.length}`);
      if (eqs.length) parts.push(`装 ${eqs.length}`);
      if (p.judges.length) parts.push(`判 ${p.judges.length}`);
      // 蓄谋 / 隐匿 也要参与签名，否则状态变化时不会重建徽章
      parts.push(`谋 ${(p.xumou && p.xumou.length) || 0}`);
      parts.push(`隐 ${p.hidden ? 1 : 0}`);
      const sig = parts.join('|');
      if (badges.dataset.sig !== sig) {
        badges.dataset.sig = sig;
        badges.innerHTML = '';
        // 隐匿角色不显示手牌数等具体信息
        if (!p.hidden) {
          badges.appendChild(el('span', 'sgs-badge', `手 ${p.hand.length}`));
        }
        if (eqs.length && !p.hidden) {
          badges.appendChild(el('span', 'sgs-badge equip',
            eqs.map((c) => (CARDS[c.name] || {}).label || c.name).join('/')));
        }
        if (p.judges.length) {
          badges.appendChild(el('span', 'sgs-badge judge', `判 ${p.judges.length}`));
        }
        // 【蓄谋】：判定区里的蓄谋牌（他人只知道数量）
        if (p.xumou && p.xumou.length) {
          badges.appendChild(el('span', 'sgs-badge xumou', `谋 ${p.xumou.length}`));
        }
        // 【隐匿】标记
        if (p.hidden) {
          badges.appendChild(el('span', 'sgs-badge hidden-badge', '隐匿'));
        }
      }
    }
  }

  /** 座位号显示文本
   * ----------------------------------------------------------------
   * 使用**绝对座位号**（主公固定 1 号位），不随玩家位置变化。
   * 这样「1 号位 = 主公」始终成立，便于判断行动顺序与身份。
   */
  seatLabel(player) {
    return String(player.seat + 1);
  }

  /* ============================================================
   * 结束回合按钮（位于武将信息下方）
   * ============================================================ */

  renderEndTurnRow(me) {
    const row = $('#sgs-endturn-row');
    if (!row) return;
    row.innerHTML = '';
    const g = this.game;
    if (!g) return;

    // 只有「自己回合的出牌阶段」才显示结束回合
    const isMyTurn = g.currentPlayer === me;
    const canEnd = isMyTurn && me.alive && this.mode === 'action';
    if (!canEnd) return;

    const btn = el('button', 'sgs-act-btn primary sgs-endturn-btn', '结 束 回 合');
    btn.title = '结束当前出牌阶段';
    btn.onclick = () => {
      if (this.endTurnResolver) {
        const r = this.endTurnResolver;
        this.endTurnResolver = null;
        r({ type: 'end' });
      }
    };
    row.appendChild(btn);
  }

  /* ============================================================
   * 自己区域的接续信息：判定牌 / 横置 / token
   * ============================================================ */

  renderSelfExtras(me) {
    const box = $('#sgs-self-extras');
    if (!box) return;
    box.innerHTML = '';

    // ① 判定区牌
    if (me.judges && me.judges.length) {
      const wrap = el('div', 'sgs-self-judges');
      wrap.appendChild(el('span', 'sgs-judge-label', '判定区'));
      me.judges.forEach((c) => {
        const n = this.buildCardNode(c, me, true);
        n.title = `判定区：${c.fullname}\n${CARDS[c.name] ? CARDS[c.name].desc : ''}`;
        n.oncontextmenu = (ev) => { ev.preventDefault(); this.showCardDetail(c, ev); };
        wrap.appendChild(n);
      });
      box.appendChild(wrap);
    }

    // ② 横置状态
    if (me.isChained) {
      const chain = el('div', 'sgs-self-chain', '⛓ 横置（连环）状态');
      chain.title = '你处于横置状态：受到属性伤害时会传导给其他横置角色，然后重置';
      box.appendChild(chain);
    }

    // ③ token（由技能设置的标记）
    const tokens = this.collectTokens(me);
    if (tokens.length) {
      const wrap = el('div', 'sgs-self-tokens');
      tokens.forEach((t) => {
        const tag = el('span', 'sgs-token' + (t.danger ? ' danger' : ''),
          `${t.icon || '◆'} ${t.label}`);
        tag.title = t.desc || t.label;
        wrap.appendChild(tag);
      });
      box.appendChild(wrap);
    }
  }

  /**
   * 收集角色身上的 token（标记）
   * ------------------------------------------------------------------
   * 目前识别：
   *   - 酒意（本回合下一张杀伤害加成）
   *   - 裸衣 / 酒 等回合标记
   *   - 兵粮寸断 / 乐不思蜀 造成的跳过阶段标记
   * 未来武将技能通过 player.storage / flags 设置的标记也会在此展示。
   */
  collectTokens(p) {
    const out = [];
    const g = this.game;
    if (!g) return out;

    // 酒意：只在「产生它的那个回合」内显示，避免跨回合的过期标记
    if (g.jiuActive(p)) {
      out.push({
        label: `酒意 ×${p.storage.jiu}`,
        icon: '🍶',
        desc: '本回合下一张【杀】伤害 +' + p.storage.jiu,
      });
    }
    if (p.hasFlag('skipUse')) {
      out.push({ label: '跳过出牌阶段', icon: '⛔', danger: true, desc: '被【乐不思蜀】影响' });
    }
    if (p.hasFlag('skipDraw')) {
      out.push({ label: '跳过摸牌阶段', icon: '⛔', danger: true, desc: '被【兵粮寸断】影响' });
    }
    if (p.hasFlag('luoyi') === g.turnCount) {
      out.push({ label: '裸衣', icon: '💪', desc: '本回合【杀】和【决斗】伤害 +1' });
    }
    // 明置的牌（若有）
    const revealed = (p.hand || []).filter((c) => c.revealed);
    if (revealed.length) {
      out.push({
        label: `明置 ×${revealed.length}`,
        icon: '👁',
        desc: '你有明置的手牌，其他角色可以看到：'
          + revealed.map((c) => c.text).join('、'),
      });
    }
    // 技能自带的 storage 标记（供未来武将使用）
    for (const sid of (p.skills || [])) {
      const st = p.storage[sid];
      if (st === undefined || st === null || st === false) continue;
      if (typeof st === 'object' && !Array.isArray(st)) {
        for (const [k, v] of Object.entries(st)) {
          if (v === undefined || v === null || v === false || v === 0) continue;
          out.push({ label: `${k}${typeof v === 'number' ? ' ×' + v : ''}`, icon: '◆' });
        }
      }
    }
    return out;
  }

  /* ============================================================
   * 右键详情
   * ============================================================ */

  /** 关闭已有的详情浮层 */
  closeDetail() {
    const old = document.getElementById('sgs-detail-pop');
    if (old) old.remove();
  }

  /** 在鼠标位置弹出一个详情浮层 */
  showDetailPop(html, ev) {
    this.closeDetail();
    const pop = el('div', 'sgs-detail-pop');
    pop.id = 'sgs-detail-pop';
    pop.innerHTML = html;
    document.body.appendChild(pop);
    // 定位：优先在鼠标右下方，超出屏幕则翻到左上
    const r = pop.getBoundingClientRect();
    let x = (ev.clientX || 100) + 12;
    let y = (ev.clientY || 100) + 12;
    if (x + r.width > window.innerWidth - 8) x = Math.max(8, window.innerWidth - r.width - 8);
    if (y + r.height > window.innerHeight - 8) y = Math.max(8, window.innerHeight - r.height - 8);
    pop.style.left = x + 'px';
    pop.style.top = y + 'px';

    const off = (e) => {
      if (!pop.contains(e.target)) {
        pop.remove();
        document.removeEventListener('click', off, true);
        document.removeEventListener('contextmenu', off, true);
      }
    };
    setTimeout(() => {
      document.addEventListener('click', off, true);
      document.addEventListener('contextmenu', off, true);
    }, 0);
  }

  /** 显示技能详情 */
  showSkillDetail(player, skill, ev) {
    const typeText = {
      trigger: '触发技', mod: '状态技', active: '主动技',
    }[skill.type] || '技能';
    const html = `
      <div class="dp-title">${skill.name}</div>
      <div class="dp-sub">${typeText}${skill.locked ? ' · 锁定技' : ''}　持有者：${player.name}</div>
      <div class="dp-desc">${(skill.desc || '（暂无描述）').replace(/\n/g, '<br>')}</div>
      <div class="dp-hint">右键其他技能/牌可查看对应详情</div>
    `;
    this.showDetailPop(html, ev);
  }

  /**
   * 显示角色详情（右键武将牌）
   * ------------------------------------------------------------------
   * 除了基础信息，还汇总那些「不属于公开区域、但需要能查到」的内容。
   * 目前包含：
   *   ① 除外区（本扩机制）
   *      - 自己：显示每张牌的具体内容
   *      - 他人：只显示数量（按机制规则，他人不可见内容）
   *   ② 判定区牌
   *   ③ token（标记）
   *
   * 以后有类似的「需要查询但不在牌桌上」的信息，也统一加到这里。
   */
  showPlayerDetail(player, ev) {
    if (!player) return;
    const g = this.game;
    const me = g ? (g.players.find((p) => p.isHuman) || g.players[0]) : null;
    const grp = GROUPS[player.group] || { label: '?', color: '#666' };
    const idLabel = IDENTITY_LABEL[player.identity] || '';

    /* ---- 头部 ---- */
    let html = `
      <div class="dp-title">${player.name}</div>
      <div class="dp-sub">${grp.label}　${idLabel}`
      + `${player.isZhu ? ' · 主公' : ''}　${player.alive ? '' : '已阵亡'}</div>
      <div class="dp-row">体力：${player.hp}/${player.maxHp}`
      + `　｜　护甲：${player.hujia || 0}</div>
    `;

    /* ---- 技能 ---- */
    if (player.skills && player.skills.length) {
      const list = player.skills
        .map((sid) => SKILLS[sid])
        .filter(Boolean)
        .map((s) => `<div class="dp-skill"><b>${s.name}</b>`
          + `${s.locked ? '（锁定技）' : ''}：${s.desc || ''}</div>`)
        .join('');
      html += `<div class="dp-sec">技能</div><div class="dp-desc">${list}</div>`;
    }

    /* ---- 除外区（本扩机制）---- */
    const ex = player.excluded || [];
    if (ex.length) {
      // 可见性：主人看内容，他人只看数量
      const isOwner = me === player;
      if (isOwner) {
        const cards = ex.map((c) => `${c.text}`).join('、');
        html += `<div class="dp-sec">除外区（${ex.length} 张）</div>`
          + `<div class="dp-desc dp-excluded">${cards}</div>`;
      } else {
        html += `<div class="dp-sec">除外区</div>`
          + `<div class="dp-desc dp-excluded dim">`
          + `共有 ${ex.length} 张牌被除外（内容不可见）</div>`;
      }
    }

    /* ---- 明置牌（本扩机制）---- */
    /*
     * 需求方要求：查看角色的明置牌走「右键武将查看信息」，
     * 把当前明置牌的信息放在这里。
     * 明置是**持续公开**的信息，因此不论谁看都能看到内容。
     */
    const revealed = (player.hand || []).filter((c) => c && c.revealed);
    if (revealed.length) {
      const list = revealed.map((c) => c.text).join('、');
      html += `<div class="dp-sec">明置牌（${revealed.length} 张）</div>`
        + `<div class="dp-desc dp-revealed">${list}</div>`;
    }

    /* ---- 横置牌（本扩机制）---- */
    /*
     * ⚠️ 可见性按需求方裁定：
     *   横置牌的**内容对他人不可见**（仍属暗置），
     *   公开的只是「哪张牌被横置了」这一状态。
     *   因此他人只看数量，主人自己才看内容。
     *
     * 另外：一张牌可以**同时**明置与横置（需求方特别提醒），
     *      两种状态是叠加的，这里各自独立统计。
     */
    const horiz = (player.hand || []).filter((c) => c && c.horizontal);
    if (horiz.length) {
      const isOwner = me === player;
      if (isOwner) {
        const list = horiz.map((c) => `${c.text}${c.revealed ? '（明置）' : ''}`)
          .join('、');
        html += `<div class="dp-sec">横置牌（${horiz.length} 张）</div>`
          + `<div class="dp-desc dp-horizontal">${list}</div>`;
      } else {
        // 他人：只知道有几张横置，以及其中几张同时也是明置
        const alsoRevealed = horiz.filter((c) => c.revealed).length;
        html += `<div class="dp-sec">横置牌</div>`
          + `<div class="dp-desc dp-horizontal">`
          + `共有 ${horiz.length} 张手牌被横置（内容不可见）`
          + `${alsoRevealed ? `，其中 ${alsoRevealed} 张同时为明置` : ''}`
          + `</div>`;
      }
    }

    /* ---- 蓄谋牌（本扩机制）---- */
    /*
     * 需求方裁定：蓄谋牌**只有自己可见内容**，
     * 其他角色只知道「判定区里有 N 张蓄谋牌」。
     * 且蓄谋牌**不能被移动**。
     */
    const xm = player.xumou || [];
    if (xm.length) {
      const isOwner = me === player;
      if (isOwner) {
        const list = xm.map((c) => c.text)
          .join('、');
        html += `<div class="dp-sec">蓄谋牌（${xm.length} 张）</div>`
          + `<div class="dp-desc dp-xumou">${list}</div>`
          + `<div class="dp-hint">按「后置入先使用」在准备阶段依次使用</div>`;
      } else {
        html += `<div class="dp-sec">蓄谋牌</div>`
          + `<div class="dp-desc dp-xumou dim">`
          + `判定区有 ${xm.length} 张蓄谋牌（内容不可见）</div>`;
      }
    }

    /* ---- 隐匿状态 ---- */
    if (player.hidden) {
      html += `<div class="dp-sec">隐匿</div>`
        + `<div class="dp-desc">处于隐匿状态`
        + `（武将牌、体力值、体力上限、性别均不可见）</div>`;
    }

    /* ---- 状态：酩酊 ---- */
    if (player.game && typeof player.game.jiuActive === 'function'
      && player.game.jiuActive(player)) {
      html += `<div class="dp-sec">状态</div>`
        + `<div class="dp-desc">酩酊（使用了【酒】，本回合【杀】伤害 +1）</div>`;
    }

    /* ---- 命运回合 ---- */
    if (player.destinyTurn) {
      html += `<div class="dp-sec">命运回合</div>`
        + `<div class="dp-desc">拥有命运回合（轮次结束前额外执行一个回合）</div>`;
    }

    /* ---- 判定区 ---- */
    if (player.judges && player.judges.length) {
      const js = player.judges.map((c) => c.fullname).join('、');
      html += `<div class="dp-sec">判定区</div><div class="dp-desc">${js}</div>`;
    }

    /* ---- token ---- */
    const tokens = this.collectTokens ? this.collectTokens(player) : [];
    if (tokens.length) {
      const ts = tokens.map((t) => `${t.icon || '◆'} ${t.label}`).join('　');
      html += `<div class="dp-sec">标记</div><div class="dp-desc">${ts}</div>`;
    }

    html += `<div class="dp-hint">右键其他角色/技能/牌可查看对应详情</div>`;
    this.showDetailPop(html, ev);
  }

  /** 显示卡牌详情 */
  showCardDetail(card, ev) {
    if (!card) return;
    const def = CARDS[card.name] || {};
    const suit = SUITS[card.suit] || {};
    const typeText = def.type === 'basic' ? '基本牌'
      : def.type === 'trick' ? (def.delayed ? '延时锦囊' : '锦囊牌')
        : def.type === 'equip' ? '装备牌' : '牌';
    const subText = def.subtype ? (EQUIP_SLOT_MAP[def.subtype] || {}).label || '' : '';
    const natureText = card.nature === 'fire' ? '火焰属性'
      : card.nature === 'thunder' ? '雷电属性' : '';
    const meta = [
      `花色点数：${suit.label || ''}${numberLabel(card.number)}`,
      `类别：${typeText}${subText ? ' · ' + subText : ''}`,
      natureText ? `属性：${natureText}` : '',
      def.attackRange ? `攻击范围：${def.attackRange}` : '',
      card.zone ? `所在区域：${card.zone}` : '',
    ].filter(Boolean).join('　');
    const html = `
      <div class="dp-title">${def.fullname || card.name}</div>
      <div class="dp-sub">${meta}</div>
      <div class="dp-desc">${(def.desc || '（暂无描述）').replace(/\n/g, '<br>')}</div>
      ${def.tip ? `<div class="dp-hint">提示：${def.tip}</div>` : ''}
    `;
    this.showDetailPop(html, ev);
  }

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
  }

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
  }

  /** 渲染结束回合按钮的显隐（供 renderAction 调用） */
  refreshEndTurnBtn() {
    const me = this.game && this.game.players.find((p) => p.isHuman);
    if (me) this.renderEndTurnRow(me);
  }

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
  }

  /* ============================================================
   * 武将收藏（localStorage 持久化）
   * ============================================================ */

  loadFavorites() {
    try {
      const raw = localStorage.getItem('sgs_favorites');
      return raw ? JSON.parse(raw) : [];
    } catch (e) { return []; }
  }

  saveFavorites() {
    try {
      localStorage.setItem('sgs_favorites', JSON.stringify(this.favorites));
    } catch (e) { /* 隐私模式忽略 */ }
  }

  isFavorite(charId) {
    return this.favorites.includes(charId);
  }

  toggleFavorite(charId) {
    const i = this.favorites.indexOf(charId);
    if (i >= 0) this.favorites.splice(i, 1);
    else this.favorites.push(charId);
    this.saveFavorites();
    return this.isFavorite(charId);
  }

  buildPlayerNode(p, isSelf) {
    const g = this.game;
    const node = el('div', 'sgs-player');
    node.dataset.pid = p.id;
    if (!p.alive) node.classList.add('dead');
    if (g.currentPlayer === p) node.classList.add('current-turn');

    /*
     * 【隐匿】状态
     * ------------------------------------------------------------------
     * 需求方给定：隐匿角色**不可见武将牌、体力值、体力上限、性别**。
     * 因此这里不显示立绘与名字，改用「?」占位，
     * 体力条也不渲染具体数值。
     */
    const hidden = !!p.hidden;
    if (hidden) node.classList.add('is-hidden-player');

    // 右键武将牌 → 角色详情（含除外区等信息）
    node.oncontextmenu = (ev) => {
      ev.preventDefault();
      this.showPlayerDetail(p, ev);
    };

    // 头像
    const avWrap = el('div', 'sgs-avatar-wrap');
    if (hidden) {
      // 隐匿：不暴露武将牌
      const ph = el('div', 'sgs-hidden-avatar', '?');
      avWrap.appendChild(ph);
    } else {
      const img = el('img', 'sgs-avatar');
      img.alt = p.name;
      bindImageFallback(img, p.charId, p.name, {
        avatar: true,
        sex: p.sex === 'male' ? '♂' : p.sex === 'female' ? '♀' : '无',
      });
      img.src = charImgPath(p.charId);
      avWrap.appendChild(img);
    }

    // 势力
    const grp = GROUPS[p.group];
    if (!hidden && grp) {
      avWrap.appendChild(el('div', 'sgs-group-badge', grp.label)).style.background = grp.color;
    } else if (hidden) {
      avWrap.appendChild(el('div', 'sgs-group-badge', '?')).style.background = '#5a5a5a';
    }

    // 座位号（左上角）：绝对座位号，主公固定为 1 号位
    const me = g.players.find((x) => x.isHuman) || g.players[0];
    const seatNo = this.seatLabel(p);
    const seatEl = el('div', 'sgs-seat-badge', seatNo);
    if (p === me) seatEl.classList.add('me');
    seatEl.title = `${seatNo} 号位`
      + (p.isZhu ? '（主公）' : '')
      + (p === me ? '（你）' : '');
    avWrap.appendChild(seatEl);

    // 身份角标
    // 未公开时显示「?」，点击可标记自己推测的身份（仅本地记录，不影响规则）
    const idBadge = el('div', 'sgs-identity-badge');
    if (p.identityShown) {
      // 身份已公开 → 清除此前的本地推测标记
      if (this.identityMarks[p.id]) delete this.identityMarks[p.id];
      idBadge.textContent = IDENTITY_LABEL[p.identity];
      idBadge.style.background = IDENTITY_COLOR[p.identity];
      idBadge.classList.add('revealed');
      if (!p.alive) idBadge.classList.add('dead-identity');
    } else {
      const mark = this.identityMarks[p.id];
      if (mark) {
        // 玩家自己标记的推测身份：虚线框 + 问号后缀，与真实公开区分
        idBadge.textContent = IDENTITY_LABEL[mark] + '?';
        idBadge.style.background = IDENTITY_COLOR[mark];
        idBadge.classList.add('marked');
        idBadge.title = `你的推测：${IDENTITY_LABEL[mark]}（点击修改）`;
      } else {
        idBadge.textContent = '?';
        idBadge.classList.add('unknown');
        idBadge.title = '点击标记你推测的身份';
      }
      idBadge.classList.add('clickable');
      idBadge.onclick = (ev) => {
        ev.stopPropagation();
        this.openIdentityMark(p, idBadge);
      };
    }
    avWrap.appendChild(idBadge);

    // 体力
    const hp = el('div', 'sgs-hp');
    /*
     * 【隐匿】：体力值与体力上限均不可见 →
     * 不渲染具体点数，只给一个「?」占位。
     */
    if (hidden) {
      hp.appendChild(el('div', 'sgs-hp-hidden', '体力 ?'));
      hp.title = '隐匿状态：体力值与体力上限不可见';
    } else {
      for (let i = 0; i < p.maxHp; i++) {
        const d = el('div', 'sgs-hp-dot');
        d.classList.add(i < p.hp ? 'on' : 'off');
        hp.appendChild(d);
      }
    }
    avWrap.appendChild(hp);

    // 横置标识（铁索连环）：在头像上画一条横锁链
    if (p.isChained) {
      node.classList.add('chained');
      const chain = el('div', 'sgs-chain-mark');
      chain.innerHTML = '<span class="chain-link">⛓</span>';
      chain.title = '处于横置（连环）状态：受到属性伤害会传导';
      avWrap.appendChild(chain);
    }

    node.appendChild(avWrap);

    // 名字
    node.appendChild(el('div', 'sgs-pname', p.name));

    // 徽章
    const badges = el('div', 'sgs-badges');
    if (!isSelf) badges.appendChild(el('span', 'sgs-badge', `手 ${p.hand.length}`));
    const eqs = Object.values(p.equips).filter(Boolean);
    if (eqs.length) {
      const names = eqs.map((c) => CARDS[c.name].label).join('/');
      badges.appendChild(el('span', 'sgs-badge equip', names));
    }
    if (p.judges.length) {
      badges.appendChild(el('span', 'sgs-badge judge', `判 ${p.judges.length}`));
    }
    // 【蓄谋】：判定区里的蓄谋牌（他人只知道数量）
    if (p.xumou && p.xumou.length) {
      badges.appendChild(el('span', 'sgs-badge xumou', `谋 ${p.xumou.length}`));
    }
    // 【隐匿】标记
    if (hidden) {
      badges.appendChild(el('span', 'sgs-badge hidden-badge', '隐匿'));
    }
    node.appendChild(badges);

    // 点击选择目标
    node.onclick = () => {
      if (this.mode !== 'targets') return;
      if (!this.targetCandidates || !this.targetCandidates.includes(p)) return;
      this.toggleTarget(p);
    };

    return node;
  }

  toggleTarget(p) {
    const idx = this.selectedTargets.indexOf(p);
    if (idx >= 0) {
      this.selectedTargets.splice(idx, 1);
    } else {
      if (this.selectedTargets.length >= this.targetMax) return;
      this.selectedTargets.push(p);
    }
    this.renderSelectionState();
  }

  renderSelectionState() {
    // 目标高亮
    $$('.sgs-player').forEach((n) => {
      const pid = +n.dataset.pid;
      const g = this.game;
      const p = g.players.find((x) => x.id === pid);
      n.classList.toggle('targetable',
        this.mode === 'targets' && this.targetCandidates
        && this.targetCandidates.includes(p)
        && !this.selectedTargets.includes(p));
      const av = $('.sgs-avatar-wrap', n);
      if (av) {
        if (this.selectedTargets.includes(p)) {
          av.style.boxShadow = '0 0 0 3px #7fd4a8, 0 0 22px rgba(127,212,168,0.8)';
        } else {
          av.style.boxShadow = '';
        }
      }
    });

    // 手牌高亮
    $$('#sgs-self-hand .sgs-card').forEach((n) => {
      const cid = +n.dataset.cid;
      const me = this.game.players.find((p) => p.isHuman);
      const c = me.hand.find((x) => x.id === cid);
      if (!c) return;
      n.classList.toggle('selected', this.selectedCards.has(c));
    });

    // 自己也可以成为目标（如【铁索连环】【桃】）
    // sgs-self 不经过 buildPlayerNode，需要单独处理
    this.renderSelfTargetState();

    this.updateHintText();
    this.updateHintButtons();
  }

  /**
   * 自己作为目标时的选中状态与点击处理
   * ------------------------------------------------------------------
   * 对手的节点在 buildPlayerNode 里处理点击；
   * 「自己」的节点是自己那一块（sgs-self），需要单独接。
   */
  renderSelfTargetState() {
    const me = this.game.players.find((p) => p.isHuman);
    const selfEl = $('#sgs-self');
    if (!me || !selfEl) return;

    const canPick = this.mode === 'targets' && this.targetCandidates
      && this.targetCandidates.includes(me);
    const isPicked = this.selectedTargets.includes(me);

    selfEl.classList.toggle('self-targetable', !!canPick && !isPicked);
    selfEl.classList.toggle('self-targeted', isPicked);

    // 只在「可以选自己」时挂点击，避免干扰正常操作
    if (canPick) {
      selfEl.onclick = (e) => {
        // 点到手牌/按钮时不触发（那些有自己的处理）
        if (e.target.closest('.sgs-card')) return;
        if (e.target.closest('button')) return;
        if (e.target.closest('.sgs-act-btn')) return;
        this.toggleTarget(me);
      };
    } else {
      selfEl.onclick = null;
    }

    // 头像高亮
    const av = $('#sgs-self-avatar');
    if (av) {
      if (isPicked) av.style.boxShadow = '0 0 0 3px #7fd4a8, 0 0 22px rgba(127,212,168,0.8)';
      else av.style.boxShadow = '';
    }
  }

  updateHintText() {
    const hint = $('#sgs-hint-text');
    if (this.mode === 'cards') {
      hint.textContent = `${this.promptText}（已选 ${this.selectedCards.size}/${this.cardMin}${this.cardMax > this.cardMin ? `~${this.cardMax}` : ''}）`;
    } else if (this.mode === 'targets') {
      hint.textContent = `${this.promptText}（已选 ${this.selectedTargets.length}/${this.targetMin}${this.targetMax > this.targetMin ? `~${this.targetMax}` : ''}）`;
    } else {
      hint.textContent = this.promptText;
    }
  }

  updateHintButtons() {
    const ok = $('#sgs-hint-ok');
    if (this.mode === 'cards') {
      ok.disabled = this.selectedCards.size < this.cardMin;
    } else if (this.mode === 'targets') {
      ok.disabled = this.selectedTargets.length < this.targetMin;
    } else {
      ok.disabled = false;
    }
  }

  renderSelf(me) {
    // 头像
    const av = $('#sgs-self-avatar');
    av.innerHTML = '';
    // 右键自己的武将牌 → 角色详情（含自己的除外区内容）
    av.oncontextmenu = (ev) => {
      ev.preventDefault();
      this.showPlayerDetail(me, ev);
    };
    const img = el('img');
    img.alt = me.name;
    bindImageFallback(img, me.charId, me.name, { avatar: false });
    img.src = charImgPath(me.charId);
    av.appendChild(img);

    // 名字行：座位号 + 名字 + 势力 + 身份（身份在名字后面）
    const grp = GROUPS[me.group];
    const nameEl = $('#sgs-self-name');
    nameEl.innerHTML = '';
    const seatSelf = el('span', 'grp', `${this.seatLabel(me)} 号位`);
    seatSelf.style.background = IDENTITY_COLOR[me.identity] || '#3d8b6e';
    seatSelf.style.opacity = '0.9';
    nameEl.appendChild(seatSelf);
    nameEl.appendChild(document.createTextNode(me.name));
    const gb = el('span', 'grp', grp.label);
    gb.style.background = grp.color;
    nameEl.appendChild(gb);

    // 身份单独放（技能按钮要排在身份之后）
    const idEl = $('#sgs-self-identity');
    idEl.innerHTML = '';
    const ib = el('span', 'grp', IDENTITY_LABEL[me.identity]);
    ib.style.background = IDENTITY_COLOR[me.identity];
    idEl.appendChild(ib);
    if (!me.alive) {
      const dead = el('span', 'grp', '已阵亡');
      dead.style.background = '#555';
      idEl.appendChild(dead);
    }

    // ---------------- 体力 / 护甲（文字形式）----------------
    const statEl = $('#sgs-self-stat');
    statEl.innerHTML = '';
    const hpText = el('span', 'sgs-hp-text');
    const hpPart = el('span', 'hp-part' + (me.hp <= 1 ? ' low' : ''),
      `体力：${me.hp}/${me.maxHp}`);
    hpText.appendChild(hpPart);
    hpText.appendChild(el('span', 'sep', '｜'));
    const armor = me.hujia || 0;
    const armorPart = el('span', 'armor-part' + (armor === 0 ? ' zero' : ''),
      `护甲：${armor}/${me.maxHujia || armor}`);
    armorPart.title = '每点护甲可抵挡 1 点伤害，但不影响手牌上限';
    hpText.appendChild(armorPart);
    statEl.appendChild(hpText);

    // ---------------- 技能按钮（可点击发动）----------------
    // 位置：紧跟在身份之后。玩家自己按才发动，不再自动触发。
    const sk = $('#sgs-self-skills');
    sk.innerHTML = '';
    me.skills.forEach((sid) => {
      const s = SKILLS[sid];
      if (!s) return;
      const isActive = s.type === 'active' || s.trigger === 'phaseUse';
      const btn = el('button', 'sgs-skill-btn' + (s.locked ? ' locked' : ''),
        s.name);
      btn.title = `${s.name}：${s.desc}\n（右键查看详情）`;

      if (isActive) {
        // 主动技：可点击发动
        const usable = this.isSkillUsable ? this.isSkillUsable(me, s) : true;
        btn.disabled = !usable;
        if (usable) btn.classList.add('usable');
        btn.onclick = () => {
          if (btn.disabled) return;
          this.onSkillButtonClick(me, s);
        };
      } else {
        // 触发技 / 锁定技：不能主动按，只做展示
        btn.disabled = true;
        btn.classList.add('trigger-hint');
        btn.title = `${s.name}：${s.desc}\n（${s.locked ? '锁定技，' : ''}满足条件时自动询问）`;
      }
      // 右键查看详情
      btn.oncontextmenu = (ev) => {
        ev.preventDefault();
        this.showSkillDetail(me, s, ev);
      };
      sk.appendChild(btn);
    });

    // ---------------- 结束回合按钮（武将信息下方）----------------
    this.renderEndTurnRow(me);

    // ---------------- 接续信息：判定牌 / 横置 / token ----------------
    this.renderSelfExtras(me);

    // ================= 手牌区（只放真正的手牌）=================
    // 装备区的牌不在这里显示 —— 它们有自己的格子（见 renderEquipSlots）。
    const hand = $('#sgs-self-hand');
    hand.innerHTML = '';

    // 若当前处于「从外部牌池选牌」（如五谷丰登、从他人处选牌），
    // 则渲染那个牌池，而不是自己的手牌 —— 否则玩家无从下手。
    //
    // 关键：必须遵守信息隔离 —— 从他人处选牌时，
    // 对方的**暗置手牌**不能显示内容，只能用背面占位。
    if (this.mode === 'cards' && this.cardCandidates && this.cardPoolExternal) {
      hand.appendChild(el('div', 'sgs-pool-label', this.poolLabel || '请选择一张牌'));
      this.cardCandidates.forEach((c) => {
        const viewer = this.game.players.find((p) => p.isHuman) || me;
        const canSee = this.game.canSeeCard(c, viewer);
        if (canSee) {
          hand.appendChild(this.buildCardNode(c, me, false, true));
        } else {
          hand.appendChild(this.buildHiddenCardNode(c));
        }
      });
      return;
    }

    // 手牌排列：非装备牌按摸牌顺序；手牌里的装备牌排到最右侧，
    // 并按「武器 → 防具 → 宝物 → 进攻马 → 防御马」排序。
    const plain = [];
    const equipInHand = [];
    for (const c of me.hand) {
      if (c.type === 'equip') equipInHand.push(c);
      else plain.push(c);
    }
    const slotOrder = Object.fromEntries(EQUIP_SLOTS.map((s) => [s.key, s.order]));
    equipInHand.sort(
      (a, b) => (slotOrder[CARDS[a.name].subtype] || 9) - (slotOrder[CARDS[b.name].subtype] || 9),
    );

    plain.forEach((c) => hand.appendChild(this.buildCardNode(c, me)));
    equipInHand.forEach((c) => hand.appendChild(this.buildCardNode(c, me)));

    if (!me.hand.length) {
      hand.appendChild(el('div', 'sgs-badge', '（无手牌）'));
    }

    // 装备区格子（独立区域，与手牌分开）
    this.renderEquipSlots(me);
  }

  /**
   * 装备区格子
   * ------------------------------------------------------------------
   * 显示固定数量的槽位，让玩家明确哪些区域是空的、哪些有装备。
   * 支持「废除装备区」（槽位被废除时显示为禁用样式）。
   */
  renderEquipSlots(me) {
    const wrap = $('#sgs-self-equips');
    if (!wrap) return;
    wrap.innerHTML = '';

    for (const slot of EQUIP_SLOTS) {
      const card = me.equips[slot.key] || null;
      const disabled = me.isEquipSlotDisabled && me.isEquipSlotDisabled(slot.key);

      const cell = el('div', 'sgs-equip-slot');
      cell.dataset.slot = slot.key;

      // 槽位标签
      const label = el('div', 'sgs-equip-label', slot.label);
      cell.appendChild(label);

      if (disabled) {
        cell.classList.add('disabled');
        const ph = el('div', 'sgs-equip-empty', '废除');
        cell.appendChild(ph);
        cell.title = `${slot.label}区已被废除`;
      } else if (card) {
        cell.classList.add('filled');
        // 槽位内的牌（缩小版卡片）
        const node = this.buildCardNode(card, me, true);
        node.classList.add('slot-card');
        cell.appendChild(node);
        cell.title = `${card.fullname}：${CARDS[card.name] ? CARDS[card.name].desc : ''}`;
      } else {
        const ph = el('div', 'sgs-equip-empty', '空');
        cell.appendChild(ph);
        cell.title = `${slot.label}区（空）`;
      }

      wrap.appendChild(cell);
    }
  }

  /**
   * 手牌排序（仅用于手牌内部的装备排到右侧）
   * 已装备的牌不进手牌区，见 renderEquipSlots。
   */
  sortHandCards(cards) {
    const order = Object.fromEntries(EQUIP_SLOTS.map((s) => [s.key, s.order]));

    const hand = [];
    const equipInHand = [];
    for (const c of cards) {
      if (c.type === 'equip') equipInHand.push(c);
      else hand.push(c);
    }
    equipInHand.sort(
      (a, b) => (order[CARDS[a.name].subtype] || 9) - (order[CARDS[b.name].subtype] || 9),
    );
    return [...hand, ...equipInHand];
  }

  /**
   * 暗置牌（背面）节点
   * ----------------------------------------------------------------
   * 用于显示「看不到内容的牌」：他人的暗置手牌、牌堆等。
   * 只显示背面花纹，不含花色点数与牌名。
   *
   * 明置机制：手牌被明置后可以正常 buildCardNode 显示正面；
   * 展示（如火攻）是瞬时公开，由 engine 的 showingCards 标记，
   * 不改变牌的持久状态。
   */
  buildHiddenCardNode(card) {
    const node = el('div', 'sgs-card sgs-card-hidden');
    node.dataset.cid = card ? card.id : '';
    const face = el('div', 'card-face card-back');
    face.appendChild(el('div', 'card-back-mark', '谜'));
    node.appendChild(face);
    node.title = '暗置的牌（看不到内容）';

    /*
     * 【横置牌】的角标要加在**暗置**节点上
     * ----------------------------------------------------------------
     * 按需求方裁定：
     *   横置牌的内容对他人**不可见**（仍属暗置），
     *   但「这张牌是横置的」这一**状态**是全桌公开的，
     *   因此【顺手牵羊】时可以明确选中它、却仍不知道具体是什么牌。
     *
     * 所以角标必须在这里（隐藏节点）也渲染，否则别人根本
     * 无从得知哪张牌被横置了。
     */
    if (card && card.horizontal) {
      node.classList.add('is-horizontal');
      node.title = '暗置的牌（横置，内容不可见）';
      node.appendChild(el('span', 'sgs-card-tag horizontal', '横置'));
    }

    // 可选性依然保留：能选中但看不到是什么
    if (this.mode === 'cards' && this.cardCandidates
      && this.cardCandidates.includes(card)) {
      node.classList.add('selectable');
      node.onclick = () => this.toggleCard(card);
    }
    if (this.selectedCards.has(card)) node.classList.add('selected');
    return node;
  }

  buildCardNode(card, owner, isEquip) {
    const node = el('div', 'sgs-card');
    node.dataset.cid = card.id;
    node.classList.add(card.color === 'red' ? 'red' : 'black');
    node.classList.add(`type-${card.type}`);

    const face = el('div', 'card-face');
    const corner = el('div', 'card-corner',
      `<span>${card.suitLabel}</span><span class="num">${card.numberText}</span>`);
    face.appendChild(corner);

    const nameEl = el('div', 'card-name', CARDS[card.name] ? CARDS[card.name].label : card.name);
    face.appendChild(nameEl);

    const strip = el('div', 'card-type-strip');
    face.appendChild(strip);

    // ---- 属性标识（火杀 / 雷杀）----
    // 【朱雀羽扇】可将普通【杀】转为火【杀】，转换后必须能一眼看出来。
    const nature = card.nature || (CARDS[card.name] && CARDS[card.name].nature);
    if (nature === 'fire' || nature === 'thunder') {
      node.classList.add(`nature-${nature}`);
      const nb = el('div', 'card-nature', nature === 'fire' ? '火' : '雷');
      nb.title = nature === 'fire' ? '火焰属性伤害' : '雷电属性伤害';
      node.appendChild(nb);
    }

    node.appendChild(face);
    node.title = `${card.text}\n${CARDS[card.name] ? CARDS[card.name].desc : ''}\n（右键查看详情）`;

    // ---- 右键查看详情 ----
    node.oncontextmenu = (ev) => {
      ev.preventDefault();
      ev.stopPropagation();
      this.showCardDetail(card, ev);
    };

    if (isEquip) node.classList.add('is-equip');

    /*
     * ---- 本扩机制的可视化标记 ----
     * 【横置牌】：加角标（需求方确认用角标即可，不旋转）
     * 【明置牌】：加角标，表示此牌对所有人公开
     */
    if (card.horizontal) {
      node.classList.add('is-horizontal');
      node.appendChild(el('span', 'sgs-card-tag horizontal', '横置'));
    }
    if (card.revealed) {
      node.classList.add('is-revealed');
      node.appendChild(el('span', 'sgs-card-tag revealed', '明置'));
    }

    // ---- 可点击状态判定 ----
    // 三种情形：
    //   1. 正在「从牌池选牌」→ 池内牌可点选
    //   2. 正在「出牌阶段」     → 手牌可点击使用（可用性在点击后用窗口提示）
    //   3. 其他情况            → 不可点，但**视觉上不置灰**，避免整手牌发暗
    const inPool = this.cardCandidates && this.cardCandidates.includes(card);
    const isPlayPhase = this.mode === 'action';
    const isSelectMode = this.mode === 'cards';

    if (isSelectMode && inPool) {
      node.classList.add('selectable');
      node.onclick = () => this.toggleCard(card);
    } else if (isSelectMode && !inPool) {
      // 选牌模式下，非候选牌才置灰
      node.classList.add('disabled');
    } else if (isPlayPhase && !isEquip) {
      // 出牌阶段：手牌可点（具体能否使用，点击时再校验并提示）
      node.classList.add('playable');
    } else if (isEquip) {
      node.classList.add('equipped');
    }

    if (this.selectedCards.has(card)) node.classList.add('selected');

    return node;
  }

  toggleCard(card) {
    if (this.selectedCards.has(card)) {
      this.selectedCards.delete(card);
    } else {
      if (this.cardMax > 0 && this.selectedCards.size >= this.cardMax) {
        if (this.cardMax === 1) this.selectedCards.clear();
        else return;
      }
      this.selectedCards.add(card);
    }
    this.renderSelectionState();
  }

  /**
   * 中央区 / 判定区的**画面外**渲染
   * ------------------------------------------------------------------
   * 按需求，中央区不再显示在牌桌正中（改由顶栏「中央区」按钮查看），
   * 因此这里不再渲染中央区。判定区仍需要小徽章提示。
   */
  renderProcessing() {
    // 中央区已移到面板（见 renderCenterPanel），此处不再绘制
    // 判定区信息通过对手节点的徽章展示（buildPlayerNode 里已处理）
  }

  /**
   * 弃牌堆面板
   * ------------------------------------------------------------------
   * 展示弃牌堆全部牌（含中央区，因为中央区也算弃牌堆）。
   * 支持按类型筛选，便于玩家识别。
   */
  renderDiscardPile() {
    const g = this.game;
    const panel = $('#sgs-pile');
    if (!panel) return;

    const all = g.getDiscardPile();       // 含中央区
    const center = g.getCenterZone();
    const centerSet = new Set(center);

    panel.innerHTML = '';

    // 标题与统计
    const head = el('div', 'sgs-pile-head');
    head.appendChild(el('span', 'sgs-pile-title', '弃牌堆'));
    head.appendChild(el('span', 'sgs-pile-stat',
      `${all.length} 张（其中中央区 ${center.length} 张）`));
    const close = el('button', 'sgs-icon-btn', '关闭');
    close.onclick = () => panel.classList.add('hidden');
    head.appendChild(close);
    panel.appendChild(head);

    if (!all.length) {
      panel.appendChild(el('div', 'sgs-pile-empty', '弃牌堆为空'));
      return;
    }

    // 按类型分组，便于快速识别
    const groups = [
      ['basic', '基本牌'],
      ['trick', '锦囊牌'],
      ['equip', '装备牌'],
    ];

    // 倒序显示（最近弃置的在前）
    const listOf = (filterFn) => all.slice().reverse().filter(filterFn);

    for (const [type, label] of groups) {
      const list = listOf((c) => c.type === type);
      if (!list.length) continue;

      const sec = el('div', 'sgs-pile-section');
      sec.appendChild(el('div', 'sgs-pile-section-title', `${label}（${list.length}）`));
      const grid = el('div', 'sgs-pile-grid');
      list.forEach((c) => {
        const n = this.buildCardNode(c, null, true);
        // 中央区的牌加高亮，以示「本回合」
        if (centerSet.has(c)) n.classList.add('in-center');
        grid.appendChild(n);
      });
      sec.appendChild(grid);
      panel.appendChild(sec);
    }
  }

  /**
   * 中央区面板（点击按钮才显示）
   * ------------------------------------------------------------------
   * 只显示**本回合**打出的牌。回合结束后这些牌归档进弃牌堆，
   * 此处自然清空（详见引擎的 centerZone 语义）。
   */
  renderCenterPanel() {
    const g = this.game;
    const panel = $('#sgs-center-panel');
    if (!panel) return;

    const center = g.getCenterZone();
    const showing = g.getShowingCards();

    panel.innerHTML = '';

    const head = el('div', 'sgs-pile-head');
    head.appendChild(el('span', 'sgs-pile-title', '中央区'));
    head.appendChild(el('span', 'sgs-pile-stat',
      `本回合打出 ${center.length} 张 · 回合结束后移入弃牌堆`));
    const close = el('button', 'sgs-icon-btn', '关闭');
    close.onclick = () => panel.classList.add('hidden');
    head.appendChild(close);
    panel.appendChild(head);

    if (!center.length) {
      panel.appendChild(el('div', 'sgs-pile-empty', '本回合还没有打出任何牌'));
      return;
    }

    // 按打出顺序展示（最近的在前）
    const sec = el('div', 'sgs-pile-section');
    sec.appendChild(el('div', 'sgs-pile-section-title', `本回合（${center.length}）`));
    const grid = el('div', 'sgs-pile-grid');
    center.slice().reverse().forEach((c) => {
      const n = this.buildCardNode(c, g.currentPlayer, true);
      if (showing.includes(c)) n.classList.add('in-center');
      grid.appendChild(n);
    });
    sec.appendChild(grid);
    panel.appendChild(sec);

    // 说明文字，帮助理解这个区域的作用
    const tip = el('div', 'sgs-pile-tip');
    tip.textContent = '中央区的牌同时属于弃牌堆（可被「在弃牌堆找牌」的技能检索到）；'
      + '当前回合彻底结束后，这些牌会正式归档进弃牌堆，中央区随之清空。';
    panel.appendChild(tip);
  }

  renderLog() {
    const panel = $('#sgs-log');
    panel.innerHTML = '';
    const lines = this.game.logs.slice(-60);
    lines.forEach((l) => {
      const line = el('div', 'sgs-log-line', l.text);
      if (/伤害|阵亡|濒死|游戏结束|使用【/.test(l.text)) line.classList.add('hl');
      panel.appendChild(line);
    });
    panel.scrollTop = panel.scrollHeight;
  }

  /**
   * 设置提示条主文字
   * @param {string} text 主提示。支持 \n 换行（如技能名 + 技能描述两行）
   */
  setPrompt(text) {
    const p = $('#sgs-prompt');
    if (text) {
      // 重设主文字前，先摘掉旧的副文字（避免残留上一轮的说明）
      const oldSep = p.querySelector('.sgs-prompt-sep');
      const oldSub = p.querySelector('.sgs-prompt-sub');
      if (oldSep) oldSep.remove();
      if (oldSub) oldSub.remove();
      p.textContent = text;
      p.classList.remove('hidden');
    } else {
      p.textContent = '';
      p.classList.add('hidden');
    }
  }

  /**
   * 设置提示条的「副文字」（操作说明等）
   * ----------------------------------------------------------------
   * 需求：把「点击下方手牌以使用…」这类说明与主提示放在同一行，
   * 不再单独占一行、也不再压到手牌/装备区上面。
   *
   * 实现：主提示写进 #sgs-prompt 的文本节点，副文字作为
   * 一个 .sgs-prompt-sub 的 span 追加在后面，中间用分隔号隔开。
   */
  setPromptSub(subText) {
    const p = $('#sgs-prompt');
    if (!p) return;
    // 先清掉旧的副文字
    const old = p.querySelector('.sgs-prompt-sub');
    if (old) old.remove();
    if (!subText) return;
    const sep = el('span', 'sgs-prompt-sep', '｜');
    const sub = el('span', 'sgs-prompt-sub', subText);
    p.appendChild(sep);
    p.appendChild(sub);
  }

  /* ---------------- io 实现 ---------------- */
  _showHint() {
    $('#sgs-select-hint').classList.add('active');
  }
  _hideHint() {
    $('#sgs-select-hint').classList.remove('active');
  }

  /**
   * 选牌
   */
  chooseCards(player, { prompt, position = 'he', min = 1, max = 1, filter, cancelable = true, fromPlayer, cardList }) {
    return new Promise((resolve) => {
      // AI 不走这里
      if (!player.isHuman) {
        resolve(this._aiPick(player, { position, min, max, filter, fromPlayer, cardList }));
        return;
      }

      let pool;
      if (cardList) pool = cardList.slice();
      else if (fromPlayer) {
        // 从他人处选牌：位置与数量基于真实牌堆，
        // 但**内容**要遵守可见性（暗置手牌渲染成背面）
        pool = fromPlayer.getCards(position, filter);
      } else {
        pool = player.getCards(position, filter);
      }

      if (!pool.length) { resolve([]); return; }

      this.mode = 'cards';
      this.promptText = prompt;
      this.cardCandidates = pool;
      this.cardMin = min;
      this.cardMax = max;
      this.selectedCards = new Set();
      // 标记这是「外部牌池」（如五谷丰登），需要单独渲染出来
      this.cardPoolExternal = !!cardList || !!fromPlayer;
      this.poolLabel = cardList
        ? '请从下列牌中选择'
        : (fromPlayer ? `请选择 ${fromPlayer.name} 的一张牌` : '');

      this.render();
      this._showHint();
      this.updateHintText();
      this.updateHintButtons();

      const cleanup = () => {
        this.mode = null;
        this.cardCandidates = null;
        this.cardPoolExternal = false;
        this.poolLabel = '';
        this.selectedCards = new Set();
        this._hideHint();
        $('#sgs-hint-ok').onclick = null;
        $('#sgs-hint-cancel').onclick = null;
        this.setPrompt('');
        this.render();
      };

      $('#sgs-hint-ok').onclick = () => {
        const picked = [...this.selectedCards];
        if (picked.length < min) return;
        cleanup();
        resolve(picked);
      };
      $('#sgs-hint-cancel').onclick = () => {
        if (!cancelable) return;
        cleanup();
        resolve([]);
      };
      // 不可取消时隐藏取消按钮
      $('#sgs-hint-cancel').style.display = cancelable ? '' : 'none';

      this.setPrompt(prompt);
    });
  }

  _aiPick(player, { position, min, max, filter, fromPlayer, cardList }) {
    const g = this.game;
    let pool;
    if (cardList) pool = cardList.slice();
    else if (fromPlayer) pool = fromPlayer.getCards(position, filter);
    else pool = player.getCards(position, filter);
    if (!pool.length) return [];
    const sorted = pool.slice().sort((a, b) => g.ai.cardValue(a) - g.ai.cardValue(b));
    return sorted.slice(0, Math.max(min, 1));
  }

  /**
   * 选目标
   */
  chooseTargets(player, { prompt, candidates, min = 1, max = 1, card }) {
    return new Promise((resolve) => {
      if (!candidates.length) { resolve([]); return; }

      /*
       * 统一过滤：技能施加的目标限制（mod.targetLimit）
       * ----------------------------------------------------------------
       * 例如折桠【星火尽染寒】发动后，本回合使用的牌只能指定
       * 「手牌数或体力不小于你」的角色。
       *
       * ⚠️ 过滤必须发生在这里（进入选择界面之前），
       *    否则玩家会「选中了才被引擎拒绝」，体验很差。
       *    群体锦囊（南蛮/万箭）也走本函数，因此同样生效。
       */
      const g0 = this.game;
      if (g0 && card && typeof g0.canTargetByLimits === 'function') {
        candidates = candidates.filter(
          (t) => t === player || g0.canTargetByLimits(player, t, card),
        );
        if (!candidates.length) { resolve([]); return; }
        if (min > candidates.length) min = candidates.length;
      }

      if (!player.isHuman) {
        // AI 直接挑
        const g = this.game;
        const sorted = candidates.slice().sort((a, b) => {
          const ea = g.ai.attitude(player, a);
          const eb = g.ai.attitude(player, b);
          if (eb !== ea) return eb - ea;
          return a.hp - b.hp;
        });
        resolve(sorted.slice(0, min));
        return;
      }

      this.mode = 'targets';
      this.promptText = prompt;
      this.targetCandidates = candidates;
      this.targetMin = min;
      this.targetMax = max;
      this.selectedTargets = [];
      this.render();
      this._showHint();
      this.updateHintText();
      this.updateHintButtons();

      const cleanup = () => {
        this.mode = null;
        this.targetCandidates = null;
        this.selectedTargets = [];
        this._hideHint();
        $('#sgs-hint-ok').onclick = null;
        $('#sgs-hint-cancel').onclick = null;
        this.setPrompt('');
        this.render();
      };

      $('#sgs-hint-ok').onclick = () => {
        if (this.selectedTargets.length < min) return;
        const picked = this.selectedTargets.slice();
        cleanup();
        resolve(picked);
      };
      $('#sgs-hint-cancel').onclick = () => {
        cleanup();
        resolve([]);
      };
      $('#sgs-hint-cancel').style.display = '';
      this.setPrompt(prompt);
    });
  }

  /**
   * 「手牌与体力等价」：弃牌阶段用多少点体力代替弃牌
   * ----------------------------------------------------------------
   * 需要在 [minPay, maxPay] 之间选一个数；其余张数用手牌弃置。
   * 返回实际选择的扣体力数。
   */
  chooseHpPayment(player, excess, minPay, maxPay) {
    return new Promise((resolve) => {
      if (!player.isHuman) { resolve(minPay); return; }
      this.mode = 'confirm';
      const wrap = $('#sgs-actions');
      wrap.innerHTML = '';
      const prompt = `弃牌阶段：需弃置 ${excess} 张。`
        + `可用体力代替（每 1 点体力抵 1 张），请选择扣减几点体力：`;
      this.setPrompt(prompt);

      for (let n = minPay; n <= maxPay; n++) {
        const label = n === 0
          ? `0 点（弃 ${excess} 张手牌）`
          : `${n} 点体力（弃 ${excess - n} 张手牌）`;
        const b = el('button', 'sgs-act-btn primary', label);
        b.onclick = () => {
          wrap.innerHTML = '';
          this.mode = null;
          this.setPrompt('');
          resolve(n);
        };
        wrap.appendChild(b);
      }
    });
  }

  /**
   * 选项式选择（如刚烈：弃牌 or 受伤 / 是否发动技能）
   * ----------------------------------------------------------------
   * 布局（按需求调整）：
   *   · 提示文字 → 显示在「紧贴手牌区上端」的提示条里
   *   · 选项按钮 → 渲染到武将信息行（名字/体力）**后面**的空白处，
   *     这样信息行右侧不再空着，视觉上也更紧凑美观
   *
   * @param {object} [opts]
   * @param {object} [opts.skill] 若因技能而询问，按钮上可挂技能引用
   */
  chooseOption(player, prompt, options, opts = {}) {
    return new Promise((resolve) => {
      if (!player.isHuman) {
        // AI 简单策略
        if (options.some((o) => o.key === 'discard')) {
          resolve(player.countCards('h') >= 2 ? 'discard' : 'damage');
        } else {
          resolve(options[0].key);
        }
        return;
      }
      this.mode = 'confirm';
      this.promptText = prompt;

      // 按钮挂在武将信息行右侧
      const wrap = $('#sgs-self-info-actions') || $('#sgs-actions');
      wrap.innerHTML = '';
      this.setPrompt(prompt);

      const cleanup = () => {
        wrap.innerHTML = '';
        this.mode = null;
        this.setPrompt('');
      };

      options.forEach((o) => {
        const b = el('button', 'sgs-act-btn primary', o.label);
        if (opts.skill) b.dataset.skillId = opts.skill.id;
        b.onclick = () => {
          cleanup();
          resolve(o.key);
        };
        wrap.appendChild(b);
      });
    });
  }

  /**
   * 是否发动技能
   * ----------------------------------------------------------------
   * 规则（与无名杀一致，见 get.is.locked / content.js createTrigger）：
   *   - 必发效果（锁定技 / forced）**不询问**，直接发动。
   *   - 其余一律弹出确认框，且框内必须带上是哪个技能。
   *
   * 无名杀的判定顺序（get.is.locked，noname/get/is.js）：
   *   info.locked 为函数 → 用其返回值
   *   info.locked === false → 非锁定
   *   info.trigger && info.forced → 锁定（触发型必发）
   *   info.mod → 锁定（规则修改/永续效果）
   *   info.locked 其余真值 → 锁定
   *
   * 本项目对应：skill.locked / skill.forced / type === 'mod'。
   */
  isSkillForced(skill) {
    if (!skill) return false;
    if (typeof skill.locked === 'function') return !!skill.locked();
    if (skill.locked === false) return false;
    if (skill.forced) return true;
    if (skill.trigger && skill.forced) return true;
    if (skill.type === 'mod') return true;
    return !!skill.locked;
  }

  async askSkill(player, skill, ctx) {
    if (!player.isHuman) {
      return this.game.ai.decideSkill(player, skill, ctx);
    }
    // 必发效果直接生效，不询问
    if (this.isSkillForced(skill)) return true;

    // 确认框写明「是哪个技能」并附上该技能的**描述**。
    // 描述单独成行：技能描述常常很长，挤在括号里会把标题行拉得很宽、
    // 也不好读。用 \n 分成两行，由 CSS 的 white-space: pre-line 呈现。
    //
    //   是否发动【奸雄】？
    //   当你受到伤害后，你可以获得对你造成伤害的牌。
    const desc = (skill.desc || '').trim();
    const prompt = desc
      ? `是否发动【${skill.name}】？\n${desc}`
      : `是否发动【${skill.name}】？`;
    const use = await this.chooseOption(player, prompt, [
      { key: 'yes', label: '发动' },
      { key: 'no', label: '不发动' },
    ], { skill });
    return use === 'yes';
  }

  /**
   * 濒死求救
   */
  async confirmDying(saver, dying, viaSkill, count) {
    if (!saver.isHuman) return this.game.ai.shouldSave(saver, dying);
    const label = viaSkill ? `${SKILLS[viaSkill].name}（红色牌当桃）` : '桃';
    const r = await this.chooseOption(saver,
      `${dying.name} 濒死，是否使用【${label}】救助？（你有 ${count} 张可选）`,
      [{ key: 'yes', label: '救' }, { key: 'no', label: '不救' }]);
    return r === 'yes';
  }

  /** 八卦阵 */
  async askBagua(player) {
    if (!player.isHuman) return true;
    const r = await this.chooseOption(player, '是否发动【八卦阵】进行判定？',
      [{ key: 'yes', label: '发动' }, { key: 'no', label: '不发动' }]);
    return r === 'yes';
  }

  /** 无懈可击 */
  async askWuxie(player, source, card, currentlyNullified) {
    if (!player.isHuman) return this.game.ai.shouldWuxie(player, source, card, currentlyNullified);
    const action = currentlyNullified ? '反抵消' : '抵消';
    const r = await this.chooseOption(player,
      `${source.name} 使用了【${card.fullname}】，是否使用【无懈可击】${action}？`,
      [{ key: 'yes', label: `使用无懈（${action}）` }, { key: 'no', label: '不使用' }]);
    return r === 'yes';
  }

  /** 决斗中的杀 */
  async askShaForJuedou(player, game) {
    return false; // 由 engine.askSha 处理
  }

  /**
   * 观星调整牌序
   */
  /**
   * 观星式排列（牌堆顶 / 牌堆底 两栏分配）
   * ------------------------------------------------------------------
   * 参考无名杀的 chooseToGuanxing：
   *   上半栏 = 置于牌堆顶（顺序即放回顺序，先放的在上）
   *   下半栏 = 置于牌堆底
   * 玩家点击牌在两栏之间移动。
   */
  arrangeCards(player, cards, prompt) {
    return new Promise((resolve) => {
      if (!player.isHuman) {
        // AI：认为自己能抽到的留下，其余放底（简化策略）
        resolve({ top: cards, bottom: [] });
        return;
      }

      this.mode = 'arrange';
      this.arrangeAll = cards.slice();
      this.arrangeTop = cards.slice();   // 默认全部在顶栏
      this.arrangeBottom = [];           // 底栏初始为空
      this.setPrompt(prompt || '观星：点击牌可在「牌堆顶 / 牌堆底」之间移动');

      const panel = $('#sgs-arrange');
      panel.classList.add('active');
      this.renderArrange();

      const done = el('button', 'sgs-act-btn primary', '确 定');
      done.onclick = () => {
        panel.classList.remove('active');
        panel.innerHTML = '';
        this.mode = null;
        this.setPrompt('');
        resolve({ top: this.arrangeTop.slice(), bottom: this.arrangeBottom.slice() });
      };
      const btnWrap = $('#sgs-arrange-btns');
      btnWrap.appendChild(done);
    });
  }

  /** 渲染观星面板 */
  renderArrange() {
    const panel = $('#sgs-arrange');
    const body = $('#sgs-arrange-body');
    body.innerHTML = '';

    const topRow = el('div', 'sgs-arrange-row');
    topRow.appendChild(el('div', 'sgs-arrange-label', `牌堆顶（${this.arrangeTop.length}）`));
    const topGrid = el('div', 'sgs-arrange-grid');
    this.arrangeTop.forEach((c) => {
      const n = this.buildCardNode(c, null, true);
      n.classList.add('arrange-card');
      n.onclick = () => {
        this.arrangeTop = this.arrangeTop.filter((x) => x !== c);
        this.arrangeBottom.push(c);
        this.renderArrange();
      };
      topGrid.appendChild(n);
    });
    if (!this.arrangeTop.length) topGrid.appendChild(el('div', 'sgs-arrange-empty', '（空）'));
    topRow.appendChild(topGrid);
    body.appendChild(topRow);

    const botRow = el('div', 'sgs-arrange-row');
    botRow.appendChild(el('div', 'sgs-arrange-label', `牌堆底（${this.arrangeBottom.length}）`));
    const botGrid = el('div', 'sgs-arrange-grid');
    this.arrangeBottom.forEach((c) => {
      const n = this.buildCardNode(c, null, true);
      n.classList.add('arrange-card');
      n.onclick = () => {
        this.arrangeBottom = this.arrangeBottom.filter((x) => x !== c);
        this.arrangeTop.push(c);
        this.renderArrange();
      };
      botGrid.appendChild(n);
    });
    if (!this.arrangeBottom.length) botGrid.appendChild(el('div', 'sgs-arrange-empty', '（空）'));
    botRow.appendChild(botGrid);
    body.appendChild(botRow);

    const tip = el('div', 'sgs-arrange-tip',
      '点击牌可在两栏之间移动。牌堆顶的牌会按此处从左到右的顺序被摸到。');
    body.appendChild(tip);
  }

  /**
   * 出牌阶段主循环动作
   */
  chooseAction(player, game) {
    return new Promise((resolve) => {
      if (!player.isHuman) {
        const a = game.ai.decideAction(player);
        // 稍作延迟模拟思考
        setTimeout(() => resolve(a), 420);
        return;
      }

      this.mode = 'action';
      const wrap = $('#sgs-actions');
      wrap.innerHTML = '';

      const hand = player.hand;

      /*
       * 提示文字与操作说明**合并到同一行**，不再单独占一行。
       * 由 .sgs-prompt 的 .sgs-prompt-sub 子元素呈现，
       * 视觉上与主提示同一行（用分隔号隔开）。
       */
      this.setPrompt('出牌阶段：请选择要使用的牌');
      this.setPromptSub('点击下方手牌以使用；需要选择目标时按提示点击角色');
      this._hideHint();

      const cleanup = () => {
        this.mode = null;
        this.endTurnResolver = null;
        this.selectedPlayCard = null;
        this.setPrompt('');
        $('#sgs-self-hand').onclick = null;
        wrap.innerHTML = '';
        const row = $('#sgs-endturn-row');
        if (row) row.innerHTML = '';
        const rr = $('#sgs-recast-row');
        if (rr) rr.innerHTML = '';
        this._renderRecastRow = null;
      };

      /*
       * 【结束回合】按钮**不在这里**。
       * 按需求它应该独立放在「武将信息下方、手牌上方」，
       * 由 renderEndTurnRow() 渲染到 #sgs-endturn-row。
       * 这里只把 resolver 挂上，供那个按钮回调。
       */
      this.endTurnResolver = () => {
        cleanup();
        resolve({ type: 'end' });
      };

      // 渲染结束回合按钮（独立一行）
      this.renderEndTurnRow(player);

      /*
       * 【重铸】按钮
       * ----------------------------------------------------------------
       * 带 recastable 标记的牌（【铁索连环】【木牛流马】）可以在出牌阶段
       * 置入弃牌堆并摸一张牌。之前只有引擎支持、没有入口，
       * 导致玩家「找不到重铸的方式」。
       *
       * 交互：点一下手牌选中它 → 若该牌可重铸，就出现【重铸】按钮。
       */
      const renderRecastRow = () => {
        const row = $('#sgs-recast-row');
        if (!row) return;
        const sel = this.selectedPlayCard;
        const def = sel && CARDS[sel.name];
        row.innerHTML = '';
        if (!sel || !def || !def.recastable) return;
        const btn = el('button', 'sgs-act-btn', `重铸【${def.fullname}】`);
        btn.title = '将此牌置入弃牌堆，然后摸一张牌';
        btn.onclick = async () => {
          row.innerHTML = '';
          this.selectedPlayCard = null;
          this.render();
          this.setPrompt(`重铸【${def.fullname}】…`);
          await player.recast([sel]);
          this.logRecast && this.logRecast();
          this.setPrompt('出牌阶段：请选择要使用的牌或技能');
          this.render();
        };
        row.appendChild(btn);
      };
      this._renderRecastRow = renderRecastRow;

      // 绑定手牌点击（只响应手牌区，不响应装备区）
      $('#sgs-self-hand').onclick = async (e) => {
        const cardNode = e.target.closest('.sgs-card');
        if (!cardNode) return;
        // 装备区在另一个容器里，不会被这里命中；
        // 此处只从手牌中查找，装备牌无法被"使用"。
        const cid = +cardNode.dataset.cid;
        const card = hand.find((c) => c.id === cid);
        if (!card) return;

        // 双重保险：已装备的牌不允许使用
        if (Object.values(player.equips).some((c) => c === card)) {
          this.setPrompt('该牌已在装备区，无法再次使用');
          setTimeout(() => this.setPrompt('出牌阶段：请选择要使用的牌或技能'), 1600);
          return;
        }

        // 检查是否可用
        const check = this.checkCardUsable(player, card, game);
        if (!check.ok) {
          /*
           * 不可用，但如果这张牌**可重铸**，就给出重铸入口，
           * 而不是只弹一句「不能用」——玩家否则会找不到重铸方式。
           */
          const cdef = CARDS[card.name];
          if (cdef && cdef.recastable) {
            this.selectedPlayCard = card;
            renderRecastRow();
            this.setPrompt(`【${cdef.fullname}】${check.reason}；`
              + `但你可以把它重铸（置入弃牌堆并摸一张牌）`);
            return;
          }
          this.setPrompt(check.reason);
          setTimeout(() => this.setPrompt('出牌阶段：请选择要使用的牌或技能'), 1600);
          return;
        }

        // 可重铸的牌：单击先选中，给出「使用 / 重铸」两个选择
        const cdef2 = CARDS[card.name];
        if (cdef2 && cdef2.recastable) {
          this.selectedPlayCard = card;
          renderRecastRow();
          this.setPrompt(`已选中【${cdef2.fullname}】：可正常使用，`
            + `或点下方【重铸】置换一张牌`);
          return;
        }

        /*
         * 统一过滤候选目标
         * ----------------------------------------------------------------
         * 技能可以通过 mod.targetLimit 收窄「谁能成为目标」
         *（如折桠【星火尽染寒】：本回合只能指定手牌数或体力不小于你的角色）。
         *
         * ⚠️ 必须在**弹出选择界面之前**就过滤掉，
         *    否则会出现「先让你选中、点了确定才被引擎弹回来」的糟糕体验。
         */
        if (check.needTargets && check.needTargets.length) {
          const legal = check.needTargets.filter(
            (t) => t === player || game.canTargetByLimits(player, t, card),
          );
          if (!legal.length) {
            this.setPrompt(`没有符合条件的目标（本回合的目标限制）`);
            setTimeout(() => this.setPrompt('出牌阶段：请选择要使用的牌或技能'), 1600);
            return;
          }
          check.needTargets = legal;
          // 候选被收窄后，最小目标数也要跟着调整
          if (check.targetMin > legal.length) check.targetMin = legal.length;
        }

        let targets = [];

        // ---- 自动指定目标（桃/无中生有/闪电等只对自己）----
        if (check.autoTargets && check.autoTargets.length) {
          targets = check.autoTargets.slice();
        } else if (check.needTargets && check.needTargets.length) {
          // ---- 需要玩家点选目标 ----
          const picked = await this.chooseTargets(player, {
            prompt: check.targetPrompt || `【${(CARDS[card.name] || {}).fullname}】请选择目标`,
            candidates: check.needTargets,
            min: check.targetMin || 1,
            max: check.targetMax || 1,
            card,          // 传入牌，供 chooseTargets 应用目标限制
          });
          if (!picked || !picked.length) {
            // 玩家取消 → 回到出牌阶段，不消耗这张牌
            this.setPrompt('已取消，请重新选择要使用的牌');
            setTimeout(() => this.setPrompt('出牌阶段：请选择要使用的牌或技能'), 1400);
            return;
          }
          targets = picked;

          // 借刀杀人：需要第二个目标（其攻击范围内的角色）
          if (check.needSecond) {
            const holder = picked[0];
            const victims = game.players.filter(
              (p) => p.alive && p !== holder && p !== player && holder.inAttackRange(p),
            );
            if (victims.length) {
              const v = await this.chooseTargets(player, {
                prompt: `【借刀杀人】请选择 ${holder.name} 攻击范围内的目标`,
                candidates: victims,
                min: 1,
                max: 1,
              });
              if (v && v.length) targets.push(v[0]);
            }
            if (targets.length < 2) {
              this.setPrompt('已取消，请重新选择要使用的牌');
              setTimeout(() => this.setPrompt('出牌阶段：请选择要使用的牌或技能'), 1400);
              return;
            }
          }
        }

        cleanup();
        resolve({ type: 'use', card, targets });
      };
    });
  }

  /**
   * 检查牌在当前出牌阶段是否可用，返回 { ok, reason, needTargets }
   */
  checkCardUsable(player, card, game) {
    const def = CARDS[card.name];
    if (!def) return { ok: false, reason: '此牌无法使用' };
    if (def.respondOnly) return { ok: false, reason: `【${def.fullname}】只能在响应时使用` };

    // 已装备的牌不能被使用（三国杀原版机制）
    if (Object.values(player.equips).some((c) => c === card)) {
      return { ok: false, reason: `【${def.fullname}】已在装备区，无法再次使用` };
    }

    // 装备区被废除时不能装备
    if (def.type === 'equip' && player.isEquipSlotDisabled
      && player.isEquipSlotDisabled(def.subtype)) {
      return { ok: false, reason: '该装备区已被废除，无法装备' };
    }

    const g = game;
    const others = g.players.filter((p) => p.alive && p !== player);

    switch (card.name) {
      // ---- 【杀】：攻击范围内的一名其他角色 ----
      case 'sha': {
        const used = player.flags.usedShaThisTurn || 0;
        const unlimited = game.shaUnlimited(player)
          || (player.flags && player.flags.shaNoLimitThisTurn);
        // 官方规则：只有**自己的出牌阶段内**才限制【杀】的次数。
        // 出牌阶段之外（如【剪辑高手】在回合结束时视为使用）不受限。
        const inMyPlayPhase = game.isInPlayPhase
          ? game.isInPlayPhase(player) : true;
        if (inMyPlayPhase && !unlimited && used >= 1) {
          return { ok: false, reason: '本回合已使用过【杀】' };
        }
        const cands = others.filter((p) => player.inAttackRange(p)
          && game.canBeTargeted(p, card));
        if (!cands.length) return { ok: false, reason: '攻击范围内没有可选目标' };
        return {
          ok: true, needTargets: cands, targetMin: 1, targetMax: 1,
          targetPrompt: '【杀】请选择攻击范围内的一名角色',
        };
      }

      // ---- 【桃】：只对自己 ----
      case 'tao': {
        if (!player.isDamaged()) return { ok: false, reason: '体力已满，无需使用【桃】' };
        return { ok: true, autoTargets: [player] };
      }

      // ---- 【无中生有】：只对自己 ----
      case 'wuzhong':
        return { ok: true, autoTargets: [player] };

      // ---- 【闪电】：只对自己 ----
      case 'shandian': {
        if (player.judges.length >= 2) return { ok: false, reason: '判定区已满' };
        return { ok: true, autoTargets: [player] };
      }

      // ---- 【决斗】：一名其他角色 ----
      case 'juedou': {
        const cands = others.filter((p) => game.canBeTargeted(p, card));
        if (!cands.length) return { ok: false, reason: '没有可选目标' };
        return {
          ok: true, needTargets: cands, targetMin: 1, targetMax: 1,
          targetPrompt: '【决斗】请选择一名其他角色',
        };
      }

      // ---- 【过河拆桥】：区域内有牌的其他角色 ----
      case 'guohe': {
        const cands = others.filter((p) => p.countCards('hej') > 0);
        if (!cands.length) return { ok: false, reason: '没有区域内有牌的目标' };
        return {
          ok: true, needTargets: cands, targetMin: 1, targetMax: 1,
          targetPrompt: '【过河拆桥】请选择一名区域内有牌的角色',
        };
      }

      // ---- 【顺手牵羊】：距离 1 内且区域内有牌 ----
      case 'shunshou': {
        const noDist = game.trickNoDistance(player);
        const cands = others.filter((p) => p.countCards('hej') > 0
          && (noDist || player.distanceTo(p) <= 1)
          && game.canBeTargeted(p, card));
        if (!cands.length) return { ok: false, reason: '距离 1 内没有可选目标' };
        return {
          ok: true, needTargets: cands, targetMin: 1, targetMax: 1,
          targetPrompt: '【顺手牵羊】请选择距离 1 内的一名角色',
        };
      }

      // ---- 【乐不思蜀】：一名**其他**角色（不能是自己）----
      case 'lebu': {
        const cands = others.filter((p) => game.canBeTargeted(p, card)
          && p.judges.length < 2);
        if (!cands.length) return { ok: false, reason: '没有可选目标（不能对自己使用）' };
        return {
          ok: true, needTargets: cands, targetMin: 1, targetMax: 1,
          targetPrompt: '【乐不思蜀】请选择一名其他角色（不能选自己）',
        };
      }

      // ---- 【借刀杀人】：持武器者 + 其攻击范围内的一名角色 ----
      case 'jiedao': {
        const holders = others.filter((p) => p.equips.equip1);
        if (!holders.length) return { ok: false, reason: '没有装备武器的目标' };
        return {
          ok: true, needTargets: holders, targetMin: 1, targetMax: 1,
          needSecond: true,
          targetPrompt: '【借刀杀人】请选择一名装备武器的角色',
        };
      }

      // ---- 【无需选目标的牌】 ----
      case 'wugu':
      case 'taoyuan':
      case 'nanman':
      case 'wanjian':
        return { ok: true };

      /* ================= 风林火山 ================= */

      // ---- 【酒】：只对自己 ----
      case 'jiu': {
        // 濒死时等同【桃】；平时每回合限一次
        if (player.hp <= 0) return { ok: true, autoTargets: [player] };
        const used = player.flags.jiuUsed || 0;
        if (used >= 1) return { ok: false, reason: '本回合已使用过【酒】' };
        return { ok: true, autoTargets: [player] };
      }

      // ---- 【火攻】：一名有手牌的其他角色 ----
      case 'huogong': {
        const cands = others.filter((p) => p.countCards('h') > 0
          && game.canBeTargeted(p, card));
        if (!cands.length) return { ok: false, reason: '没有有手牌的可选目标' };
        return {
          ok: true, needTargets: cands, targetMin: 1, targetMax: 1,
          targetPrompt: '【火攻】请选择一名有手牌的角色',
        };
      }

      // ---- 【铁索连环】：1~2 名角色（可以包括自己） ----
      case 'tiesuo': {
        const cands = g.players.filter((p) => p.alive && game.canBeTargeted(p, card));
        if (!cands.length) return { ok: false, reason: '没有可选目标' };
        return {
          ok: true, needTargets: cands, targetMin: 1, targetMax: 2,
          targetPrompt: '【铁索连环】请选择 1~2 名角色（横置/重置）',
        };
      }

      // ---- 【兵粮寸断】：距离 1 内的一名其他角色 ----
      case 'bingliang': {
        const cands = others.filter((p) => game.canBeTargeted(p, card)
          && p.judges.length < 2
          && (game.trickNoDistance(player) || player.distanceTo(p) <= 1));
        if (!cands.length) return { ok: false, reason: '距离 1 内没有可选目标（不能对自己使用）' };
        return {
          ok: true, needTargets: cands, targetMin: 1, targetMax: 1,
          targetPrompt: '【兵粮寸断】请选择距离 1 内的一名其他角色',
        };
      }

      default:
        // 装备牌：直接装备
        if (def.type === 'equip') return { ok: true };
        return { ok: true };
    }
  }

  /* ---------------- 结算界面 ---------------- */
  showResult(game) {
    return new Promise((resolve) => {
      const modal = $('#sgs-result-modal');
      modal.classList.add('active');
      const box = $('.sgs-modal-box', modal);
      box.innerHTML = '';

      const me = game.players.find((p) => p.isHuman);
      const win = game.winner === me.identity
        || (game.winner === 'zhu' && (me.identity === 'zhu' || me.identity === 'zhong'))
        || (game.winner === 'fan' && me.identity === 'fan');

      const title = el('div', `sgs-result-big ${win ? 'win' : 'lose'}`, win ? '胜 利' : '失 败');
      box.appendChild(title);

      const winnerNames = { zhu: '主公方', fan: '反贼方', nei: '内奸', draw: '平局' };
      box.appendChild(el('div', 'sgs-result-sub',
        `${winnerNames[game.winner] || game.winner} 获胜 · 共 ${game.turnCount} 回合`));

      // 玩家列表
      const list = el('div', 'sgs-result-list');
      game.players.forEach((p) => {
        const row = el('div', 'sgs-result-row');
        if (p.isHuman) row.classList.add('me');
        row.appendChild(el('span', 'rname', p.name + (p.isHuman ? '（你）' : '')));
        const id = el('span', 'rid', IDENTITY_LABEL[p.identity]);
        id.style.background = IDENTITY_COLOR[p.identity];
        row.appendChild(id);
        row.appendChild(el('span', 'rstate',
          p.alive ? `存活 · 体力 ${p.hp}/${p.maxHp}` : '已阵亡'));
        list.appendChild(row);
      });
      box.appendChild(list);

      const btnWrap = el('div', '', '');
      btnWrap.style.cssText = 'display:flex;justify-content:center;gap:12px;';
      const again = el('button', 'sgs-act-btn primary', '再来一局');
      again.style.padding = '10px 34px';
      again.onclick = () => location.reload();
      btnWrap.appendChild(again);
      box.appendChild(btnWrap);

      resolve();
    });
  }
}

export default UI;