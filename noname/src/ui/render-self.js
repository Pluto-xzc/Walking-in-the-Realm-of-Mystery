/**
 * UI 功能组：render-self
 * 由 tools/split_ui.cjs 从旧 ui.js 切出；混入 UI 原型。
 * 本文件只包含方法定义，新增依赖请在文件顶部补 import。
 */













/* === 依赖（由 tools/fix_ui_imports.cjs 生成）=== */
import { CARDS, EQUIP_SLOTS } from '../cards.js';
import { GROUPS } from '../characters.js';
import { SKILLS } from '../skills.js';
import { IDENTITY_COLOR, IDENTITY_LABEL } from '../match.js';
import { $, el, charImgPath, bindImageFallback } from '../ui-helpers.js';

export default {

renderSelf(me) {
  /*
   * 【隐匿】状态（作用于自己）
   * ----------------------------------------------------------------
   * 需求方给定：隐匿角色**武将牌、体力值、体力上限、性别都不可见**。
   * 这一点对「自己」同样成立 —— 白金磷子当主公时，
   * 自己的头像区也应显示「?」占位，而不是直接亮出武将牌。
   */
  const selfHidden = !!me.hidden;

  // 头像
  const av = $('#sgs-self-avatar');
  av.innerHTML = '';
  av.oncontextmenu = (ev) => {
    ev.preventDefault();
    this.showPlayerDetail(me, ev);
  };
  if (selfHidden) {
    av.appendChild(el('div', 'sgs-self-hidden-avatar', '?'));
  } else {
    const img = el('img');
    img.alt = me.name;
    bindImageFallback(img, me.charId, me.name, { avatar: false });
    img.src = charImgPath(me.charId);
    av.appendChild(img);
  }

  // 名字行：座位号 + 名字 + 势力 + 身份（身份在名字后面）
  const grp = GROUPS[me.group];
  const nameEl = $('#sgs-self-name');
  nameEl.innerHTML = '';
  const seatSelf = el('span', 'grp', `${this.seatLabel(me)} 号位`);
  seatSelf.style.background = IDENTITY_COLOR[me.identity] || '#3d8b6e';
  seatSelf.style.opacity = '0.9';
  nameEl.appendChild(seatSelf);
  nameEl.appendChild(document.createTextNode(me.name));
  // 隐匿时势力也不该亮出来
  if (!selfHidden && grp) {
    const gb = el('span', 'grp', grp.label);
    gb.style.background = grp.color;
    nameEl.appendChild(gb);
  } else if (selfHidden) {
    const gb = el('span', 'grp', '隐匿');
    gb.style.background = '#4a4a4a';
    nameEl.appendChild(gb);
  }

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
  if (selfHidden) {
    // 隐匿：体力值与体力上限均不可见
    const hid = el('span', 'sgs-hp-text sgs-hp-hidden-self', '体力：？｜护甲：？');
    hid.title = '隐匿状态：体力值与体力上限不可见';
    statEl.appendChild(hid);
  } else {
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
  }

  // ---------------- 技能按钮（可点击发动）----------------
  // 位置：紧跟在身份之后。玩家自己按才发动，不再自动触发。
  const sk = $('#sgs-self-skills');
  sk.innerHTML = '';
  me.skills.forEach((sid) => {
    const s = SKILLS[sid];
    if (!s) return;
    // 派生技（sub）不单独出按钮，与无名杀 get.is.disable 的判定一致
    if (s.sub) return;
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

  /*
   * ---------------- 背水按钮 ----------------
   * 需求方要求：「背水可以加个按钮，让玩家选择是否自行背水」。
   *
   * 自己**反面向上**且本次机会还没用掉时，多出一个「背水」按钮。
   * 按下去＝把【怯懦的琴键】那对转换技 ①② 直接全选执行；
   * 不按＝按转换技规则只执行当前那一项。
   *
   * 该状态由 skills.js 的 canBeishuiNow / consumeBeishui 维护。
   */
  if (me.isHuman && this.canBeishui && this.canBeishui(me)) {
    const bs = el('button', 'sgs-skill-btn sgs-beishui-btn', '背水');
    bs.title = '你反面向上：可以背水，将【怯懦的琴键】的 ①② 全部执行'
      + '\n（平常须二选一。这是一次性的机会）';
    bs.onclick = () => {
      bs.disabled = true;
      if (this.onBeishuiClick) this.onBeishuiClick(me);
    };
    sk.appendChild(bs);
  }

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
},

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
},

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
},

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
},

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
},

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
},

/**
 * 中央区 / 判定区的**画面外**渲染
 * ------------------------------------------------------------------
 * 按需求，中央区不再显示在牌桌正中（改由顶栏「中央区」按钮查看），
 * 因此这里不再渲染中央区。判定区仍需要小徽章提示。
 */
renderProcessing() {
  // 中央区已移到面板（见 renderCenterPanel），此处不再绘制
  // 判定区信息通过对手节点的徽章展示（buildPlayerNode 里已处理）
},

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
},

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
},

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
},

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
},

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
},

/* ---------------- io 实现 ---------------- */
_showHint() {
  $('#sgs-select-hint').classList.add('active');
},
_hideHint() {
  $('#sgs-select-hint').classList.remove('active');
}
};
