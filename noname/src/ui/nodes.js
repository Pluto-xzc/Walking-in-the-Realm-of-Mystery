/**
 * UI 功能组：nodes
 * 由 tools/split_ui.cjs 从旧 ui.js 切出；混入 UI 原型。
 * 本文件只包含方法定义，新增依赖请在文件顶部补 import。
 */













/* === 依赖（由 tools/fix_ui_imports.cjs 生成）=== */
import { CARDS } from '../cards.js';
import { GROUPS } from '../characters.js';
import { IDENTITY_COLOR, IDENTITY_LABEL } from '../match.js';
import { $, $$, el, charImgPath, bindImageFallback } from '../ui-helpers.js';

export default {

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
},

toggleTarget(p) {
  const idx = this.selectedTargets.indexOf(p);
  if (idx >= 0) {
    this.selectedTargets.splice(idx, 1);
  } else {
    if (this.selectedTargets.length >= this.targetMax) return;
    this.selectedTargets.push(p);
  }
  this.renderSelectionState();
},

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
},

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
},

updateHintText() {
  const hint = $('#sgs-hint-text');
  if (this.mode === 'cards') {
    hint.textContent = `${this.promptText}（已选 ${this.selectedCards.size}/${this.cardMin}${this.cardMax > this.cardMin ? `~${this.cardMax}` : ''}）`;
  } else if (this.mode === 'targets') {
    hint.textContent = `${this.promptText}（已选 ${this.selectedTargets.length}/${this.targetMin}${this.targetMax > this.targetMin ? `~${this.targetMax}` : ''}）`;
  } else {
    hint.textContent = this.promptText;
  }
},

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
};
