/**
 * UI 功能组：splash
 * 由 tools/split_ui.cjs 从旧 ui.js 切出；混入 UI 原型。
 * 本文件只包含方法定义，新增依赖请在文件顶部补 import。
 */













/* === 依赖（由 tools/fix_ui_imports.cjs 生成）=== */
import { CHARACTERS, GROUPS, packOf, pickerTabs } from '../characters.js';
import { SKILLS } from '../skills.js';
import { IDENTITY_COLOR, IDENTITY_LABEL, CHOICE_NUM } from '../match.js';
import { $, $$, el, charImgPaths, resolveHomeHref } from '../ui-helpers.js';

export default {

/** 确保开屏容器存在（由 showSplash 填充内容） */
ensureSplash() {
  if (document.getElementById('sgs-splash')) return;
  const splash = document.createElement('div');
  splash.id = 'sgs-splash';
  document.body.appendChild(splash);
},

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
},

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

    // 武将图：按候选链逐个尝试，最后回退内置 SVG
    Object.keys(CHARACTERS).forEach((id) => {
      const chain = charImgPaths(id);
      tasks.push({ type: 'char', id, url: chain[0], chain });
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
      let ci = 0;
      const settle = (ok) => {
        if (ok) done.ok++; else done.fail++;
        updateProgress();
        if (done.ok + done.fail >= tasks.length) finish();
        worker();
      };
      img.onload = () => settle(true);
      img.onerror = () => {
        // 沿候选链继续尝试，全部失败才算缺失
        ci += 1;
        if (t.chain && ci < t.chain.length) {
          img.src = t.chain[ci];
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
},

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
},

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
},

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
          if (!s || s.sub) return;
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
};
