/**
 * UI 功能组：io-arrange
 * 由 tools/split_ui.cjs 从旧 ui.js 切出；混入 UI 原型。
 * 本文件只包含方法定义，新增依赖请在文件顶部补 import。
 */













/* === 依赖（由 tools/fix_ui_imports.cjs 生成）=== */
import { CARDS } from '../cards.js';
import { $, el } from '../ui-helpers.js';

export default {

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
},

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
},

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
      this._resumeAction = null;
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

    /*
     * 技能结束后「恢复出牌阶段」的钩子
     * ----------------------------------------------------------------
     * 玩家点技能按钮时，本函数返回的 Promise 还挂着；技能内部会调用
     * chooseCards / chooseTargets，把 this.mode 临时改成 'cards'/'targets'。
     * 技能跑完若没人把 mode 改回 'action'，手牌就点不动、提示也空着，
     * 表现为「技能发动后卡住」。所以把恢复动作登记在这里，
     * 由 onSkillButtonClick / onBeishuiClick 的 finally 调用。
     */
    this._resumeAction = () => {
      this.mode = 'action';
      this.setPrompt('出牌阶段：请选择要使用的牌或技能');
      this.setPromptSub('点击下方手牌以使用；需要选择目标时按提示点击角色');
      this.render();
    };

    // 渲染结束回合按钮（独立一行）
    this.renderEndTurnRow(player);

    /*
     * 【重铸】按钮
     * ----------------------------------------------------------------
     * 带 recastable 标记的牌（【铁索连环】【木牛流马】）可以在出牌阶段
     * 置入弃牌堆并摸一张牌。
     *
     * 交互：点一下手牌选中它 → 下方出现两个按钮
     *   「使用【X】」 —— 走正常的使用流程（选目标、结算）
     *   「重铸【X】」 —— 置入弃牌堆并摸一张牌
     * ⚠️ 之前这里只给「重铸」，选中后直接 return，导致【铁索连环】
     *    能重铸却再也用不出去（用户报的 bug）。
     */
    const renderRecastRow = (card, canUse, onUse) => {
      const row = $('#sgs-recast-row');
      if (!row) return;
      const def = card && CARDS[card.name];
      row.innerHTML = '';
      if (!def || !def.recastable) return;

      if (canUse && typeof onUse === 'function') {
        const useBtn = el('button', 'sgs-act-btn primary', `使用【${def.fullname}】`);
        useBtn.title = '按正常流程使用这张牌';
        useBtn.onclick = async () => {
          row.innerHTML = '';
          this.selectedPlayCard = null;
          await onUse();
        };
        row.appendChild(useBtn);
      }

      const btn = el('button', 'sgs-act-btn', `重铸【${def.fullname}】`);
      btn.title = '将此牌置入弃牌堆，然后摸一张牌';
      btn.onclick = async () => {
        row.innerHTML = '';
        this.selectedPlayCard = null;
        this.render();
        this.setPrompt(`重铸【${def.fullname}】…`);
        await player.recast([card]);
        this.setPrompt('出牌阶段：请选择要使用的牌或技能');
        this.render();
      };
      row.appendChild(btn);
    };
    this._renderRecastRow = renderRecastRow;

    // 绑定手牌点击（只响应手牌区，不响应装备区）
    $('#sgs-self-hand').onclick = async (e) => {
      /*
       * ⚠️ 只在出牌阶段生效。
       * 技能询问期间 this.mode 会被改成 'cards'/'targets'，
       * 此时容器上的本处理器仍然挂着（因为它属于 chooseAction），
       * 若不拦下来，点手牌既会「选中给技能」又会被当成「使用这张牌」，
       * 技能的 chooseCards 永远等不到结果 —— 技能就这样卡住了。
       */
      if (this.mode !== 'action') return;

      const cardNode = e.target.closest('.sgs-card');
      if (!cardNode) return;
      // 装备区在另一个容器里，不会被这里命中；
      // 此处只从手牌中查找，装备牌无法被"使用"。
      const cid = +cardNode.dataset.cid;
      const card = hand.find((c) => c.id === cid);
      if (!card) return;
      const g = game || this.game;

      // 双重保险：已装备的牌不允许使用
      if (Object.values(player.equips).some((c) => c === card)) {
        this.setPrompt('该牌已在装备区，无法再次使用');
        setTimeout(() => this.setPrompt('出牌阶段：请选择要使用的牌或技能'), 1600);
        return;
      }

      /**
       * 正常使用流程：可用性检查 → 选目标 → 交出结果。
       * 抽成函数，好让「使用【X】」按钮复用。
       */
      const proceed = async () => {
        // 检查是否可用
        const check = this.checkCardUsable(player, card, g);
        if (!check.ok) {
          this.setPrompt(check.reason);
          setTimeout(() => this.setPrompt('出牌阶段：请选择要使用的牌或技能'), 1600);
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
            (t) => t === player || g.canTargetByLimits(player, t, card),
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
            const victims = g.players.filter(
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

      // 可重铸的牌：单击选中，给出「使用 / 重铸」两个按钮
      const cdef = CARDS[card.name];
      if (cdef && cdef.recastable) {
        const usable = this.checkCardUsable(player, card, g);
        this.selectedPlayCard = card;
        renderRecastRow(card, !!usable.ok, proceed);
        this.setPrompt(usable.ok
          ? `已选中【${cdef.fullname}】：点【使用】正常使用，或点【重铸】置换一张牌`
          : `【${cdef.fullname}】${usable.reason}；可以点【重铸】置换一张牌`);
        return;
      }

      await proceed();
    };
  });
},

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
};
