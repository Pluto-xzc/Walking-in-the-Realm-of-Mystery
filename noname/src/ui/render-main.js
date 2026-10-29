/**
 * UI 功能组：render-main
 * 由 tools/split_ui.cjs 从旧 ui.js 切出；混入 UI 原型。
 * 本文件只包含方法定义，新增依赖请在文件顶部补 import。
 */













/* === 依赖（由 tools/fix_ui_imports.cjs 生成）=== */
import { CARDS } from '../cards.js';
import { IDENTITY_COLOR, IDENTITY_LABEL } from '../match.js';
import { $, $$, el } from '../ui-helpers.js';

export default {

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
},

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
},

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

  // 自己也可能成为目标（【桃】【铁索连环】等），单独接线
  this.renderSelfTargetState();

  this.layoutOpponents();
},

/**
 * 对手弧形分布
 * ------------------------------------------------------------------
 * 把「主视角以外」的角色沿一条上凸的圆弧等距摆开，
 * 只改动 .sgs-opponents 内子元素的位置，牌桌其它面板（日志、手牌）
 * 位置完全不动。关闭设置里的「对手弧形分布」会退回原来的横向一排。
 */
layoutOpponents() {
  const wrap = $('#sgs-opponents');
  if (!wrap) return;
  const nodes = [...wrap.querySelectorAll('.sgs-player')];
  const arc = !this.settings || this.settings.arcLayout !== false;

  if (!arc || !nodes.length) {
    wrap.classList.remove('arc');
    nodes.forEach((n) => {
      n.style.left = '';
      n.style.top = '';
      n.style.transform = '';
    });
    return;
  }

  wrap.classList.add('arc');
  const w = wrap.clientWidth || 800;
  const h = wrap.clientHeight || 260;
  const n = nodes.length;

  /*
   * 让出右侧日志面板的位置：日志是浮层，压在弧线上会挡住最右的对手。
   * 取日志面板实际占用的宽度作为右侧留白，并把整条弧线整体左移。
   */
  const logEl = $('#sgs-log');
  const logW = (logEl && logEl.offsetParent && !logEl.classList.contains('hidden'))
    ? logEl.offsetWidth + 16
    : 0;
  const usableW = Math.max(w - logW, 320);

  const sample = nodes[0];
  const cw = sample.offsetWidth || 120;
  const ch = sample.offsetHeight || 190;

  /*
   * 需求方给的形状：一个「半圆拱」——
   * 最左、最右的对手落在拱脚（略低于牌桌中线），中间的对手沿拱顶排开，
   * 而且**水平间距相等**（而不是等角度，等角度会把中间拉得很开）。
   *
   *   x_i = cx + (i - (n-1)/2) * gap
   *   y_i = yTop + sag * u^2        （u ∈ [-1, 1]）
   *
   * 其中 gap 取「卡片宽度 1.25 倍」与「能塞进可用宽度的最大间距」的较小值，
   * 卡片多时自动收紧，不会互相压住，也不会顶到日志面板。
   */
  const span = Math.max(1, n - 1);
  const gap = Math.min(cw * 1.6, (usableW - cw - 12) / span);
  const cx = Math.max(cw / 2 + 6, Math.min(usableW - cw / 2 - 6, usableW / 2));
  const yTop = ch / 2 + 6;
  const sag = Math.max(h * 0.14, 26);

  nodes.forEach((node, i) => {
    const u = n === 1 ? 0 : (i - span / 2) / (span / 2);
    const x = cx + (i - span / 2) * gap;
    const y = yTop + sag * u * u;
    node.style.left = `${Math.round(x)}px`;
    node.style.top = `${Math.round(y)}px`;
    node.style.transform = 'translate(-50%, -50%)';
  });
},

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
},

/** 座位号显示文本
 * ----------------------------------------------------------------
 * 使用**绝对座位号**（主公固定 1 号位），不随玩家位置变化。
 * 这样「1 号位 = 主公」始终成立，便于判断行动顺序与身份。
 */
seatLabel(player) {
  return String(player.seat + 1);
},

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
},

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
},

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
};
