/**
 * UI 功能组：detail
 * 由 tools/split_ui.cjs 从旧 ui.js 切出；混入 UI 原型。
 * 本文件只包含方法定义，新增依赖请在文件顶部补 import。
 */













/* === 依赖（由 tools/fix_ui_imports.cjs 生成）=== */
import { CARDS, EQUIP_SLOT_MAP, SUITS } from '../cards.js';
import { GROUPS } from '../characters.js';
import { SKILLS } from '../skills.js';
import { IDENTITY_LABEL } from '../match.js';
import { $, el } from '../ui-helpers.js';

export default {

/* ============================================================
 * 右键详情
 * ============================================================ */

/** 关闭已有的详情浮层 */
closeDetail() {
  const old = document.getElementById('sgs-detail-pop');
  if (old) old.remove();
},

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
},

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
},

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
},

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
};
