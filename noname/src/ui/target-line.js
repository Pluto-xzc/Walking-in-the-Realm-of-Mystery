/**
 * UI 功能组：target-line
 * ------------------------------------------------------------------
 * 黄色「指向线」：使用牌 / 技能指定目标时，从发起方画一条曲线到目标，
 * 线条用 SVG 虚线偏移做**递进**动画（前端先出现、再一路推向目标）。
 *
 * 覆盖层是一个 position:fixed 的 <svg>，不参与布局、不吃鼠标事件，
 * 所以不会影响任何既有面板的位置。
 */

const NS = 'http://www.w3.org/2000/svg';

export default {

  /** 取（或建）覆盖层 */
  ensureLineLayer() {
    let svg = document.getElementById('sgs-line-layer');
    if (!svg) {
      svg = document.createElementNS(NS, 'svg');
      svg.id = 'sgs-line-layer';
      svg.setAttribute('aria-hidden', 'true');
      document.body.appendChild(svg);
    }
    return svg;
  },

  /** 元素中心点（视口坐标；牌桌的 zoom 已包含在 getBoundingClientRect 里） */
  centerOf(node) {
    if (!node || !node.getBoundingClientRect) return null;
    const r = node.getBoundingClientRect();
    if (!r.width && !r.height) return null;
    return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
  },

  /**
   * 画一条指向线
   * @param {Element} fromEl 起点元素
   * @param {Element} toEl   终点元素
   * @param {object}  opts   { color, life, delay }
   */
  showTargetLine(fromEl, toEl, opts = {}) {
    if (this.settings && this.settings.animate === false) return;
    const a = this.centerOf(fromEl);
    const b = this.centerOf(toEl);
    if (!a || !b) return;

    const svg = this.ensureLineLayer();
    const color = opts.color || '#ffd447';
    const life = opts.life || 1100;

    // 轻微上凸的二次贝塞尔，避免直线穿过武将牌
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const mx = a.x + dx / 2 - dy * 0.12;
    const my = a.y + dy / 2 - Math.abs(dx) * 0.10 - 24;
    const d = `M ${a.x} ${a.y} Q ${mx} ${my} ${b.x} ${b.y}`;

    const path = document.createElementNS(NS, 'path');
    path.setAttribute('d', d);
    path.setAttribute('fill', 'none');
    path.setAttribute('stroke', color);
    path.setAttribute('stroke-width', '3');
    path.setAttribute('stroke-linecap', 'round');
    path.setAttribute('class', 'sgs-tline');
    svg.appendChild(path);

    const len = typeof path.getTotalLength === 'function' ? path.getTotalLength() : 400;
    path.style.strokeDasharray = String(len);
    path.style.strokeDashoffset = String(len);
    path.style.opacity = '0.95';

    const start = () => {
      path.style.transition = 'stroke-dashoffset 260ms linear, opacity 260ms ease';
      /* eslint-disable no-unused-expressions */
      path.getBoundingClientRect();          // 强制回流，保证过渡生效
      path.style.strokeDashoffset = '0';
    };
    if (opts.delay) setTimeout(start, opts.delay);
    else start();

    // 目标端的光点
    const dot = document.createElementNS(NS, 'circle');
    dot.setAttribute('cx', String(b.x));
    dot.setAttribute('cy', String(b.y));
    dot.setAttribute('r', '5');
    dot.setAttribute('fill', color);
    dot.setAttribute('class', 'sgs-tdot');
    svg.appendChild(dot);

    setTimeout(() => {
      path.style.opacity = '0';
      dot.style.opacity = '0';
      setTimeout(() => {
        path.remove();
        dot.remove();
      }, 300);
    }, life);
  },

  /** 引擎钩子：一张牌被使用时，从使用者连到每个目标 */
  showCardTargets(player, targets) {
    if (!player || !targets || !targets.length) return;
    if (this.settings && this.settings.animate === false) return;
    const fromEl = this.nodeOfPlayer(player);
    if (!fromEl) return;
    targets.forEach((t, i) => {
      const toEl = this.nodeOfPlayer(t);
      if (toEl) this.showTargetLine(fromEl, toEl, { delay: i * 90 });
    });
  },

  /** 选目标过程中每次点中一名角色，就从「当前选定的牌 / 自己」连一条线 */
  showSelectLine(target) {
    const fromEl = document.querySelector('#sgs-self-hand .sgs-card.selected')
      || document.getElementById('sgs-self-avatar')
      || document.getElementById('sgs-self');
    const toEl = this.nodeOfPlayer(target);
    if (fromEl && toEl && fromEl !== toEl) this.showTargetLine(fromEl, toEl);
  },

  /** 玩家 → DOM 节点 */
  nodeOfPlayer(p) {
    if (!p) return null;
    if (p.isHuman) return document.getElementById('sgs-self-avatar') || document.getElementById('sgs-self');
    return document.querySelector(`.sgs-player[data-pid="${p.id}"] .sgs-avatar-wrap`);
  },

  /** 清掉所有残留线（重开一局时用） */
  clearLines() {
    const svg = document.getElementById('sgs-line-layer');
    if (svg) svg.innerHTML = '';
  },
};
