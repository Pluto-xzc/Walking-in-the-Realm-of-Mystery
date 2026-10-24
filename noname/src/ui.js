/**
 * 界面渲染与交互
 * ------------------------------------------------------------------
 * 负责：
 *   - 渲染牌桌、玩家、手牌
 *   - 提供引擎所需的 io 接口（选牌 / 选目标 / 确认）
 *   - 开屏开源声明与资源加载
 */

import { CARDS, numberLabel, SUITS, EQUIP_SLOTS } from './cards.js';
import { CHARACTERS, GROUPS } from './characters.js';
import { SKILLS } from './skills.js';
import { IDENTITY_LABEL, IDENTITY_COLOR } from './match.js';

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

/** 武将立绘路径（你放置的 PNG；不存在时自动回退到占位图） */
export function charImgPath(id) {
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
    this.mode = null;          // 'cards' | 'targets' | 'action' | 'confirm'
    this.promptText = '';
    this.config = {};
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
  chooseCharacter(charIds, isLord) {
    return new Promise((resolve) => {
      const modal = $('#sgs-char-modal');
      modal.classList.add('active');

      const box = $('.sgs-modal-box', modal);
      box.innerHTML = '';
      box.appendChild(el('div', 'sgs-modal-title', isLord ? '选 择 主 公' : '选 择 武 将'));
      box.appendChild(el('div', 'sgs-modal-sub',
        isLord ? '你是主公，请从常备主公中选择一名' : '请选择一名武将开始游戏'));

      const grid = el('div', 'sgs-char-grid');
      let picked = null;

      charIds.forEach((id) => {
        const ch = CHARACTERS[id];
        const card = el('div', 'sgs-char-pick');
        const img = el('img', 'pick-img');
        img.alt = ch.name;
        bindImageFallback(img, id, ch.name);
        img.src = charImgPath(id);
        card.appendChild(img);
        const info = el('div', 'pick-info');
        info.appendChild(el('div', 'pick-name', ch.name));
        info.appendChild(el('div', 'pick-skills',
          ch.skills.map((s) => (SKILLS[s] ? SKILLS[s].name : s)).join(' · ')));
        card.appendChild(info);

        card.onclick = () => {
          $$('.sgs-char-pick', grid).forEach((c) => c.classList.remove('selected'));
          card.classList.add('selected');
          picked = id;
          confirmBtn.disabled = false;
        };
        grid.appendChild(card);
      });
      box.appendChild(grid);

      const btnWrap = el('div', '', '');
      btnWrap.style.cssText = 'display:flex;justify-content:center;gap:12px;margin-top:20px;';
      const confirmBtn = el('button', 'sgs-act-btn primary', '确 定');
      confirmBtn.disabled = true;
      confirmBtn.style.padding = '10px 40px';
      confirmBtn.onclick = () => {
        if (!picked) return;
        modal.classList.remove('active');
        resolve(picked);
      };
      btnWrap.appendChild(confirmBtn);
      box.appendChild(btnWrap);
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
        <button class="sgs-icon-btn" id="sgs-toggle-pile">弃牌堆</button>
        <button class="sgs-icon-btn" id="sgs-toggle-log">日志</button>
        <button class="sgs-icon-btn" id="sgs-restart">重新开始</button>
        <a class="sgs-icon-btn sgs-home-btn" id="sgs-home" href="/" title="返回主站">← 返回主站</a>
        <span class="sgs-topbar-info" id="sgs-topbar-info"></span>
      </div>
      <div class="sgs-board">
        <div class="sgs-opponents" id="sgs-opponents"></div>
        <div class="sgs-center">
          <div class="sgs-center-label">中央区（本回合打出）</div>
          <div class="sgs-processing" id="sgs-processing"></div>
          <div class="sgs-prompt hidden" id="sgs-prompt"></div>
        </div>
        <div class="sgs-log-panel" id="sgs-log"></div>
        <div class="sgs-pile-panel hidden" id="sgs-pile"></div>
      </div>
      <div class="sgs-self" id="sgs-self">
        <div class="sgs-self-top">
          <div class="sgs-self-avatar" id="sgs-self-avatar"></div>
          <div class="sgs-self-info">
            <div class="sgs-self-name" id="sgs-self-name"></div>
            <div class="sgs-self-skills" id="sgs-self-skills"></div>
          </div>
        </div>
        <div class="sgs-self-hand" id="sgs-self-hand"></div>
        <div class="sgs-self-equips" id="sgs-self-equips"></div>
      </div>
      <div class="sgs-actions" id="sgs-actions"></div>
      <div class="sgs-select-hint" id="sgs-select-hint">
        <div class="hint-text" id="sgs-hint-text"></div>
        <div class="hint-btns">
          <button class="sgs-act-btn primary" id="sgs-hint-ok">确 定</button>
          <button class="sgs-act-btn" id="sgs-hint-cancel">取 消</button>
        </div>
      </div>
    `;
    document.body.appendChild(table);

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
  }

  bindGlobal() {
    document.addEventListener('click', (e) => {
      if (e.target.id === 'sgs-toggle-log') {
        $('#sgs-log').classList.toggle('hidden');
      }
      if (e.target.id === 'sgs-toggle-pile') {
        const pile = $('#sgs-pile');
        pile.classList.toggle('hidden');
        if (!pile.classList.contains('hidden')) this.renderDiscardPile();
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

    // 按「出牌顺序」排列：从自己的下家开始依次排开。
    // 这样左侧第一个就是下一个行动的角色，符合实际对战直觉。
    const alive = g.players.filter((p) => p.alive);
    const order = [...alive, ...g.players.filter((p) => !p.alive)];
    const myIdx = order.indexOf(me);
    const rotated = myIdx >= 0
      ? [...order.slice(myIdx + 1), ...order.slice(0, myIdx)]
      : order;
    const sorted = rotated.filter((p) => p !== me);

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

    // 体力点：数量或状态变化时重建
    const avWrap = node.querySelector('.sgs-avatar-wrap');
    if (avWrap) {
      const hp = avWrap.querySelector('.sgs-hp');
      const needRebuild = !hp
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
        avWrap.appendChild(nhp);
      }

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
      const sig = parts.join('|');
      if (badges.dataset.sig !== sig) {
        badges.dataset.sig = sig;
        badges.innerHTML = '';
        badges.appendChild(el('span', 'sgs-badge', `手 ${p.hand.length}`));
        if (eqs.length) {
          badges.appendChild(el('span', 'sgs-badge equip',
            eqs.map((c) => (CARDS[c.name] || {}).label || c.name).join('/')));
        }
        if (p.judges.length) {
          badges.appendChild(el('span', 'sgs-badge judge', `判 ${p.judges.length}`));
        }
      }
    }
  }

  /** 座位号显示文本（从自己开始，自己为 1 号位） */
  seatLabel(player, me) {
    if (player === me) return '1';
    const g = this.game;
    const n = g.players.length;
    // 以自己为 1 号，按座位顺序递增
    const diff = (player.seat - me.seat + n) % n;
    return String(diff + 1);
  }

  buildPlayerNode(p, isSelf) {
    const g = this.game;
    const node = el('div', 'sgs-player');
    node.dataset.pid = p.id;
    if (!p.alive) node.classList.add('dead');
    if (g.currentPlayer === p) node.classList.add('current-turn');

    // 头像
    const avWrap = el('div', 'sgs-avatar-wrap');
    const img = el('img', 'sgs-avatar');
    img.alt = p.name;
    bindImageFallback(img, p.charId, p.name, {
      avatar: true,
      sex: p.sex === 'male' ? '♂' : '♀',
    });
    img.src = charImgPath(p.charId);
    avWrap.appendChild(img);

    // 势力
    const grp = GROUPS[p.group];
    avWrap.appendChild(el('div', 'sgs-group-badge', grp.label)).style.background = grp.color;

    // 座位号（左上角，便于识别行动顺序）
    const me = g.players.find((x) => x.isHuman) || g.players[0];
    const seatEl = el('div', 'sgs-seat-badge', this.seatLabel(p, me));
    if (p === me) seatEl.classList.add('me');
    seatEl.title = p === me
      ? '你是 1 号位'
      : `站位 ${this.seatLabel(p, me)} 号（以你为 1 号）`;
    avWrap.appendChild(seatEl);

    // 身份
    const idBadge = el('div', 'sgs-identity-badge');
    if (p.identityShown) {
      idBadge.textContent = IDENTITY_LABEL[p.identity];
      idBadge.style.background = IDENTITY_COLOR[p.identity];
    } else {
      idBadge.textContent = '?';
      idBadge.classList.add('hidden');
    }
    avWrap.appendChild(idBadge);

    // 体力
    const hp = el('div', 'sgs-hp');
    for (let i = 0; i < p.maxHp; i++) {
      const d = el('div', 'sgs-hp-dot');
      d.classList.add(i < p.hp ? 'on' : 'off');
      hp.appendChild(d);
    }
    avWrap.appendChild(hp);
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

    this.updateHintText();
    this.updateHintButtons();
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
    const img = el('img');
    img.alt = me.name;
    bindImageFallback(img, me.charId, me.name, { avatar: false });
    img.src = charImgPath(me.charId);
    av.appendChild(img);

    // 名字 + 势力 + 身份
    const grp = GROUPS[me.group];
    const nameEl = $('#sgs-self-name');
    nameEl.innerHTML = '';
    // 座位号（自己固定为 1）
    const seatSelf = el('span', 'grp', '1 号位');
    seatSelf.style.background = IDENTITY_COLOR[me.identity] || '#3d8b6e';
    seatSelf.style.opacity = '0.9';
    nameEl.appendChild(seatSelf);
    nameEl.appendChild(document.createTextNode(me.name));
    const gb = el('span', 'grp', grp.label);
    gb.style.background = grp.color;
    nameEl.appendChild(gb);
    const ib = el('span', 'grp', IDENTITY_LABEL[me.identity]);
    ib.style.background = IDENTITY_COLOR[me.identity];
    nameEl.appendChild(ib);
    if (!me.alive) {
      const dead = el('span', 'grp', '已阵亡');
      dead.style.background = '#555';
      nameEl.appendChild(dead);
    }

    // 技能
    const sk = $('#sgs-self-skills');
    sk.innerHTML = '';
    me.skills.forEach((sid) => {
      const s = SKILLS[sid];
      if (!s) return;
      const chip = el('span', 'sgs-skill-chip', s.name);
      if (s.locked) chip.classList.add('locked');
      chip.title = `${s.name}：${s.desc}`;
      sk.appendChild(chip);
    });
    // 体力
    const hpChip = el('span', 'sgs-skill-chip', `体力 ${me.hp}/${me.maxHp}`);
    hpChip.style.background = 'rgba(176,58,58,0.2)';
    hpChip.style.borderColor = 'rgba(176,58,58,0.5)';
    sk.appendChild(hpChip);

    // ================= 手牌区（只放真正的手牌）=================
    // 装备区的牌不在这里显示 —— 它们有自己的格子（见 renderEquipSlots）。
    const hand = $('#sgs-self-hand');
    hand.innerHTML = '';

    // 若当前处于「从外部牌池选牌」（如五谷丰登、从他人处选牌），
    // 则渲染那个牌池，而不是自己的手牌 —— 否则玩家无从下手。
    if (this.mode === 'cards' && this.cardCandidates && this.cardPoolExternal) {
      hand.appendChild(el('div', 'sgs-pool-label', this.poolLabel || '请选择一张牌'));
      this.cardCandidates.forEach((c) => {
        hand.appendChild(this.buildCardNode(c, me, false, true));
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

    node.appendChild(face);
    node.title = `${card.text}\n${CARDS[card.name] ? CARDS[card.name].desc : ''}`;

    if (isEquip) node.classList.add('is-equip');

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

  renderProcessing() {
    const wrap = $('#sgs-processing');
    const g = this.game;

    // ---- 中央区：本回合打出的牌 ----
    // 这些牌同时属于弃牌堆；回合结束后会移入弃牌堆，中央区清空。
    const center = g.getCenterZone();
    const sig = center.map((c) => c.id).join(',');
    if (wrap.dataset.sig !== sig) {
      wrap.dataset.sig = sig;
      wrap.innerHTML = '';
      if (!center.length) {
        // 空时给出提示，方便玩家理解这个区域
        const empty = el('div', 'sgs-center-empty', '（本回合暂无打出的牌）');
        wrap.appendChild(empty);
      } else {
        center.slice(-12).forEach((c) => {
          const n = this.buildCardNode(c, g.currentPlayer, true);
          wrap.appendChild(n);
        });
        if (center.length > 12) {
          wrap.appendChild(el('div', 'sgs-center-more', `+${center.length - 12}`));
        }
      }
    }

    // ---- 判定区牌（当前回合玩家）----
    const cp = g.currentPlayer;
    const jSig = cp && cp.judges.length ? cp.judges.map((c) => c.id).join(',') : '';
    if (wrap.dataset.jsig !== jSig) {
      wrap.dataset.jsig = jSig;
      if (cp && cp.judges.length) {
        cp.judges.forEach((c) => {
          const n = this.buildCardNode(c, cp, true);
          n.title = `判定区：${c.text}`;
          wrap.appendChild(n);
        });
      }
    }
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

  setPrompt(text) {
    const p = $('#sgs-prompt');
    if (text) {
      p.textContent = text;
      p.classList.remove('hidden');
    } else {
      p.classList.add('hidden');
    }
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
      else if (fromPlayer) pool = fromPlayer.getCards(position, filter);
      else pool = player.getCards(position, filter);

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
  chooseTargets(player, { prompt, candidates, min = 1, max = 1 }) {
    return new Promise((resolve) => {
      if (!candidates.length) { resolve([]); return; }

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
   * 选项式选择（如刚烈：弃牌 or 受伤）
   */
  chooseOption(player, prompt, options) {
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
      const wrap = $('#sgs-actions');
      wrap.innerHTML = '';
      this.setPrompt(prompt);
      options.forEach((o) => {
        const b = el('button', 'sgs-act-btn primary', o.label);
        b.onclick = () => {
          wrap.innerHTML = '';
          this.mode = null;
          this.setPrompt('');
          resolve(o.key);
        };
        wrap.appendChild(b);
      });
    });
  }

  /**
   * 是否发动技能
   */
  async askSkill(player, skill, ctx) {
    if (!player.isHuman) {
      return this.game.ai.decideSkill(player, skill, ctx);
    }
    if (skill.locked || skill.forced) return true;
    const use = await this.chooseOption(player, `是否发动【${skill.name}】？`, [
      { key: 'yes', label: `发动【${skill.name}】` },
      { key: 'no', label: '不发动' },
    ]);
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
  arrangeCards(player, cards, prompt) {
    return new Promise((resolve) => {
      if (!player.isHuman) { resolve({ top: cards, bottom: [] }); return; }
      // 简化：全部放回牌堆顶，顺序不变
      // 完整实现可做拖拽排序，此处给出明确的交互说明
      this.mode = 'confirm';
      this.promptText = prompt;
      const wrap = $('#sgs-actions');
      wrap.innerHTML = '';
      this.setPrompt(`${prompt}（当前实现：保持顺序置于牌堆顶，可点击下方按钮确认）`);
      const b = el('button', 'sgs-act-btn primary', '确定');
      b.onclick = () => {
        wrap.innerHTML = '';
        this.mode = null;
        this.setPrompt('');
        resolve({ top: cards, bottom: [] });
      };
      wrap.appendChild(b);
    });
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
      let pickedCard = null;

      this.setPrompt('出牌阶段：请选择要使用的牌或技能');
      this._hideHint();

      // 结束回合按钮
      const endBtn = el('button', 'sgs-act-btn danger', '结束回合');
      endBtn.onclick = () => {
        cleanup();
        resolve({ type: 'end' });
      };

      // 技能按钮
      const skillBar = el('div', 'sgs-skill-bar');
      player.skills.forEach((sid) => {
        const s = SKILLS[sid];
        if (!s || s.type !== 'active') return;
        if (player.flags[`skill_${sid}`]) return;
        const ctx = { player, game, event: {}, skill: s };
        if (s.filter && !s.filter(ctx)) return;
        const b = el('button', 'sgs-act-btn', `【${s.name}】`);
        b.title = s.desc;
        b.onclick = () => { cleanup(); resolve({ type: 'skill', skill: sid }); };
        skillBar.appendChild(b);
      });
      wrap.appendChild(skillBar);

      // 手牌点击即使用
      const hint = el('div', 'hint-text');
      hint.style.cssText = 'font-size:12px;color:#9a8b78;width:100%;text-align:center;';
      hint.textContent = '点击下方手牌以使用；需要选择目标时按提示点击角色';
      wrap.appendChild(hint);
      wrap.appendChild(endBtn);

      const cleanup = () => {
        this.mode = null;
        this.setPrompt('');
        $('#sgs-self-hand').onclick = null;
        wrap.innerHTML = '';
      };

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
          this.setPrompt(check.reason);
          setTimeout(() => this.setPrompt('出牌阶段：请选择要使用的牌或技能'), 1600);
          return;
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
        let unlimited = game.shaUnlimited(player);
        if (!unlimited && used >= 1) return { ok: false, reason: '本回合已使用过【杀】' };
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

      // ---- 无需选目标的牌 ----
      case 'wugu':
      case 'taoyuan':
      case 'nanman':
      case 'wanjian':
        return { ok: true };

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