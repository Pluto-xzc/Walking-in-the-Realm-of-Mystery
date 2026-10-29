/**
 * UI 功能组：io-cards
 * 由 tools/split_ui.cjs 从旧 ui.js 切出；混入 UI 原型。
 * 本文件只包含方法定义，新增依赖请在文件顶部补 import。
 */













/* === 依赖（由 tools/fix_ui_imports.cjs 生成）=== */
import { $, el } from '../ui-helpers.js';

export default {

/**
 * 选牌
 */
chooseCards(player, { prompt, position = 'he', min = 1, max = 1, filter, cancelable = true, fromPlayer, cardList }) {
  return new Promise((resolve) => {
    // AI 不走这里
    if (!player.isHuman) {
      const pick = this._aiPick(player, { position, min, max, filter, fromPlayer, cardList });
      setTimeout(() => resolve(pick), this.aiDelayMs());
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
},

_aiPick(player, { position, min, max, filter, fromPlayer, cardList }) {
  const g = this.game;
  let pool;
  if (cardList) pool = cardList.slice();
  else if (fromPlayer) pool = fromPlayer.getCards(position, filter);
  else pool = player.getCards(position, filter);
  if (!pool.length) return [];
  const sorted = pool.slice().sort((a, b) => g.ai.cardValue(a) - g.ai.cardValue(b));
  return sorted.slice(0, Math.max(min, 1));
},

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
      const pick = sorted.slice(0, min);
      setTimeout(() => resolve(pick), this.aiDelayMs());
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
},

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
},

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
      const pick = options.some((o) => o.key === 'discard')
        ? (player.countCards('h') >= 2 ? 'discard' : 'damage')
        : options[0].key;
      setTimeout(() => resolve(pick), this.aiDelayMs());
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
};
