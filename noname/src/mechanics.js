/**
 * 扩展机制（本扩新增 + 官方机制扩展）
 * ==================================================================
 * 本文件集中实现五个机制，供未来武将技能调用：
 *
 *   A. 昂扬技   —— 同限定技，但满足「激昂」条件后可重置（可反复）
 *   B. 背水     —— 官方机制：把「二选一」升级为「同时选两项」
 *   C. 卜算X    —— 官方机制扩展：看牌堆顶 X 张，任意张置底、余置顶，可调序
 *   D. 乘势     —— 官方机制：分支选项全部满足后，追加触发额外效果
 *   E. 除外     —— 本扩新增：牌移出游戏，进入角色独立的除外区
 *
 * 设计原则：
 *   ① 一切以无名杀为准（官方机制），语义均取自无名杀源码行为，
 *      但**不复制其代码**（无名杀为 GPL-3.0），这里是按语义重写。
 *   ② 自创机制（昂扬技、除外）在注释里明确标注「本项目扩展」。
 *   ③ 所有机制都以**可选开关/技能字段**形式提供，
 *      未声明的技能行为完全不变，避免影响既有对局。
 */

/* ============================================================
 * A. 昂扬技（本项目扩展，参考限定技 limited）
 * ============================================================
 * 与限定技（limited）的区别：
 *   - 限定技：整局只能发动一次，发动后永久封印；
 *   - 昂扬技：同样「发动后进入已用状态」，但当技能自定义的
 *     「激昂」条件满足时，会**重置**回可发动状态。
 *
 * 依据需求方说明：
 *   · 重置条件由**技能自己声明**（angyang.filter）
 *   · 可以**反复重置多次**（不是只重置一次）
 *
 * 技能写法：
 *   {
 *     type: 'active', limited: true,   // 同限定技
 *     angyang: {
 *       // 「激昂」条件：返回 true 则重置本技能
 *       filter: (ctx) => ctx.event && ctx.event.type === 'damage',
 *       // 可选：重置时的提示文案
 *       text: '激昂：技能已重置',
 *     },
 *   }
 * ============================================================ */

/** 该技能是否为昂扬技 */
export function isAngyangSkill(skill) {
  return !!(skill && skill.angyang && typeof skill.angyang === 'object');
}

/**
 * 昂扬技是否处于「已发动、待重置」状态
 * 与限定技共用同一套 storage 字段，便于统一判断。
 */
export function isAngyangUsed(player, skillId) {
  return !!(player.storage && player.storage[`angyang_used_${skillId}`]);
}

/** 发动后标记为已用（限定技/昂扬技通用语义） */
export function markAngyangUsed(player, skillId) {
  if (!player.storage) player.storage = {};
  player.storage[`angyang_used_${skillId}`] = true;
}

/**
 * 尝试重置昂扬技
 * ------------------------------------------------------------------
 * 遍历角色身上所有昂扬技，逐一对「激昂」条件求值；
 * 条件成立且当前处于已用状态 → 重置（清掉已用标记）。
 *
 * @param {Game} game
 * @param {Player} player  需要检查的角色
 * @param {object} event   当前事件（会作为 ctx.event 传给 filter）
 * @returns {string[]}     被重置的技能 id 列表
 */
export function tryResetAngyang(game, player, event) {
  const reset = [];
  if (!player || !player.skills) return reset;
  for (const sid of player.skills) {
    const sk = game.skillsRef && game.skillsRef[sid];
    if (!sk) continue;
    if (!isAngyangSkill(sk)) continue;
    if (!isAngyangUsed(player, sid)) continue;      // 没发动过就不用重置
    let ok = false;
    try {
      ok = sk.angyang.filter
        ? !!sk.angyang.filter({ player, game, event, skill: sk })
        : false;
    } catch { ok = false; }
    if (!ok) continue;
    // 重置：可反复触发，因此只是清掉「已用」标记
    delete player.storage[`angyang_used_${sid}`];
    reset.push(sid);
    game.log(`${player.name} 的【${sk.name}】满足激昂条件，已重置`
      + (sk.angyang.text ? `（${sk.angyang.text}）` : ''));
  }
  return reset;
}

/* ============================================================
 * B. 背水（官方机制）
 * ============================================================
 * 无名杀依据（只读语义，未抄代码）：
 *   技能给出若干「选项」，玩家在 chooseControl 里可以额外选
 *   一个「背水！」控件。结算时的写法是：
 *
 *     if (choice != '选项二') { 执行选项一 }
 *     if (choice != '选项一') { 执行选项二 }
 *
 *   于是：
 *     choice = 选项一 → 只执行选项一
 *     choice = 选项二 → 只执行选项二
 *     choice = 背水！ → 两项都执行（因为两个判断都成立）
 *
 *   并且「背水！」通常附带代价（如弃一张红色牌、弃双方武器牌），
 *   且只有在能支付代价时该选项才出现（filter 判断）。
 *
 * 另一种用法（需求方提到）：
 *   「无视转换技、韵律技等条件限制，直接适用不同的两项」——
 *   即绕开「本次只能用其中一项」的限制，一次性拿到两项。
 * ============================================================ */

/** 背水选项的固定 key（与官方控件文案一致） */
export const BEISHUI = 'beishui';

/**
 * 构造「二选一 + 背水」的选项列表
 *
 * @param {object} opts
 * @param {string} opts.opt1       选项一的文案
 * @param {string} opts.opt2       选项二的文案
 * @param {boolean} opts.canBeishui 是否允许背水（代价是否付得起）
 * @param {string} [opts.beishuiText] 背水选项的文案
 * @param {boolean} [opts.allowCancel] 是否允许取消
 * @returns {{key:string,label:string}[]}
 */
export function buildBeishuiOptions(opts) {
  const list = [
    { key: 'opt1', label: opts.opt1 },
    { key: 'opt2', label: opts.opt2 },
  ];
  if (opts.canBeishui) {
    list.push({
      key: BEISHUI,
      label: opts.beishuiText || '背水！同时执行以上两项',
    });
  }
  if (opts.allowCancel !== false) {
    list.push({ key: 'cancel', label: '取消' });
  }
  return list;
}

/**
 * 由玩家选择的结果推导「实际要执行哪些分支」
 * 这是背水机制的核心：把选择映射成布尔分支开关。
 *
 * @param {string} choice  'opt1' | 'opt2' | BEISHUI | 'cancel'
 * @returns {{do1:boolean, do2:boolean, cancel:boolean}}
 */
export function resolveBeishuiChoice(choice) {
  if (choice === 'cancel') return { do1: false, do2: false, cancel: true };
  if (choice === BEISHUI) return { do1: true, do2: true, cancel: false };
  return { do1: choice === 'opt1', do2: choice === 'opt2', cancel: false };
}

/* ============================================================
 * C. 卜算X（官方机制扩展）
 * ============================================================
 * 无名杀依据：
 *   player.chooseToGuanxing(num) → 取出牌堆顶 num 张，
 *   进入 chooseToMove 界面：list = [['牌堆顶', cards], ['牌堆底', []]]
 *   玩家可把任意张牌在「牌堆顶 / 牌堆底」之间移动，
 *   且**两栏内部的顺序都可任意调整**。
 *   放回时：牌堆顶那一栏按顺序回到顶上，牌堆底那一栏放到最底下。
 *
 * 与【观星】是同一套底层能力，区别只在 X 由技能给定。
 * 本项目已有的 UI.arrangeCards 就是这个界面，这里提供技能侧入口。
 * ============================================================ */

/**
 * 卜算 X
 * @param {object} ctx  { player, game }
 * @param {number} x    观看张数
 * @param {object} [opts]
 * @param {string} [opts.prompt] 提示文案，默认「卜算」
 * @returns {Promise<{top:Card[], bottom:Card[]}>}
 */
export async function busuan(ctx, x, opts = {}) {
  const { player, game } = ctx;
  const n = Math.max(0, Math.floor(x || 0));
  if (!n) return { top: [], bottom: [] };

  // ① 取牌堆顶 X 张
  const cards = game.takeFromDeckTop(n);
  if (!cards.length) return { top: [], bottom: [] };

  // ② 交给界面调整顺序（顶/底两栏，栏内顺序也可调）
  const label = opts.prompt || '卜算';
  const arranged = await player.arrangeCards(
    cards,
    `${label}：点击牌可在「牌堆顶 / 牌堆底」之间移动（栏内可拖动调整顺序）`,
  );
  const top = (arranged && arranged.top) || [];
  const bottom = (arranged && arranged.bottom) || [];

  // ③ 放回：先放底，再放顶（顺序都不能乱）
  if (bottom.length) game.putOnDeckBottom(bottom);
  if (top.length) game.putOnDeckTop(top);

  game.log(`${player.name} 发动【${label}】，观看牌堆顶 ${cards.length} 张`
    + `（置顶 ${top.length} 张，置底 ${bottom.length} 张）`);
  return { top, bottom };
}

/* ============================================================
 * D. 乘势（官方机制）
 * ============================================================
 * 无名杀依据（mobile/skill.js 的写法）：
 *   技能描述里有多个分支选项，例如
 *     「你可弃置任意数量牌，若有：基本牌…；锦囊牌…。乘势：你恢复2点体力」
 *   结算时逐条判断分支是否满足：
 *     bool1 = 有基本牌； bool2 = 有锦囊牌；
 *   满足哪个就执行哪个分支的效果；
 *   当**全部分支都满足**（bool1 && bool2）时，追加触发「乘势」效果。
 *
 * 因此本机制的通用实现是：
 *   技能声明一个 checks 列表（每个分支一个判定函数）
 *   + 一个 chengshi 回调（全满足时执行）
 * ============================================================ */

/**
 * 结算「乘势」
 * ------------------------------------------------------------------
 * @param {object} ctx   { player, game, event, skill }
 * @param {object} spec
 * @param {Array<{name:string, check:function, run?:function}>} spec.branches
 *        每个分支：check 判定是否满足；run 满足时执行的分支效果
 * @param {function} [spec.chengshi]
 *        所有分支都满足时执行的「乘势」效果
 * @param {string} [spec.text] 乘势提示文案
 * @returns {Promise<{satisfied:string[], chengshi:boolean}>}
 */
export async function resolveChengshi(ctx, spec) {
  const { player, game } = ctx;
  const branches = (spec && spec.branches) || [];
  const satisfied = [];

  // ① 逐分支判定并执行
  for (const b of branches) {
    let ok = false;
    try { ok = b.check ? !!b.check(ctx) : false; } catch { ok = false; }
    if (!ok) continue;
    satisfied.push(b.name || '');
    if (typeof b.run === 'function') await b.run(ctx);
  }

  // ② 全部分支都满足 → 触发乘势
  const all = branches.length > 0 && satisfied.length === branches.length;
  if (all && typeof spec.chengshi === 'function') {
    game.log(`${player.name} 达成全部条件，触发【乘势】`
      + (spec.text ? `（${spec.text}）` : ''));
    await spec.chengshi(ctx);
  }
  return { satisfied, chengshi: all };
}

/* ============================================================
 * E. 除外（本项目扩展）
 * ============================================================
 * 按需求方给定的规则：
 *   ① 被除外的牌**移出游戏**，独立存在于「除外区」；
 *   ② **仅主人可见**这些牌的具体内容，其余角色只了解数量；
 *   ③ 除外区**无数量限制**；
 *   ④ 主人**死亡**时，这些牌进入弃牌堆；
 *   ⑤ 每名角色的除外区**相互独立**，互不影响。
 *
 * 另外确认：技能**可以取回**除外区里的牌（不是只能等死亡）。
 *
 * 实现落在 Player.excluded 数组 + Card.zone = 'excluded'。
 * 由于牌不在牌堆/弃牌堆/手牌/装备/判定，因此天然「移出游戏」。
 * ============================================================ */

/**
 * 将牌除外
 * @param {Player} player 执行除外的角色（即除外区的主人）
 * @param {Card[]} cards
 * @param {string} [reason] 日志用
 */
export function excludeCards(player, cards, reason) {
  const list = (Array.isArray(cards) ? cards : [cards]).filter(Boolean);
  if (!list.length) return [];
  const g = player.game;
  const moved = [];
  for (const c of list) {
    // 从原区域摘掉（手牌 / 装备 / 判定）
    const hi = player.hand.indexOf(c);
    if (hi >= 0) player.hand.splice(hi, 1);
    for (const slot of Object.keys(player.equips || {})) {
      if (player.equips[slot] === c) player.equips[slot] = null;
    }
    const ji = (player.judges || []).indexOf(c);
    if (ji >= 0) player.judges.splice(ji, 1);
    // 若在别处（他人手牌等），也一并摘除
    if (g) {
      for (const p of g.players) {
        const k = p.hand.indexOf(c);
        if (k >= 0) p.hand.splice(k, 1);
      }
    }
    c.zone = 'excluded';
    c.excludedOwner = player.id;
    /*
     * 被除外 → 失去明置与横置状态
     *（需求方确认「被除外」也属于失去明置的情形之一）
     */
    invalidateRevealed([c]);
    delete c.horizontal;
    player.excluded.push(c);
    moved.push(c);
  }
  if (g) {
    g.log(`${player.name} 将 ${moved.length} 张牌除外`
      + (reason ? `（${reason}）` : ''));
    g.emit();
  }
  return moved;
}

/**
 * 取回除外区的牌
 * @param {Player} player 除外区主人
 * @param {Card[]} cards
 * @returns {Card[]} 实际取回的牌
 */
export function retrieveExcluded(player, cards) {
  const list = (Array.isArray(cards) ? cards : [cards]).filter(Boolean);
  const got = [];
  for (const c of list) {
    const i = player.excluded.indexOf(c);
    if (i < 0) continue;
    player.excluded.splice(i, 1);
    c.zone = 'hand';
    delete c.excludedOwner;
    got.push(c);
  }
  return got;
}

/**
 * 主人死亡：除外区的牌进入弃牌堆
 * 参考需求：「当除外这些牌的角色死亡时，这些牌进入弃牌堆」
 */
export function flushExcludedOnDeath(player) {
  if (!player.excluded || !player.excluded.length) return [];
  const g = player.game;
  const all = player.excluded.slice();
  player.excluded.length = 0;
  for (const c of all) {
    c.zone = 'discard';
    delete c.excludedOwner;
  }
  if (g) {
    // ⚠️ 必须传**数组**，不能写成 toDiscard(...all)：
    //    toDiscard(cards) 只接收一个参数，用展开会把其余牌全丢掉。
    g.toDiscard(all);
    g.log(`${player.name} 阵亡，其除外区的 ${all.length} 张牌进入弃牌堆`);
  }
  return all;
}

/**
 * 某角色能看到多少张除外牌
 * 可见性规则：主人看全部（含具体内容），其他人只看数量。
 *
 * @param {Player} viewer 观察者
 * @param {Player} owner  除外区主人
 * @returns {{count:number, cards:Card[]|null, known:boolean}}
 */
export function viewExcluded(viewer, owner) {
  const count = (owner.excluded || []).length;
  const known = viewer === owner;
  return { count, cards: known ? owner.excluded.slice() : null, known };
}

/* ============================================================
 * F. 点燃（本项目扩展）
 * ============================================================
 * 需求方给定规则：
 *   · 被点燃的牌**使用**时没有距离和次数限制；
 *   · **每有两张**被点燃的牌**被弃置**时，那些牌的**原持有者**
 *     须受到 1 点**火焰**伤害。
 *
 * 裁定（已与需求方确认）：
 *   「原持有者」= **点燃时牌在谁手上**的那个人
 *   （而不是造成弃置的人）。
 *
 * 实现方式：
 *   给牌打标记 card.ignited = true，并记录 card.ignitedOwner。
 *   弃置时由引擎调用 noteIgnitedDiscard() 计数，每满 2 张结算一次。
 */

/** 点燃一张或多张牌 */
export function igniteCards(cards, owner) {
  const list = normalizeList(cards);
  const out = [];
  for (const c of list) {
    if (!c) continue;
    c.ignited = true;
    // 记录「原持有者」：点燃时牌在谁手上
    c.ignitedOwner = owner || c.ignitedOwner || null;
    out.push(c);
  }
  if (out.length && owner && owner.game) {
    owner.game.log(`${owner.name} 点燃了 ${out.length} 张牌`
      + `（${out.map((c) => c.fullname || c.name).join('、')}）`);
    owner.game.emit();
  }
  return out;
}

/** 取消点燃 */
export function extinguisCards(cards) {
  const list = normalizeList(cards);
  for (const c of list) {
    if (!c) continue;
    delete c.ignited;
    delete c.ignitedOwner;
  }
  return list;
}

/** 这张牌是否被点燃 */
export function isIgnited(card) {
  return !!(card && card.ignited);
}

/**
 * 记录「有被点燃的牌被弃置」，每满 2 张结算一次火焰伤害
 * ------------------------------------------------------------------
 * 由引擎的弃牌入口统一调用（toDiscard）。
 *
 * @param {Game} game
 * @param {Card[]} cards 本次被弃置的牌
 * @returns {Promise<number>} 本次结算造成的伤害次数
 */
export async function noteIgnitedDiscard(game, cards) {
  if (!game) return 0;
  const list = normalizeList(cards).filter((c) => c && c.ignited);
  if (!list.length) return 0;

  // 全局计数器：跨角色累计（规则说的是「每有两张」，未限定持有者）
  game._ignitedDiscardCount = (game._ignitedDiscardCount || 0);
  let hits = 0;

  for (const c of list) {
    game._ignitedDiscardCount += 1;
    game.log(`【点燃】${c.fullname || c.name} 被弃置`
      + `（点燃计数 ${game._ignitedDiscardCount}/2）`);

    if (game._ignitedDiscardCount >= 2) {
      game._ignitedDiscardCount -= 2;
      // 由「原持有者」受到 1 点火焰伤害
      const victim = c.ignitedOwner;
      if (victim && victim.alive) {
        game.log(`【点燃】两张被点燃的牌已被弃置，`
          + `${victim.name} 受到 1 点火焰伤害`);
        await game.doDamage(victim, 1, null, 'ignite', null, 'fire');
        hits++;
      }
    }
    // 结算完毕，标记清除
    delete c.ignited;
    delete c.ignitedOwner;
  }
  return hits;
}

/** 点燃相关的 mod：被点燃的牌使用无距离、无次数限制 */
export function ignitedCardMods(card, player, game) {
  if (!isIgnited(card)) return null;
  return {
    noDistance: true,
    noLimit: true,
  };
}

/* ============================================================
 * G. 调离（本项目新增；无名杀中并无此机制）
 * ============================================================
 * ⚠️ 已核实：无名杀全部源码中「调离」**只出现在武将背景文本**里，
 *    没有任何机制实现。因此本机制的语义**完全按需求方给定**实现。
 *
 * 需求方给定规则：
 *   · 被调离的角色**不参与距离结算**；
 *   · **不能成为牌的目标**；
 *   · **不能使用牌**；
 *   · 直到被「调回」；**未注明调回时间则默认为当前回合结束后调回**。
 */

/** 调离一名角色（不写 turn 则默认当前回合结束时调回） */
export function removeFromField(player, opts = {}) {
  if (!player) return false;
  const g = player.game;
  player.detached = true;
  // 默认调回时间：当前回合结束后
  if (opts.turn == null) {
    player.detachUntilTurn = g ? g.turnCount : 0;
    player.detachAutoReturn = true;
  } else {
    player.detachUntilTurn = opts.turn;
    player.detachAutoReturn = !!opts.auto;
  }
  if (g) {
    g.log(`${player.name} 被调离（不参与距离结算、不能成为目标、不能使用牌）`);
    g.emit();
  }
  return true;
}

/** 调回一名角色 */
export function returnToField(player) {
  if (!player) return false;
  player.detached = false;
  player.detachAutoReturn = false;
  delete player.detachUntilTurn;
  if (player.game) {
    player.game.log(`${player.name} 被调回`);
    player.game.emit();
  }
  return true;
}

/** 该角色是否处于调离状态 */
export function isDetached(player) {
  return !!(player && player.detached);
}

/**
 * 回合结束时处理「自动调回」
 * 由引擎在回合结束时调用。
 */
export function checkDetachAutoReturn(game) {
  if (!game) return [];
  const back = [];
  for (const p of game.players) {
    if (!p.detached) continue;
    if (!p.detachAutoReturn) continue;
    if (p.detachUntilTurn !== game.turnCount) continue;
    returnToField(p);
    back.push(p);
  }
  return back;
}

/* ============================================================
 * H. 额定回合 / 额定阶段（官方机制的延伸）
 * ============================================================
 * 无名杀依据（`library/element/player.js` 的 rest 注释）：
 *   「type 是休整的计数方式，'round' 是在你的**额定回合开始前**才计数」
 *   即：额定回合 = 在没有技能/牌影响的前提下，每轮中该角色
 *   原本应执行的那个回合（因技能产生的**额外回合不算**）。
 *
 * 本项目实现：
 *   引擎在每个回合开始时记录该回合是否为「额定回合」。
 *   判定依据：这一回合**不是**由技能/牌插队产生的额外回合。
 */

/** 本回合是否为该角色的额定回合 */
export function isRatedTurn(game, player) {
  if (!game || !player) return false;
  if (game.currentPlayer !== player) return false;
  // extraTurn 表示由技能产生的额外回合，不算额定回合
  if (player.extraTurn) return false;
  return game._turnIsRated !== false;
}

/** 本阶段是否为该角色的额定阶段 */
export function isRatedPhase(game, player, phase) {
  if (!isRatedTurn(game, player)) return false;
  if (phase == null) return true;
  return game._ratedPhase === phase || game._currentPhase === phase;
}

/** 该角色本轮的额定回合是否已经开始过 */
export function hasRatedTurnStarted(game, player) {
  if (!game || !player) return false;
  return player.storage && player.storage.ratedTurnRound === game.roundCount;
}

/** 标记本轮额定回合已开始（由引擎调用） */
export function markRatedTurnStarted(game, player) {
  if (!game || !player) return;
  player.storage = player.storage || {};
  player.storage.ratedTurnRound = game.roundCount;
}

/* ============================================================
 * I. 附魔（本项目新增）
 * ============================================================
 * 需求方给定：把对应效果或技能的效果**附加在对应的牌上**。
 *   例：令一张【杀】附魔吕布的技能【无双】，
 *       此时该【杀】需要两张【闪】响应。
 *
 * 实现方式：
 *   card.enchants = [skillId, ...]
 *   引擎在需要时读取这些附魔技能的效果
 *   （如 shanRequired 会累加）。
 */

/** 给牌附魔若干技能 */
export function enchantCard(card, skillIds) {
  if (!card) return [];
  const list = Array.isArray(skillIds) ? skillIds : [skillIds];
  card.enchants = card.enchants || [];
  for (const s of list) {
    if (s && !card.enchants.includes(s)) card.enchants.push(s);
  }
  if (card.enchants.length) {
    card.enchanted = true;
  }
  return card.enchants;
}

/** 解除附魔 */
export function disenchantCard(card, skillIds) {
  if (!card || !card.enchants) return [];
  if (skillIds == null) {
    card.enchants = [];
  } else {
    const list = Array.isArray(skillIds) ? skillIds : [skillIds];
    card.enchants = card.enchants.filter((s) => !list.includes(s));
  }
  card.enchanted = card.enchants.length > 0;
  return card.enchants;
}

/** 这张牌附魔了哪些技能 */
export function cardEnchants(card) {
  return (card && card.enchants) ? card.enchants.slice() : [];
}

/** 这张牌是否附魔了某技能 */
export function hasEnchant(card, skillId) {
  return !!(card && card.enchants && card.enchants.includes(skillId));
}

/**
 * 汇总该牌附魔带来的效果系数
 * ------------------------------------------------------------------
 * 例：【无双】令【杀】需要两张【闪】响应。
 * 引擎在计算 needShanCount 时会调用本函数。
 *
 * @param {Card} card
 * @param {string} key 效果键（如 'shanRequired'）
 * @param {*} base 基础值
 * @param {object} SKILLS 技能表
 */
export function applyEnchantMod(card, key, base, SKILLS) {
  const ids = cardEnchants(card);
  if (!ids.length || !SKILLS) return base;
  let v = base;
  for (const sid of ids) {
    const sk = SKILLS[sid];
    if (!sk) continue;
    // 优先用 mod[key]，其次用技能顶层的同名钩子
    const fn = (sk.mod && sk.mod[key]) || sk[key];
    if (typeof fn === 'function') {
      try { v = fn(v); } catch { /* 单个附魔出错不影响其它 */ }
    }
  }
  return v;
}

/* ============================================================
 * J. 分发（本项目新增）
 * ============================================================
 * 需求方给定：将所要分发的牌，**尽可能平分**给相同的、
 * **自己以外**的其他角色；若出现「分发 5 张牌仅有 3 个角色」，
 * 则**多余的 2 张再次分发**。
 *
 * 实现：轮转发牌（round-robin）。
 *   第 1 轮每人均分 1 张 → 5 张 / 3 人 = 每人 1 张，余 2 张；
 *   余下的 2 张**再次分发** → 前 2 人再各得 1 张。
 */

/**
 * 计算分发方案（不实际发牌，便于测试与 UI 预览）
 * @param {number} cardCount 待分发牌数
 * @param {number} playerCount 参与分发的角色数
 * @returns {number[]} 每人获得的张数
 */
export function planDistribution(cardCount, playerCount) {
  if (playerCount <= 0) return [];
  const out = new Array(playerCount).fill(0);
  let left = Math.max(0, cardCount | 0);
  // 轮转分发：每轮每人一张，直到分完
  let i = 0;
  while (left > 0) {
    out[i % playerCount] += 1;
    i++;
    left--;
  }
  return out;
}

/**
 * 实际分发
 * @param {Player} source 分发者（不参与分配）
 * @param {Card[]} cards 待分发的牌
 * @param {Player[]} [receivers] 接收者，默认「自己以外的所有存活角色」
 * @returns {Promise<Array<{player:Player, cards:Card[]}>>}
 */
export async function distributeCards(source, cards, receivers) {
  const g = source && source.game;
  const list = normalizeList(cards).filter(Boolean);
  if (!g || !list.length) return [];

  let targets = receivers
    ? receivers.slice()
    : g.players.filter((p) => p.alive && p !== source);
  targets = targets.filter((p) => p && p.alive);
  if (!targets.length) return [];

  const plan = planDistribution(list.length, targets.length);
  const result = [];
  let idx = 0;
  for (let i = 0; i < targets.length; i++) {
    const n = plan[i];
    if (!n) { result.push({ player: targets[i], cards: [] }); continue; }
    const take = list.slice(idx, idx + n);
    idx += n;
    await targets[i].gain(take);
    result.push({ player: targets[i], cards: take });
  }
  g.log(`${source.name} 分发了 ${list.length} 张牌给 `
    + targets.map((p, i) => `${p.name}${plan[i]}张`).join('、'));
  g.emit();
  return result;
}

/* ============================================================
 * K. 废除（官方机制）
 * ============================================================
 * 无名杀依据（`library/element/content.js` 的 disableEquip）：
 *   · 被废除的装备栏不能再装备牌；
 *   · 原本在栏内的牌会被弃置
 *     （源码：`if (cards.length > 0) await player.loseToDiscardpile({cards})`）。
 *
 * 需求方补充：未标明时**全部为装备区**。
 */

/** 装备槽位 key ↔ 序号 */
const SLOT_BY_NUM = {
  1: 'equip1', 2: 'equip2', 3: 'equip3', 4: 'equip4', 5: 'equip5',
};

/**
 * 废除一个或多个区域
 * @param {Player} player
 * @param {string|number|Array} slots 槽位（'equip1' / 1 / ['equip1','equip2']）
 * @param {object} [opts]
 * @param {boolean} [opts.all] 传 true 表示废除全部装备区
 * @param {boolean} [opts.discard=true] 是否弃置区内原有的牌
 * @param {string} [opts.reason] 日志原因
 * @returns {Promise<Card[]>} 被弃置的牌
 */
export async function disableEquipSlots(player, slots, opts = {}) {
  if (!player) return [];
  const g = player.game;
  const { discard = true, reason = '' } = opts;

  // 归一化槽位
  let keys = [];
  if (opts.all) {
    keys = Object.values(SLOT_BY_NUM);
  } else {
    const raw = Array.isArray(slots) ? slots : [slots];
    keys = raw.map((s) => (typeof s === 'number' ? SLOT_BY_NUM[s] : s)).filter(Boolean);
  }
  if (!keys.length) return [];

  const lost = [];
  for (const key of keys) {
    // ① 标记为废除
    if (!player.disabledEquips.includes(key)) player.disabledEquips.push(key);
    // ② 区内原有的牌 → 弃置
    const card = player.equips && player.equips[key];
    if (card) {
      player.equips[key] = null;
      lost.push(card);
    }
  }

  if (lost.length && discard) {
    // ⚠️ 必须传数组（toDiscard 只收一个参数）
    g.toDiscard(lost, { direct: true });
  }

  if (g) {
    const label = keys.map((k) => SLOT_LABEL[k] || k).join('、');
    g.log(`${player.name} 的${label}被废除${reason ? `（${reason}）` : ''}`
      + `${lost.length ? `，其中的 ${lost.length} 张牌被弃置` : ''}`);
    g.emit();
  }
  return lost;
}

const SLOT_LABEL = {
  equip1: '武器区', equip2: '防具区', equip3: '进攻马区',
  equip4: '防御马区', equip5: '宝物区',
};

/** 恢复一个或多个区域 */
export function enableEquipSlots(player, slots, opts = {}) {
  if (!player) return [];
  let keys = [];
  if (opts.all) {
    keys = Object.values(SLOT_BY_NUM);
  } else {
    const raw = Array.isArray(slots) ? slots : [slots];
    keys = raw.map((s) => (typeof s === 'number' ? SLOT_BY_NUM[s] : s)).filter(Boolean);
  }
  player.disabledEquips = player.disabledEquips.filter((k) => !keys.includes(k));
  if (player.game) {
    player.game.log(`${player.name} 的`
      + `${keys.map((k) => SLOT_LABEL[k] || k).join('、')}被恢复`);
    player.game.emit();
  }
  return keys;
}

/** 某区域是否已被废除 */
export function isSlotDisabled(player, slot) {
  if (!player || !player.disabledEquips) return false;
  const key = typeof slot === 'number' ? SLOT_BY_NUM[slot] : slot;
  return player.disabledEquips.includes(key);
}

/* ============================================================
 * L. 发现（官方机制的延伸；按需求方描述实现）
 * ============================================================
 * ⚠️ 与无名杀的差异（已与需求方确认按本描述实现）：
 *    无名杀的 `discoverCard` 是「从候选池随机取 num 张、选 1 张获得」；
 *    本机制按需求方描述实现为**翻牌堆直到翻出符合的牌**。
 *
 * 需求方给定规则：
 *   · 从目标位置（默认对应牌堆顶）翻开牌，
 *     直到翻开的牌为「要发现的牌」，则获得之然后结束流程；
 *   · 若同时发现**多张**牌，则直到翻开的**牌全部符合**
 *     要发现的牌后（例如发现 2 张锦囊，直到 2 张锦囊被翻开为止），
 *     获得目标牌然后结束流程。
 */

/**
 * 执行「发现」
 * @param {Game} game
 * @param {Player} player 发现者
 * @param {Function|object} spec 目标条件
 *        - 函数：(card) => boolean
 *        - 对象：{ name:'jiedao' } 或 { type:'trick' } 或 { names:[...] }
 * @param {object} [opts]
 * @param {number} [opts.count=1] 需要发现几张（全部符合才结束）
 * @param {string} [opts.from='top'] 'top'（牌堆顶）| 'bottom'（牌堆底）
 * @param {boolean} [opts.gain=true] 是否获得翻出的目标牌
 * @param {number} [opts.maxFlip=60] 安全上限，防止无限翻
 * @returns {Promise<{found:Card[], flipped:Card[], exhausted:boolean}>}
 */
export async function discover(game, player, spec, opts = {}) {
  const {
    count = 1, from = 'top', gain = true, maxFlip = 60,
  } = opts;

  const match = makeMatcher(spec);
  const found = [];
  const flipped = [];
  let exhausted = false;

  for (let i = 0; i < maxFlip; i++) {
    if (found.length >= count) break;
    // 从指定位置取一张
    // 注意：引擎的 takeFromDeckXxx 接收「数量」并返回数组；
    //       第二个参数传 true 表示牌堆空时**不自动洗牌**，
    //       这样「翻到翻不动为止」的语义才成立（否则会无限续牌）。
    const batch = (from === 'bottom')
      ? game.takeFromDeckBottom(1, true)
      : game.takeFromDeckTop(1, true);
    const card = batch && batch[0];
    if (!card) { exhausted = true; break; }

    flipped.push(card);
    if (match(card)) {
      found.push(card);
      game.log(`【发现】翻出了 ${card.fullname || card.name}`
        + `（${found.length}/${count}）`);
    } else {
      // 不符合的牌置入弃牌堆
      game.toDiscard([card], { direct: true });
      game.log(`【发现】翻出 ${card.fullname || card.name}，不符合条件，置入弃牌堆`);
    }
  }

  if (exhausted) {
    game.log(`【发现】牌堆已空，仅发现 ${found.length}/${count} 张`);
  }

  // 获得目标牌
  if (gain && found.length) {
    await player.gain(found);
    game.log(`${player.name} 通过【发现】获得了 `
      + found.map((c) => c.fullname || c.name).join('、'));
  }

  game.emit();
  return { found, flipped, exhausted };
}

/** 把 spec 归一化成判定函数 */
function makeMatcher(spec) {
  if (typeof spec === 'function') return spec;
  if (!spec) return () => false;
  if (typeof spec === 'string') {
    return (c) => c && c.name === spec;
  }
  return (c) => {
    if (!c) return false;
    if (spec.name && c.name !== spec.name) return false;
    if (spec.names && !spec.names.includes(c.name)) return false;
    if (spec.type && c.type !== spec.type) return false;
    if (spec.subtype && c.subtype !== spec.subtype) return false;
    if (spec.suit && c.suit !== spec.suit) return false;
    return true;
  };
}

/* ------------------------------------------------------------ */

/** 归一化：接受 Card / Card[] / null */
function normalizeList(cards) {
  if (!cards) return [];
  if (Array.isArray(cards)) return cards;
  if (typeof cards === 'object' && cards.name !== undefined) return [cards];
  return [];
}

/* ============================================================
 * M. 横置牌（本项目新增）
 * ============================================================
 * ⚠️ 核实说明：无名杀的「横置」指的是**角色状态**（连环状态，即铁索
 *    连环的 link），本项目早已实现（Player.isChained）。
 *    这里要做的是**牌级的横置**，无名杀并无对应机制，
 *    因此完全按需求方给定实现。
 *
 * 需求方给定规则：
 *   · 横置的牌被**弃置**时，**一并弃置**手牌中其余的横置牌；
 *   · 横置的牌被**其他角色获得**时，**一并获得**手牌中其余的横置牌；
 *   · 表现形式上须将牌横向持有（本项目用角标表示，见样式）。
 */

/** 横置一张或多张牌 */
export function linkCards(cards) {
  const list = normalizeList(cards);
  const out = [];
  for (const c of list) {
    if (!c) continue;
    c.horizontal = true;
    out.push(c);
  }
  return out;
}

/** 解除横置 */
export function unlinkCards(cards) {
  const list = normalizeList(cards);
  for (const c of list) {
    if (c) delete c.horizontal;
  }
  return list;
}

/** 这张牌是否被横置 */
export function isLinkedCard(card) {
  return !!(card && card.horizontal);
}

/**
 * 取某角色**手牌中**所有横置牌
 * @param {Player} player
 * @param {Card} [except] 可排除一张（通常是触发源头本身）
 */
export function linkedHandCards(player, except) {
  if (!player || !player.hand) return [];
  return player.hand.filter((c) => c && c.horizontal && c !== except);
}

/**
 * 横置牌的「连带弃置」
 * ------------------------------------------------------------------
 * 当某张横置牌被弃置时，该角色手牌中其余的横置牌**一并弃置**。
 *
 * @param {Player} owner 原持有者
 * @param {Card} card 触发连带的横置牌
 * @param {Function} [discardFn] 弃置函数，默认用 owner.discard
 * @returns {Promise<Card[]>} 被连带弃置的牌
 */
export async function cascadeDiscardLinked(owner, card, discardFn) {
  if (!owner || !isLinkedCard(card)) return [];
  const extra = linkedHandCards(owner, card);
  if (!extra.length) return [];

  if (typeof discardFn === 'function') {
    await discardFn(extra);
  } else if (owner.game) {
    for (const c of extra) delete c.horizontal;
    owner.game.toDiscard(extra, { direct: true });
    if (owner.game.log) {
      owner.game.log(`【横置】${owner.name} 手牌中其余 `
        + `${extra.length} 张横置牌被一并弃置`);
    }
  }
  for (const c of extra) delete c.horizontal;
  return extra;
}

/**
 * 横置牌的「连带获得」
 * ------------------------------------------------------------------
 * 当某张横置牌被**其他角色**获得时，原持有者手牌中其余的横置牌
 * **一并被该角色获得**。
 *
 * @param {Player} receiver 获得牌的角色
 * @param {Player} owner 原持有者
 * @param {Card} card 触发连带的横置牌
 * @returns {Promise<Card[]>} 被连带获得的牌
 */
export async function cascadeGainLinked(receiver, owner, card) {
  if (!receiver || !owner || !isLinkedCard(card)) return [];
  if (receiver === owner) return [];      // 自己获得自己的牌不触发
  const extra = linkedHandCards(owner, card);
  if (!extra.length) return [];

  for (const c of extra) {
    // 离开原持有者手牌：同时解除横置与明置
    delete c.horizontal;
    invalidateRevealed([c]);
    const i = owner.hand.indexOf(c);
    if (i >= 0) owner.hand.splice(i, 1);
  }
  await receiver.gain(extra);
  if (owner.game && owner.game.log) {
    owner.game.log(`【横置】${owner.name} 手牌中其余 `
      + `${extra.length} 张横置牌被 ${receiver.name} 一并获得`);
  }
  return extra;
}

/* ============================================================
 * N. 即时牌（本项目新增）
 * ============================================================
 * 需求方给定：
 *   即时牌 = **基本牌 + 普通锦囊牌** 的总和，
 *   意为「即时产生效果」的牌。
 *   **延时锦囊牌、装备牌不包含在内。**
 *
 * 无名杀依据：`get.type2` 会把牌归为 basic / trick / equip，
 * 但延时锦囊（乐不思蜀/兵粮寸断/闪电）在无名杀里仍是 trick ——
 * 而本机制要把它们**排除**，因此这里用 `def.delayed` 单独判定。
 */

/** 这张牌是否是即时牌 */
export function isInstantCard(card, CARDS_REF) {
  if (!card) return false;
  const def = (CARDS_REF || {})[card.name];
  const type = (def && def.type) || card.type;
  // 基本牌 → 是
  if (type === 'basic') return true;
  // 普通锦囊 → 是；延时锦囊 → 不是
  if (type === 'trick') {
    const delayed = (def && def.delayed) || card.delayed;
    return !delayed;
  }
  // 装备牌 → 不是
  return false;
}

/** 从一组牌里筛出即时牌 */
export function filterInstantCards(cards, CARDS_REF) {
  return normalizeList(cards).filter((c) => isInstantCard(c, CARDS_REF));
}

/* ============================================================
 * O. 连招技（官方机制）
 * ============================================================
 * 无名杀依据：
 *   ① 技能标签：`get/index.js` 里 `if (info.comboSkill) list.add("连招技")`；
 *   ② 判定方式：`library/element/player.js` 的 `getLastUsed(num)`
 *      —— 取 `getHistory("useCard")` 里**倒数第 num+1 个**（默认 num=0，
 *      即**上一张使用的牌**）；
 *   ③ 典型写法（`character/xianding/skill.js` 的 dcxiaoben/dczhuitao）：
 *      `const evt = lib.skill.xxx.getLastUsed(player, event);`
 *      `if (!evt || !evt.card) return false;`
 *      `return <条件(evt.card, event.card)>;`
 *
 * 需求方给定：
 *   · 「连续的两张牌使用时符合括号内要求」→ 立刻触发连招技；
 *   · 「连招」则是**直接触发效果**（不再要求连续两张牌的条件）。
 *
 * 因此本实现：
 *   - comboSkill 技能声明 `combo: { check(prev, cur, ctx) }`；
 *   - 引擎在 useCard 时用「上一张使用的牌」与「当前牌」做比对。
 */

/**
 * 取某角色上一张使用的牌的记录（对照无名杀 getLastUsed）
 * @param {Player} player
 * @param {number} [num=0] 0 = 上一张
 */
export function getLastUsedCard(player, num = 0) {
  const g = player && player.game;
  if (!g) return null;
  const hist = (g.useEvents || []).filter(
    (e) => e && e.kind === 'use' && e.player === player,
  );
  if (hist.length <= num) return null;
  return hist[hist.length - num - 1];
}

/**
 * 判定「连招技」是否成立
 * ------------------------------------------------------------------
 * @param {Player} player 技能拥有者
 * @param {Card} cur 当前使用的牌
 * @param {object} skill 技能定义（需有 combo.check）
 * @param {object} ctx 上下文（含 game / event）
 * @returns {boolean}
 */
export function checkCombo(player, cur, skill, ctx = {}) {
  if (!skill) return false;
  const combo = skill.combo || {};
  // 「连招」：直接触发，不需要连续条件
  if (combo.direct === true) return true;

  const last = getLastUsedCard(player, 0);
  if (!last || !last.card) return false;
  const prev = last.card;
  // 同一次使用不算「连续两张」
  if (ctx.event && ctx.event._comboPrev === prev) return false;

  if (typeof combo.check === 'function') {
    return !!combo.check(prev, cur, { ...ctx, player, prevEvent: last });
  }
  // 未声明 check 时的默认：仅要求「有上一张牌」
  return true;
}

/* ============================================================
 * P. 酩酊（本扩机制引申）
 * ============================================================
 * 需求方给定：**使用【酒】后的状态**。
 *
 * 与既有「酒意」的关系：
 *   本项目已有 `Player.flags.jiu` / `Game.jiuActive()` 表示酒意
 *   （参考无名杀 storage.jiu）。「酩酊」是同一状态在**本扩**里的名称，
 *   因此这里直接以酒意作为酩酊的判定依据，保证二者不会出现分歧。
 */

/** 该角色是否处于酩酊状态（= 使用过【酒】后的状态） */
export function isDrunk(player) {
  if (!player) return false;
  if (player.game && typeof player.game.jiuActive === 'function') {
    return !!player.game.jiuActive(player);
  }
  return !!(player.flags && player.flags.jiu);
}

/** 酩酊状态的剩余效力描述（供 UI 显示） */
export function drunkStatus(player) {
  if (!isDrunk(player)) return null;
  return { active: true, label: '酩酊' };
}

/* ============================================================
 * Q. 明置（本项目新增）
 * ============================================================
 * ⚠️ 核实说明：无名杀的 `showCards` 是**一次性展示**（给所有人看一眼
 *    就结束），**没有持续的「明置状态」**。因此本机制按需求方给定实现。
 *
 * 需求方给定规则：
 *   · 被明置的手牌**随时可被其他角色观看**（持续状态）；
 *   · 一张明置牌被**原牌以外的角色获得**后，失去明置状态；
 *   · **令一张明置牌暗置**，同样失去明置状态。
 *
 * 需求方补充（确认过）：
 *   · 被**弃置 / 自己使用 / 暗置 / 别人获得 / 放入木牛流马 / 被除外**
 *     —— 这些情况**都会**失去明置状态；
 *   · 查看别人的明置牌走**右键武将详情**；
 *   · 【顺手牵羊】这类牌**可以明着选择**明置牌（因为是公开信息）。
 */

/** 明置一张或多张牌 */
export function revealCards(cards, owner) {
  const list = normalizeList(cards);
  const out = [];
  for (const c of list) {
    if (!c) continue;
    /*
     * 复用引擎里**已有的** Card.setRevealed / Card.isVisibleTo 机制
     *（见 engine.js 的 Card 类），避免与它各写一套导致行为分歧。
     * 若传入的牌不是 Card 实例（测试桩），则退回直接打标记。
     */
    if (typeof c.setRevealed === 'function') c.setRevealed(true, owner || c.owner);
    else { c.revealed = true; if (owner) c.revealOwner = owner; }
    out.push(c);
  }
  if (out.length && owner && owner.game) {
    owner.game.log(`${owner.name} 明置了 ${out.length} 张手牌`
      + `（${out.map((c) => c.fullname || c.name).join('、')}）`);
    owner.game.emit();
  }
  return out;
}

/** 暗置（失去明置状态） */
export function hideCards(cards) {
  const list = normalizeList(cards);
  for (const c of list) {
    if (!c) continue;
    if (typeof c.setRevealed === 'function') c.setRevealed(false);
    else { delete c.revealed; delete c.revealOwner; }
  }
  return list;
}

/** 清除某张牌的明置状态（内部统一入口） */
export function clearRevealed(card) {
  if (!card) return false;
  const had = !!card.revealed;
  if (typeof card.setRevealed === 'function') card.setRevealed(false);
  else { delete card.revealed; delete card.revealOwner; }
  return had;
}

/** 这张牌是否明置 */
export function isRevealed(card) {
  return !!(card && card.revealed);
}

/**
 * 某角色**当前可被所有人看到的明置手牌**
 * （供右键武将详情、以及【顺手牵羊】这类牌的目标牌选择使用）
 */
export function revealedCardsOf(player) {
  if (!player || !player.hand) return [];
  return player.hand.filter((c) => c && c.revealed);
}

/**
 * 观者能看到某角色的哪些手牌
 * ------------------------------------------------------------------
 * 返回值里的 `revealed` 标记表示「因明置而公开」。
 * 注意：这只是**信息可见性**，不代表可以合法操作这些牌。
 */
export function visibleHandCards(viewer, owner) {
  if (!owner || !owner.hand) return [];
  const revealed = owner.hand.filter((c) => c && c.revealed);
  if (viewer === owner) {
    return owner.hand.map((c) => ({ card: c, revealed: !!c.revealed, self: true }));
  }
  return revealed.map((c) => ({ card: c, revealed: true, self: false }));
}

/**
 * 明置牌的批量失效
 * ------------------------------------------------------------------
 * 需求方确认：以下情况**都会**失去明置状态——
 *   被弃置 / 自己使用 / 被暗置 / 被别人获得 /
 *   被放入木牛流马 / 被除外
 *
 * 实现上优先复用 Card.checkRevealLost（引擎原有），
 * 此处作为「统一兜底入口」，保证任何调用点都不会漏清。
 *
 * @param {Card|Card[]} cards
 * @returns {Card[]} 被清除明置的牌
 */
export function invalidateRevealed(cards) {
  const list = normalizeList(cards);
  const out = [];
  for (const c of list) {
    if (!c) continue;
    // 只要当前是明置状态，就清掉
    if (c.revealed && clearRevealed(c)) out.push(c);
  }
  return out;
}

/* ============================================================
 * R. 命运回合（本项目新增）
 * ============================================================
 * 需求方给定：
 *   所有角色的**额定回合均执行后**，于**轮次结束前**，
 *   拥有命运回合的角色**按座次顺序**，每人依次开始一个额外回合。
 *
 * 依赖 H 节的「额定回合」判定（额外回合不算额定回合）。
 */

/** 该角色是否拥有命运回合 */
export function hasDestinyTurn(player) {
  return !!(player && player.destinyTurn);
}

/** 授予 / 取消命运回合 */
export function setDestinyTurn(player, on = true) {
  if (!player) return false;
  player.destinyTurn = !!on;
  if (player.game) {
    player.game.log(`${player.name}${on ? '获得' : '失去'}了命运回合`);
    player.game.emit();
  }
  return true;
}

/**
 * 计算本轮命运回合的执行顺序（按座次）
 * @param {Game} game
 * @returns {Player[]} 需要执行命运回合的角色（按座位号升序）
 */
export function destinyTurnOrder(game) {
  if (!game) return [];
  return game.players
    .filter((p) => p.alive && hasDestinyTurn(p))
    .sort((a, b) => a.id - b.id);
}

/* ============================================================
 * S. 否极技（本项目新增）
 * ============================================================
 * 需求方给定：
 *   · 带有此标签的技能包含**至少两个分支选项**；
 *   · 技能效果取决于**当前生效且被选择的选项**；
 *   · **每个选项于一局游戏内选择次数上限为 1**；
 *   · 当**所有选项**的选择次数均达到上限时，**重置所有选项**的选择次数。
 *
 * 技能写法：
 *   {
 *     fouji: {
 *       options: [
 *         { id: 'a', name: '选项一', run: async (ctx) => {...} },
 *         { id: 'b', name: '选项二', run: async (ctx) => {...} },
 *       ],
 *     },
 *   }
 * 每种选项一局各只能选 1 次；全部选过一遍后统一重置。
 */

/** 取某技能的否极选项目前哪些可用 */
export function foujiAvailableOptions(player, skill) {
  const opts = (skill && skill.fouji && skill.fouji.options) || [];
  const used = (player.storage && player.storage[`fouji_${skill.id}`]) || {};
  return opts.filter((o) => !used[o.id]);
}

/** 该否极技是否所有选项都已用完（即需要重置） */
export function foujiAllUsed(player, skill) {
  const opts = (skill && skill.fouji && skill.fouji.options) || [];
  if (!opts.length) return false;
  const used = (player.storage && player.storage[`fouji_${skill.id}`]) || {};
  return opts.every((o) => used[o.id]);
}

/** 标记某个选项已被选择 */
export function markFoujiUsed(player, skill, optionId) {
  if (!player || !skill) return;
  player.storage = player.storage || {};
  const key = `fouji_${skill.id}`;
  const used = player.storage[key] || {};
  used[optionId] = true;
  player.storage[key] = used;
  return used;
}

/** 重置所有选项的选择次数 */
export function resetFouji(player, skill) {
  if (!player || !skill) return;
  player.storage = player.storage || {};
  player.storage[`fouji_${skill.id}`] = {};
  if (player.game) {
    player.game.log(`【否极】${skill.name} 的选项已全部重置`);
    player.game.emit();
  }
}

/**
 * 选择并执行一个否极选项
 * ------------------------------------------------------------------
 * 自动处理「全部选完 → 重置」的逻辑。
 *
 * @param {object} ctx { player, game, skill, ... }
 * @param {Function} chooser 选择函数：(available, ctx) => option | null
 * @returns {Promise<object|null>} 实际执行的选项
 */
export async function useFouji(ctx, chooser) {
  const { player, skill, game } = ctx;
  if (!player || !skill) return null;

  // 若全部选项都已用完，先重置
  if (foujiAllUsed(player, skill)) {
    resetFouji(player, skill);
  }

  const available = foujiAvailableOptions(player, skill);
  if (!available.length) return null;

  let picked = null;
  if (typeof chooser === 'function') {
    picked = await chooser(available, ctx);
  } else {
    picked = available[0];
  }
  if (!picked) return null;

  markFoujiUsed(player, skill, picked.id);
  if (game) game.log(`${player.name} 选择了【${skill.name}】的${picked.name || picked.id}`);

  if (typeof picked.run === 'function') {
    await picked.run({ ...ctx, option: picked });
  }
  return picked;
}

/* ============================================================
 * T. 契定技（官方机制）
 * ============================================================
 * 无名杀依据（`library/poptip.js` 的 `sxrm_qidingSkill`）：
 *   原文：「一种技能标签。**发动一次后**，此技能『契定技』的标签
 *          改为『锁定技』并**删除技能描述中的「可以」**。」
 *
 * 判定函数见 `get/is.js` 的 `qidingSkill(skill, player)`：
 *   支持布尔值或函数（函数返回 true 表示当前**仍处于契定状态**）。
 */

/** 该技能此刻是否仍为「契定技」（未发动过） */
export function isQidingSkill(player, skill) {
  if (!player || !skill) return false;
  const q = skill.qidingSkill;
  if (typeof q === 'function') {
    try { return !!q(skill.id || skill, player); } catch { return false; }
  }
  if (q === undefined) return false;
  if (!q) return false;
  // 已发动过 → 不再是契定技（已转为锁定技）
  return !isQidingUsed(player, skill);
}

/** 该契定技是否已发动过 */
export function isQidingUsed(player, skill) {
  if (!player || !skill) return false;
  const key = `qiding_${skill.id}`;
  return !!(player.storage && player.storage[key]);
}

/**
 * 发动契定技后的处理（对照无名杀的两条效果）
 *   ① 「契定技」标签 → 「锁定技」
 *   ② 删除技能描述中的「可以」
 */
export function markQidingUsed(player, skill) {
  if (!player || !skill) return;
  player.storage = player.storage || {};
  player.storage[`qiding_${skill.id}`] = true;
  if (player.game) {
    player.game.log(`【契定】${skill.name} 已发动，转为锁定技`);
    player.game.emit();
  }
  return true;
}

/**
 * 取「转为锁定技之后」的技能描述
 * ------------------------------------------------------------------
 * 即把描述里的「可以」全部删去（无名杀原文：
 * 「删除技能描述中的『可以』」）。
 * 注意只删「可以」二字，其余文字原样保留。
 */
export function qidingLockedDesc(skill) {
  if (!skill) return '';
  return String(skill.desc || '').replace(/可以/g, '');
}

/**
 * 该技能此刻是否应被视为锁定技
 * （原本 locked，或原本是契定技但已发动过）
 */
export function isQidingLocked(player, skill) {
  if (!skill) return false;
  if (skill.locked) return true;
  if (skill.qidingSkill && isQidingUsed(player, skill)) return true;
  return false;
}

/* ============================================================
 * U. 熔铸（本项目新增）
 * ============================================================
 * 需求方给定：将**对应数量的牌弃置**后，**摸一张牌**。
 *   （注意与官方「重铸」的区别：重铸是弃 N 张摸 N 张；
 *     熔铸是不论弃几张，都只摸 1 张。）
 */

/**
 * 熔铸
 * @param {Player} player
 * @param {Card[]} cards 要弃置的牌
 * @param {object} [opts]
 * @param {number} [opts.draw=1] 摸牌数（默认 1）
 * @returns {Promise<{discarded:Card[], drawn:Card[]}>}
 */
export async function meltCast(player, cards, opts = {}) {
  const { draw: drawNum = 1 } = opts;
  const g = player && player.game;
  const list = normalizeList(cards).filter(Boolean);
  if (!g || !list.length) return { discarded: [], drawn: [] };

  g.log(`${player.name} 熔铸 ${list.length} 张牌`
    + `（${list.map((c) => c.text).join('、')}）`);
  await player.discard(list);
  const drawn = await player.draw(drawNum);
  g.log(`${player.name} 熔铸后摸了 ${(drawn || []).length} 张牌`);
  g.emit();
  return { discarded: list, drawn: drawn || [] };
}

/* ============================================================
 * V. 仁区（官方机制）
 * ============================================================
 * 无名杀依据（`library/index.js` 的 `commonArea.renku`）：
 *   · 翻译名「仁库」，牌存于 `_status.renku`，是**公共区域**；
 *   · `addHandeler` 原文：
 *       _status.renku.addArray(cards...)
 *       if (_status.renku.length > 6) {
 *         const cards2 = _status.renku.splice(0, _status.renku.length - 6);
 *         await game.cardsDiscard(cards2)...
 *       }
 *     即：**至多 6 张**，超出时**最先置入的**进入弃牌堆。
 *
 * 需求方给定与上述完全一致，因此按无名杀实现。
 */

export const RENKU_LIMIT = 6;

/** 取仁区（公共区域，所有角色可见） */
export function renkuCards(game) {
  if (!game) return [];
  return game.renku || (game.renku = []);
}

/**
 * 将牌置入仁区
 * ------------------------------------------------------------------
 * 超出 6 张时，**最先置入的**牌进入弃牌堆。
 *
 * @returns {Promise<Card[]>} 因溢出而进入弃牌堆的牌
 */
export async function addToRenku(game, cards) {
  const g = game;
  if (!g) return [];
  const list = normalizeList(cards).filter(Boolean);
  if (!list.length) return [];
  const zone = renkuCards(g);

  for (const c of list) {
    // 从原区域摘掉
    for (const p of g.players) {
      const hi = p.hand.indexOf(c);
      if (hi >= 0) p.hand.splice(hi, 1);
      for (const slot of Object.keys(p.equips || {})) {
        if (p.equips[slot] === c) p.equips[slot] = null;
      }
      const ji = (p.judges || []).indexOf(c);
      if (ji >= 0) p.judges.splice(ji, 1);
    }
    c.zone = 'renku';
    zone.push(c);
  }
  g.log(`仁区置入了 ${list.length} 张牌（现有 ${zone.length} 张）`);

  // 溢出处理：最先置入的进弃牌堆
  let overflow = [];
  if (zone.length > RENKU_LIMIT) {
    overflow = zone.splice(0, zone.length - RENKU_LIMIT);
    for (const c of overflow) c.zone = 'discard';
    g.toDiscard(overflow, { direct: true });
    g.log(`仁区已满 ${RENKU_LIMIT} 张，最先置入的 ${overflow.length} 张`
      + `进入弃牌堆`);
  }
  g.emit();
  return overflow;
}

/**
 * 从仁区移去牌
 * @returns {Card[]} 实际移出的牌
 */
export function removeFromRenku(game, cards) {
  const g = game;
  if (!g) return [];
  const zone = renkuCards(g);
  const list = normalizeList(cards).filter(Boolean);
  const moved = [];
  for (const c of list) {
    const i = zone.indexOf(c);
    if (i < 0) continue;
    zone.splice(i, 1);
    moved.push(c);
  }
  if (moved.length) {
    g.log(`仁区移去了 ${moved.length} 张牌（现有 ${zone.length} 张）`);
    g.emit();
  }
  return moved;
}

/** 取某角色从仁区获得牌 */
export async function gainFromRenku(player, cards) {
  const g = player && player.game;
  if (!g) return [];
  const moved = removeFromRenku(g, cards);
  if (moved.length) await player.gain(moved);
  return moved;
}

/* ============================================================
 * W. 入幻 / 入魔（官方机制的修改）
 * ============================================================
 * 无名杀依据（`library/poptip.js`）：
 *   · 入魔 `rule_rumo`：「每局游戏限一次，当你满足条件后，可入魔。
 *     入魔后，**每轮结束时，若本轮你未造成过伤害，你失去1点体力**。」
 *   · 变身 `rule_bianshen`：「进入变身状态时，弃置判定区里的所有牌。
 *     变身状态下替换武将牌，**两张武将牌血量单独计算**。」
 *
 * 需求方给定（在本项目里的落地规则）：
 *   · 只有拥有对应「幻形态 / 魔形态」的武将才能触发；
 *   · 替换武将牌；**体力值/体力上限两形态不共享**；
 *     **区域内的牌共享**（手牌、装备、判定都留着）；
 *   · 于幻形态死亡时，若无特殊声明，角色死亡；
 *   · 入魔额外：每轮结束若本轮未造成伤害 → 流失 1 点体力；
 *     退出魔形态时 → **流失 1 点体力并摸两张牌**。
 */

/**
 * 进入幻形态
 * @param {Player} player
 * @param {object} form { charId, hp, maxHp, skills? }
 */
export async function enterHuan(player, form) {
  return enterAlternateForm(player, form, 'huan');
}

/** 退出幻形态 */
export async function exitHuan(player) {
  return exitAlternateForm(player, 'huan');
}

/** 进入魔形态 */
export async function enterMo(player, form) {
  return enterAlternateForm(player, form, 'mo');
}

/**
 * 退出魔形态
 * ------------------------------------------------------------------
 * 按需求方规则：退出时**流失 1 点体力并摸两张牌**。
 */
export async function exitMo(player) {
  if (!player || !player.alive) return false;
  const wasMo = player.altForm === 'mo';
  await exitAlternateForm(player, 'mo');
  if (!wasMo) return false;
  // 退出魔形态的代价
  await player.loseHp(1);
  if (player.alive) await player.draw(2);
  if (player.game) {
    player.game.log(`${player.name} 退出魔形态：流失 1 点体力并摸两张牌`);
  }
  return true;
}

/**
 * 通用：进入替代表形态
 * ------------------------------------------------------------------
 * 两形态的体力**各自独立保存**，切换时保存旧值、载入新值；
 * 区域内的牌**不处理**（共享）。
 */
async function enterAlternateForm(player, form, kind) {
  if (!player || !form) return false;
  const g = player.game;

  /*
   * ⚠️ 进入形态前**必须先存档当前（基础）形态的体力**。
   *    否则退出时找不到基础形态的血量，会错误地沿用化身形态的值。
   */
  saveFormVitals(player);

  // 已有形态时也要把该形态的体力存好
  if (player.altForm) saveFormVitals(player);

  player.altForm = kind;
  player.altForms = player.altForms || {};
  player.altForms[kind] = {
    charId: form.charId || player.charId,
    name: form.name,
    skills: form.skills ? form.skills.slice() : null,
  };

  // 替换武将牌（charId / 名字 / 技能）
  const old = { charId: player.charId, name: player.name, skills: player.skills.slice() };
  player.baseCharId = player.baseCharId || player.charId;
  player.baseName = player.baseName || player.name;
  player.baseSkills = player.baseSkills || player.skills.slice();

  if (form.charId) player.charId = form.charId;
  if (form.name) player.name = form.name;
  if (form.skills) player.skills = form.skills.slice();

  // 体力独立：载入该形态自己的体力
  loadFormVitals(player, kind, form);

  /*
   * 无名杀的「变身」规则：进入变身状态时弃置判定区所有牌。
   * 需求方未否定这一点，且「区域内的牌共享」指的是手牌/装备，
   * 判定区的延时锦囊与化身状态强相关，因此按无名杀处理。
   */
  if (player.judges && player.judges.length) {
    const js = player.judges.slice();
    player.judges = [];
    g.toDiscard(js, { direct: true });
    g.log(`${player.name} 进入${kind === 'mo' ? '魔' : '幻'}形态，`
      + `弃置判定区 ${js.length} 张牌`);
  }

  g.log(`${player.name} 进入${kind === 'mo' ? '魔' : '幻'}形态`
    + `（${player.name}，体力 ${player.hp}/${player.maxHp}）`);
  g.emit();
  void old;
  return true;
}

/** 通用：退出替代表形态 */
async function exitAlternateForm(player, kind) {
  if (!player || player.altForm !== kind) return false;
  saveFormVitals(player);
  player.altForm = null;

  // 换回原本的武将牌
  if (player.baseCharId) player.charId = player.baseCharId;
  if (player.baseName) player.name = player.baseName;
  if (player.baseSkills) player.skills = player.baseSkills.slice();

  // 恢复原形态的体力
  loadFormVitals(player, 'base', null);
  if (player.game) {
    player.game.log(`${player.name} 退出了${kind === 'mo' ? '魔' : '幻'}形态`);
    player.game.emit();
  }
  return true;
}

/** 保存当前形态的体力（两形态不共享） */
function saveFormVitals(player) {
  player.formVitals = player.formVitals || {};
  const key = player.altForm || 'base';
  player.formVitals[key] = { hp: player.hp, maxHp: player.maxHp };
}

/** 载入某形态的体力 */
function loadFormVitals(player, key, form) {
  player.formVitals = player.formVitals || {};
  const saved = player.formVitals[key];
  if (saved) {
    player.hp = Math.min(saved.hp, saved.maxHp);
    player.maxHp = saved.maxHp;
  } else if (form) {
    player.hp = form.hp != null ? form.hp : player.hp;
    player.maxHp = form.maxHp != null ? form.maxHp : player.maxHp;
    player.formVitals[key] = { hp: player.hp, maxHp: player.maxHp };
  } else {
    // 回到基础形态但没有存档 → 保持当前值
    player.formVitals[key] = { hp: player.hp, maxHp: player.maxHp };
  }
}

/** 该角色是否处于某个替代表形态 */
export function altFormOf(player) {
  return (player && player.altForm) || null;
}

/** 该角色是否拥有对应形态（入幻/入魔的前提） */
export function hasAltForm(player, kind) {
  if (!player) return false;
  return !!(player.altForms && player.altForms[kind]);
}

/**
 * 入魔的每轮结算
 * ------------------------------------------------------------------
 * 「每轮结束时，若本轮你未造成过伤害，你失去 1 点体力。」
 * 由引擎在轮次结束时调用。
 */
export async function checkMoRoundEnd(game) {
  if (!game) return [];
  const hit = [];
  for (const p of game.players) {
    if (!p.alive || p.altForm !== 'mo') continue;
    if (p.flags && p.flags._moDamagedThisRound) continue;
    game.log(`【入魔】${p.name} 本轮未造成伤害，流失 1 点体力`);
    await p.loseHp(1);
    hit.push(p);
  }
  return hit;
}

/** 标记「本轮造成过伤害」（入魔判定用） */
export function markMoDamaged(player) {
  if (!player) return;
  player.flags = player.flags || {};
  player.flags._moDamagedThisRound = true;
}

/** 每轮开始时重置入魔的伤害记录 */
export function resetMoRound(game) {
  if (!game) return;
  for (const p of game.players) {
    if (p.flags) delete p.flags._moDamagedThisRound;
  }
}

/* ============================================================
 * X. 施法（官方机制的落地）
 * ============================================================
 * ⚠️ 与无名杀的差异（已与需求方确认按本描述实现）：
 *   无名杀 `rule_shifa`：「X∈[1, 3]，在此之后的**第 X 个回合结束时**
 *                        执行施法效果」，**不涉及标记**。
 *   需求方给定：**X∈[1, 5]**，发动时**获得 X 个同名施法标记**，
 *              **每回合结束时移去 1 枚**，**归零时**结算效果。
 *   本实现按需求方版本。
 */

/** 某技能名的施法标记数量 */
export function shifaMarks(player, skillName) {
  if (!player || !player.storage) return 0;
  return player.storage[`shifa_${skillName}`] || 0;
}

/**
 * 发动施法
 * @param {Player} player
 * @param {object} skill 施法技能
 * @param {number} x 声明的数字（1-5）
 * @returns {Promise<boolean>} 是否成功发动
 */
export function castShifa(player, skill, x) {
  if (!player || !skill) return false;
  const name = skill.id || skill.name;
  // 「若你身上没有与该技能同名的施法标记，你可以发动此技能」
  if (shifaMarks(player, name) > 0) return false;

  const n = Math.max(1, Math.min(5, Math.round(x || 1)));
  player.storage = player.storage || {};
  player.storage[`shifa_${name}`] = n;
  player.storage[`shifaX_${name}`] = n;      // 效果里的 X
  if (player.game) {
    player.game.log(`${player.name} 发动【${skill.name}】施法，`
      + `声明 X=${n}，获得 ${n} 个施法标记`);
    player.game.emit();
  }
  return true;
}

/** 该技能此刻是否可以发动施法（没有同名标记） */
export function canCastShifa(player, skill) {
  if (!player || !skill) return false;
  const name = skill.id || skill.name;
  return shifaMarks(player, name) === 0;
}

/**
 * 回合结束时移去一枚施法标记
 * ------------------------------------------------------------------
 * 由引擎在回合结束时调用；归零时执行该技能的施法效果。
 *
 * @param {Game} game
 * @param {Player} owner 回合的主人（施法标记挂在他身上）
 * @returns {Promise<Array>} 本次结算的技能列表
 */
export async function tickShifa(game, owner) {
  if (!game || !owner || !owner.storage) return [];
  const done = [];
  const keys = Object.keys(owner.storage).filter((k) => k.startsWith('shifa_')
    && !k.startsWith('shifaX_'));
  for (const key of keys) {
    const name = key.slice('shifa_'.length);
    const cur = owner.storage[key];
    if (!cur || cur <= 0) continue;
    const left = cur - 1;
    owner.storage[key] = left;
    game.log(`【施法】${owner.name} 的「${name}」标记 ${cur} → ${left}`);

    if (left <= 0) {
      // 归零 → 结算效果，并清理标记
      delete owner.storage[key];
      const x = owner.storage[`shifaX_${name}`] || 1;
      delete owner.storage[`shifaX_${name}`];
      const sk = game.skillsRef && game.skillsRef[name];
      game.log(`【施法】${owner.name} 的「${name}」标记归零，执行结算`
        + `（X=${x}）`);
      if (sk && typeof sk.shifaEffect === 'function') {
        await sk.shifaEffect({ player: owner, game, skill: sk, x });
      }
      done.push({ name, x, skill: sk });
    }
  }
  if (done.length) game.emit();
  return done;
}

/* ============================================================
 * Y. 失救（官方机制的时点）
 * ============================================================
 * 需求方给定：
 *   「你的濒死结算结束时你死亡时，此时为**失救时点**，
 *     部分技能可能可以恢复体力从而继续游戏。」
 *
 * 实现：在濒死流程走完、确认无法挽救、**即将阵亡之前**
 *       触发 `failedSave` 时机；技能可在此时恢复体力来续命。
 */

/**
 * 失救时点的处理
 * @param {Game} game
 * @param {Player} player 即将因失救而阵亡的角色
 * @returns {Promise<boolean>} 是否被救回（恢复了体力）
 */
export async function triggerFailedSave(game, player) {
  if (!game || !player) return false;
  const ev = { player, rescued: false };
  game.log(`${player.name} 的濒死结算结束，进入失救时点`);
  await game.checkSkills('failedSave', ev);

  if (ev.rescued && player.hp > 0) {
    game.log(`【失救】${player.name} 被技能救回（体力 ${player.hp}）`);
    game.emit();
    return true;
  }
  return false;
}

/* ============================================================
 * Z. 体力变化（本项目新增的「统一概念」）
 * ============================================================
 * 需求方给定：「体力变化」包含以下效果——
 *   受到伤害、失去体力、恢复体力、体力值调整、体力值（被）转化。
 *
 * 用途：把「体力发生任何形式的变化」统一记录/触发，
 *       供「每当体力变化时」这类技能使用。
 *
 * ⚠️ 关键区分（需求方明确要求）：
 *   · 只有前三种（伤害/失去/恢复）是**真正的体力得失**；
 *   · 「体力值调整」**不视为**恢复体力、失去体力、受到伤害；
 *   · 「体力值转化」同理。
 *   因此本记录用 `kind` 区分，技能可自行取舍。
 */

/** 体力变化的五种类型 */
export const HP_CHANGE_KINDS = [
  'damage',     // 受到伤害
  'lose',       // 失去体力
  'recover',    // 恢复体力
  'adjust',     // 体力值调整
  'convert',    // 体力值（被）转化
];

/**
 * 记录一次体力变化
 * @param {Game} game
 * @param {Player} player
 * @param {string} kind 见 HP_CHANGE_KINDS
 * @param {number} num  变化量（正数）
 * @param {number} [before] 变化前体力
 */
export function noteHpChange(game, player, kind, num, before) {
  if (!game || !player) return null;
  game.hpChangeLog = game.hpChangeLog || [];
  const beforeHp = before != null ? before : player.hp;
  const ev = {
    player,
    kind,
    num,
    before: beforeHp,
    after: player.hp,
    turn: game.turnCount,
    // 哪些属于「真正的体力得失」
    realLoss: kind === 'damage' || kind === 'lose',
    realGain: kind === 'recover',
  };
  game.hpChangeLog.push(ev);
  return ev;
}

/** 取本回合的体力变化记录 */
export function hpChangesThisTurn(game, player, kinds) {
  if (!game || !game.hpChangeLog) return [];
  return game.hpChangeLog.filter((e) => e.turn === game.turnCount
    && (!player || e.player === player)
    && (!kinds || kinds.includes(e.kind)));
}

/** 该角色本回合是否发生过体力变化 */
export function hasHpChangeThisTurn(game, player, kinds) {
  return hpChangesThisTurn(game, player, kinds).length > 0;
}

/* ============================================================
 * AA. 调整（本项目新增）
 * ============================================================
 * 需求方给定：「将当前数值向目标数值调整」，分两种——
 *   ① **手牌数量调整**：视为摸牌 / 弃牌；
 *   ② **体力值调整**：**不视为**恢复体力、失去体力、受到伤害。
 *   当前数值与目标数值相同时，**可以触发**「调整」机制，
 *   但此时**无事发生**（不摸不弃、不加不减）。
 */

/**
 * 手牌数量调整（视为摸牌/弃牌）
 * @param {Player} player
 * @param {number} target 目标手牌数
 * @returns {Promise<{drawn:number, discarded:number, changed:boolean}>}
 */
export async function adjustHandCount(player, target) {
  const g = player && player.game;
  const cur = player.countCards('h');
  const diff = target - cur;
  if (!g) return { drawn: 0, discarded: 0, changed: false };
  if (diff === 0) {
    g.log(`【调整】${player.name} 的手牌数已经是 ${target}，无事发生`);
    return { drawn: 0, discarded: 0, changed: false };
  }
  if (diff > 0) {
    await player.draw(diff);
    g.log(`【调整】${player.name} 将手牌数调整到 ${target}（视为摸 ${diff} 张）`);
    return { drawn: diff, discarded: 0, changed: true };
  }
  const n = -diff;
  await player.discardCards(n, 'h', `【调整】将手牌数调整到 ${target}`);
  g.log(`【调整】${player.name} 将手牌数调整到 ${target}（视为弃 ${n} 张）`);
  return { drawn: 0, discarded: n, changed: true };
}

/**
 * 体力值调整
 * ------------------------------------------------------------------
 * ⚠️ 按需求方要求：**不视为**恢复体力、失去体力、受到伤害，
 *    因此这里直接改 hp，不走 recover/loseHp/damage，
 *    也不会触发濒死之外的那三类时机。
 *
 * 但若调整后 hp<=0，仍需进入濒死（否则角色会「无声死亡」）。
 */
export async function adjustHp(player, target) {
  if (!player || !player.alive) return { delta: 0, changed: false };
  const g = player.game;
  const cur = player.hp;
  const delta = target - cur;
  if (delta === 0) {
    if (g) g.log(`【调整】${player.name} 的体力值已经是 ${target}，无事发生`);
    return { delta: 0, changed: false };
  }
  player.hp = target;
  if (g) {
    g.log(`【调整】${player.name} 的体力值被调整为 ${target}`
      + `（${cur} → ${target}，不视为回复/失去/伤害）`);
    // 【体力变化】记录为 adjust（不算真正的得失）
    noteHpChange(g, player, 'adjust', Math.abs(delta), cur);
    g.emit();
  }
  if (player.hp <= 0 && g) await g.enterDying(player);
  return { delta, changed: true };
}

/**
 * 体力值（被）转化
 * ------------------------------------------------------------------
 * 例：与另一名角色交换体力值。同样**不视为**恢复/失去/伤害。
 */
export async function convertHp(playerA, playerB) {
  if (!playerA || !playerB) return false;
  const g = playerA.game;
  const a = playerA.hp; const b = playerB.hp;
  const aBefore = a; const bBefore = b;
  playerA.hp = b;
  playerB.hp = a;
  if (g) {
    g.log(`【转化】${playerA.name} 与 ${playerB.name} 交换了体力值`
      + `（${aBefore} ↔ ${bBefore}）`);
    noteHpChange(g, playerA, 'convert', Math.abs(b - aBefore), aBefore);
    noteHpChange(g, playerB, 'convert', Math.abs(a - bBefore), bBefore);
    g.emit();
    if (playerA.hp <= 0) await g.enterDying(playerA);
    if (playerB.hp <= 0) await g.enterDying(playerB);
  }
  return true;
}

/**
 * 通用「调整」入口
 * @param {Player} player
 * @param {object} spec { hand?: number, hp?: number }
 */
export async function adjust(player, spec = {}) {
  const out = { hand: null, hp: null };
  if (spec.hand != null) out.hand = await adjustHandCount(player, spec.hand);
  if (spec.hp != null) out.hp = await adjustHp(player, spec.hp);
  return out;
}

/* ============================================================
 * AB. 跳过 xx 询问（官方机制的延伸）
 * ============================================================
 * 需求方给定三档：
 *   ① **牌的询问**：对其使用牌其不可响应，
 *      且其**不能在其他角色求桃时使用牌**；
 *   ② **技能的询问**：其**不能封锁触发类技能发动**；
 *   ③ **一切的询问**：包含前两者。
 *
 * 说明：这里的「询问」指游戏向该角色发起的响应/决策请求。
 * 被跳过 ≠ 不能行动，而是「不再询问他，按默认结果处理」。
 */

/** 三种跳过档位 */
export const SKIP_KINDS = {
  CARD: 'card',      // 牌的询问
  SKILL: 'skill',    // 技能的询问
  ALL: 'all',        // 一切的询问
};

/** 让某角色跳过某档位询问 */
export function skipInquiry(player, kind = SKIP_KINDS.ALL, opts = {}) {
  if (!player) return false;
  player.skipInquiry = player.skipInquiry || {};
  const until = opts.until != null ? opts.until : (player.game ? player.game.turnCount : 0);
  player.skipInquiry[kind] = until;
  if (player.game) {
    const label = kind === 'card' ? '牌的询问'
      : kind === 'skill' ? '技能的询问' : '一切的询问';
    player.game.log(`${player.name} 被跳过了${label}`);
    player.game.emit();
  }
  return true;
}

/** 恢复某档位询问 */
export function resumeInquiry(player, kind = SKIP_KINDS.ALL) {
  if (!player || !player.skipInquiry) return false;
  delete player.skipInquiry[kind];
  if (player.game) {
    player.game.log(`${player.name} 恢复了询问`);
    player.game.emit();
  }
  return true;
}

/**
 * 该角色此刻是否被跳过了某档位的询问
 * ------------------------------------------------------------------
 * 「一切的询问」会覆盖前两档。
 */
export function isInquirySkipped(player, kind = SKIP_KINDS.CARD) {
  if (!player || !player.skipInquiry) return false;
  const g = player.game;
  const turn = g ? g.turnCount : 0;
  const live = (k) => {
    const until = player.skipInquiry[k];
    return until != null && (until === true || until >= turn);
  };
  if (live(SKIP_KINDS.ALL)) return true;
  return live(kind);
}

/**
 * 【牌的询问】被跳过时的两个后果
 * ------------------------------------------------------------------
 * ① 对其使用牌，其**不可响应**
 * ② 其**不能在其他角色求桃时使用牌**
 */
export function cannotRespond(player) {
  return isInquirySkipped(player, SKIP_KINDS.CARD);
}

export function cannotUseCardWhenOthersDying(player) {
  return isInquirySkipped(player, SKIP_KINDS.CARD);
}

/**
 * 【技能的询问】被跳过时的后果：不能封锁触发类技能发动
 * ------------------------------------------------------------------
 * 用于「不能因此发动技能」类机制的闸门判定。
 */
export function cannotBlockTriggerSkill(player) {
  return isInquirySkipped(player, SKIP_KINDS.SKILL);
}

/* ============================================================
 * AC. 蓄谋（本项目新增）
 * ============================================================
 * 需求方给定：
 *   · 将被蓄谋的牌按顺序**扣置**于目标的判定区；
 *   · 目标的**准备阶段**时，按**后置入先使用**的顺序依次使用蓄谋牌；
 *   · 使用时遵循**同名牌仅能使用 1 次**的限制；
 *   · 若某牌不能使用，则**弃置所有剩余蓄谋牌**；
 *   · 蓄谋牌**不能被移动**，**只有自己可见内容**。
 *
 * 无名杀依据（`src/character/jsrg/card.js` 的 `xumou_jsrg`）：
 *   · 逐张询问「是否使用」，不使用 → **弃置判定区所有蓄谋牌**；
 *   · 用 `xumou_jsrg_temp` 记录**已用过的牌名**，
 *     `cardEnabled` 里 `if (storage.includes(get.name(card))) return false`
 *     —— 即**同名牌仅能使用 1 次**。
 *   与需求方描述一致。
 */

/** 蓄谋牌的区域名 */
export const XUMOU_ZONE = 'xumou';

/**
 * 将牌蓄谋到目标判定区
 * @param {Player} target 目标（牌扣置于其判定区）
 * @param {Card[]} cards 按顺序传入（**后置入的先使用**）
 * @param {Player} [source]
 * @returns {Promise<Card[]>}
 */
export function putXumou(target, cards, source) {
  const g = target && target.game;
  const list = normalizeList(cards).filter(Boolean);
  if (!g || !list.length) return [];

  target.xumou = target.xumou || [];
  for (const c of list) {
    // 从原区域摘掉
    for (const p of g.players) {
      const hi = p.hand.indexOf(c);
      if (hi >= 0) p.hand.splice(hi, 1);
      for (const slot of Object.keys(p.equips || {})) {
        if (p.equips[slot] === c) p.equips[slot] = null;
      }
    }
    c.zone = XUMOU_ZONE;
    c.xumouOwner = target.id;
    /*
     * 需求方裁定：蓄谋牌**只有自己可见内容**。
     * 因此这里不打 revealed 标记；可见性由 isXumouVisibleTo 单独判定。
     */
    target.xumou.push(c);
  }
  g.log(`${source ? source.name + ' ' : ''}将 ${list.length} 张牌蓄谋于 `
    + `${target.name} 的判定区`);
  g.emit();
  return list;
}

/** 取某角色的蓄谋牌（按置入顺序） */
export function xumouCardsOf(player) {
  return (player && player.xumou) ? player.xumou.slice() : [];
}

/**
 * 蓄谋牌对观者是否可见内容
 * ------------------------------------------------------------------
 * 需求方裁定：**只有自己可见内容**（其他角色只知道数量）。
 */
export function isXumouVisibleTo(viewer, owner) {
  return viewer === owner;
}

/** 清空某角色的蓄谋牌（进入弃牌堆） */
export function flushXumou(player, reason) {
  const g = player && player.game;
  if (!g) return [];
  const all = xumouCardsOf(player);
  if (!all.length) return [];
  player.xumou = [];
  for (const c of all) c.zone = 'discard';
  // ⚠️ 必须传数组（toDiscard 只收一个参数）
  g.toDiscard(all, { direct: true });
  g.log(`【蓄谋】${player.name} 的 ${all.length} 张蓄谋牌被弃置`
    + (reason ? `（${reason}）` : ''));
  g.emit();
  return all;
}

/**
 * 准备阶段：依次使用蓄谋牌
 * ------------------------------------------------------------------
 * 顺序：**后置入的先使用**（即从数组末尾往前）。
 * 同名牌仅能使用 1 次；某牌不能使用 → 弃置所有剩余蓄谋牌。
 *
 * @param {Game} game
 * @param {Player} player
 * @returns {Promise<{used:Card[], discarded:Card[]}>}
 */
export async function resolveXumou(game, player) {
  const all = xumouCardsOf(player);
  if (!all.length) return { used: [], discarded: [] };

  const used = [];
  const usedNames = new Set();
  // 后置入的先使用 → 倒序遍历
  const order = all.slice().reverse();

  game.log(`【蓄谋】${player.name} 的准备阶段，开始依次使用蓄谋牌`
    + `（共 ${order.length} 张）`);

  for (const card of order) {
    const name = card.name;

    // ① 同名牌仅能使用 1 次
    if (usedNames.has(name)) {
      game.log(`【蓄谋】${card.fullname || name} 本阶段已使用过同名牌，`
        + `不能再次使用，弃置所有剩余蓄谋牌`);
      const rest = flushXumou(player, '同名牌已使用过');
      return { used, discarded: rest.concat([]) };
    }

    // ② 询问是否使用（不能使用则弃置所有剩余）
    const usable = game.cardUsableNow(player, card);
    let willUse = usable;
    if (usable && player.isHuman && game.io && game.io.askSkill) {
      // 人类玩家：询问是否使用
      willUse = await game.io.chooseOption({
        prompt: `蓄谋：是否使用【${card.fullname || name}】？`
          + `若不使用，则判定区内所有蓄谋牌都将被置入弃牌堆。`,
        options: ['使用', '不使用'],
      }).then((r) => r !== '不使用').catch(() => true);
    }
    if (!willUse) {
      game.log(`【蓄谋】${card.fullname || name} 无法使用（或选择不使用），`
        + `弃置所有剩余蓄谋牌`);
      const rest = flushXumou(player, '有牌不能使用');
      return { used, discarded: rest };
    }

    // ③ 实际使用
    const idx = player.xumou.indexOf(card);
    if (idx >= 0) player.xumou.splice(idx, 1);
    card.zone = 'discard';
    usedNames.add(name);
    used.push(card);
    game.log(`【蓄谋】${player.name} 使用了蓄谋牌 ${card.fullname || name}`);
    const targets = await game.pickTargetsForVirtual(player, card).catch(() => []);
    await game.useCard(player, card, targets);
  }

  game.emit();
  return { used, discarded: [] };
}

/* ============================================================
 * AD. 隐匿（官方机制）
 * ============================================================
 * 无名杀依据（`library/element/player.js` 的 setCharacter）：
 *   if (info.hasHiddenSkill && !this.noclick) {
 *     this.hiddenSkills.addArray(skills);
 *     skills = [];
 *     this.name = "unknown";
 *     this.sex = "male";
 *     hidden = true;
 *     skills.add("g_hidden_ai");
 *   }
 * 以及 `library/skill.js` 的 `_showHiddenCharacter`：
 *   trigger: { player: ["changeHp", "phaseBeginStart", ...] }
 *   content: player.showCharacter(2)
 *
 * 需求方给定（两处修正）：
 *   · 性别为**「无」**（不是无名杀的 male），
 *     因此**不能触发**【雌雄双股剑】这类按性别的技能；
 *   · 技能**不要**真的移除，隐匿状态下仍可能发动某些技能，
 *     所以只记录到 hiddenSkills，不移出 skills。
 */

/** 该角色是否处于隐匿状态 */
export function isHidden(player) {
  return !!(player && player.hidden);
}

/**
 * 进入隐匿状态
 * ------------------------------------------------------------------
 * 隐藏：武将牌（名字）、体力值、体力上限、性别（视为「无」）。
 * 技能保留可发动，仅记录到 hiddenSkills。
 */
export function enterHidden(player) {
  if (!player || player.hidden) return false;
  player.hidden = true;
  player.hiddenSkills = (player.skills || []).slice();
  // 备份真实信息，供登场时恢复
  player.hiddenSnapshot = {
    charId: player.charId,
    name: player.name,
    sex: player.sex,
    hp: player.hp,
    maxHp: player.maxHp,
  };
  // 对外表现为「未知」
  player.name = '未知';
  player.sex = 'none';                  // 需求方裁定：性别为「无」
  player.charId = 'unknown';
  if (player.game) {
    player.game.log(`${player.name} 进入隐匿状态`
      + `（武将牌、体力值、体力上限、性别均不可见）`);
    player.game.emit();
  }
  return true;
}

/**
 * 登场（结束隐匿）
 * ------------------------------------------------------------------
 * 恢复武将牌、体力值、体力上限、性别，并触发「隐匿技」的效果。
 * @returns {Promise<boolean>}
 */
export async function exitHidden(player, opts = {}) {
  if (!player || !player.hidden) return false;
  const g = player.game;
  const snap = player.hiddenSnapshot;
  player.hidden = false;

  if (snap) {
    player.charId = snap.charId;
    player.name = snap.name;
    player.sex = snap.sex;
    player.maxHp = snap.maxHp;
    // 体力不高于上限
    player.hp = Math.min(snap.hp, snap.maxHp);
  }
  player.hiddenSnapshot = null;

  if (g) {
    g.log(`${player.name} 登场（解除隐匿），`
      + `武将牌/体力/性别恢复可见`);
    g.emit();
  }

  // 触发「隐匿技」的效果
  if (opts.fireSkill !== false && g) {
    await g.checkSkills('hiddenReveal', { player, hidden: true });
  }
  return true;
}

/**
 * 是否应因「受到伤害」而登场
 * ------------------------------------------------------------------
 * 需求方/无名杀规则：**受到伤害时防止那次伤害后登场**。
 * 返回 true 表示调用方应先防止该伤害，再让角色登场。
 */
export function shouldRevealOnDamage(player) {
  return isHidden(player);
}

/** 重新隐匿 */
export function reHidden(player) {
  if (!player) return false;
  player.hidden = false;
  player.hiddenSnapshot = null;
  return enterHidden(player);
}

/* ============================================================
 * AE. 韵律技（转换技的变种）
 * ============================================================
 * ⚠️ 核实说明：无名杀**没有「韵律技」**，只有「转换技」（`zhuanhuanji`）。
 *    转换技是**每次发动后自动切换选项**；
 *    需求方要求：韵律技的**选项变更条件变为达成「转韵」条件**，
 *    且该条件**由技能自己声明**（每个角色都不同）。
 *
 * 技能写法：
 *   {
 *     yunlv: {
 *       options: ['选项一', '选项二'],
 *       // 「转韵」条件：返回 true 时切换选项
 *       // 例：转韵：你使用红色锦囊牌
 *       zhuanYun: (ctx) => ctx.event?.card?.color === 'red'
 *         && ctx.event?.card?.type === 'trick',
 *     },
 *   }
 */

/** 取韵律技当前生效的选项下标 */
export function yunlvIndex(player, skill) {
  if (!player || !skill) return 0;
  const key = `yunlv_${skill.id}`;
  const n = (player.storage && player.storage[key]) | 0;
  const len = ((skill.yunlv && skill.yunlv.options) || []).length || 1;
  return ((n % len) + len) % len;
}

/** 取韵律技当前生效的选项 */
export function yunlvCurrent(player, skill) {
  const opts = (skill && skill.yunlv && skill.yunlv.options) || [];
  if (!opts.length) return null;
  return opts[yunlvIndex(player, skill)];
}

/** 切换韵律技的选项 */
export function changeYunlv(player, skill) {
  if (!player || !skill) return false;
  player.storage = player.storage || {};
  const key = `yunlv_${skill.id}`;
  const len = ((skill.yunlv && skill.yunlv.options) || []).length || 1;
  const next = (((player.storage[key] | 0) + 1) % len + len) % len;
  player.storage[key] = next;
  if (player.game) {
    player.game.log(`【韵律】${skill.name} 转换到「`
      + `${(skill.yunlv.options[next])}」`);
    player.game.emit();
  }
  return true;
}

/**
 * 检查「转韵」条件是否达成，达成则切换选项
 * ------------------------------------------------------------------
 * 由引擎在每个技能时机结算后调用（与昂扬技同一位置）。
 */
export function tryZhuanYun(game, player, event) {
  if (!game || !player) return false;
  let changed = false;
  for (const sid of player.skills || []) {
    const sk = game.skillsRef && game.skillsRef[sid];
    if (!sk || !sk.yunlv) continue;
    const fn = sk.yunlv.zhuanYun;
    if (typeof fn !== 'function') continue;
    let ok = false;
    try {
      ok = !!fn({ player, game, event, skill: sk });
    } catch { ok = false; }
    if (ok) {
      changeYunlv(player, sk);
      changed = true;
    }
  }
  return changed;
}

/* ============================================================
 * AF. 溢出体力（本项目新增）
 * ============================================================
 * 需求方给定：**恢复的溢出值变为等量护甲**。
 *   例：3/4 体力回复 3 点 → 4/4，溢出的 2 点变成 2 点护甲。
 *
 * 实现位置：`Player.recover()`（见 engine.js），
 * 判定条件为角色的 `hpOverflow` 标记。
 * 本处提供开关与计算工具。
 */

/** 授予 / 取消「溢出体力」机制 */
export function setHpOverflow(player, on = true) {
  if (!player) return false;
  player.hpOverflow = !!on;
  if (player.game) {
    player.game.log(`${player.name}${on ? '获得' : '失去'}了【溢出体力】`);
    player.game.emit();
  }
  return true;
}

export function hasHpOverflow(player) {
  return !!(player && player.hpOverflow);
}

/**
 * 计算一次回复会产生多少溢出
 * （纯函数，便于测试与 UI 预览）
 */
export function calcOverflow(hp, maxHp, recoverNum) {
  const healed = Math.max(0, Math.min(maxHp, hp + recoverNum) - hp);
  return Math.max(0, recoverNum - healed);
}

/* ------------------------------------------------------------ */

export default {
  isAngyangSkill,
  isAngyangUsed,
  markAngyangUsed,
  tryResetAngyang,
  BEISHUI,
  buildBeishuiOptions,
  resolveBeishuiChoice,
  busuan,
  resolveChengshi,
  excludeCards,
  retrieveExcluded,
  flushExcludedOnDeath,
  viewExcluded,
  // F 点燃
  igniteCards,
  extinguisCards,
  isIgnited,
  noteIgnitedDiscard,
  ignitedCardMods,
  // G 调离
  removeFromField,
  returnToField,
  isDetached,
  checkDetachAutoReturn,
  // H 额定回合/阶段
  isRatedTurn,
  isRatedPhase,
  hasRatedTurnStarted,
  markRatedTurnStarted,
  // I 附魔
  enchantCard,
  disenchantCard,
  cardEnchants,
  hasEnchant,
  applyEnchantMod,
  // J 分发
  planDistribution,
  distributeCards,
  // K 废除
  disableEquipSlots,
  enableEquipSlots,
  isSlotDisabled,
  // L 发现
  discover,
  // M 横置牌
  linkCards,
  unlinkCards,
  isLinkedCard,
  linkedHandCards,
  cascadeDiscardLinked,
  cascadeGainLinked,
  // N 即时牌
  isInstantCard,
  filterInstantCards,
  // O 连招技
  getLastUsedCard,
  checkCombo,
  // P 酩酊
  isDrunk,
  drunkStatus,
  // Q 明置
  revealCards,
  hideCards,
  clearRevealed,
  isRevealed,
  revealedCardsOf,
  visibleHandCards,
  invalidateRevealed,
  // R 命运回合
  hasDestinyTurn,
  setDestinyTurn,
  destinyTurnOrder,
  // S 否极技
  foujiAvailableOptions,
  foujiAllUsed,
  markFoujiUsed,
  resetFouji,
  useFouji,
  // T 契定技
  isQidingSkill,
  isQidingUsed,
  markQidingUsed,
  qidingLockedDesc,
  isQidingLocked,
  // U 熔铸
  meltCast,
  // V 仁区
  RENKU_LIMIT,
  renkuCards,
  addToRenku,
  removeFromRenku,
  gainFromRenku,
  // W 入幻 / 入魔
  enterHuan,
  exitHuan,
  enterMo,
  exitMo,
  altFormOf,
  hasAltForm,
  checkMoRoundEnd,
  markMoDamaged,
  resetMoRound,
  // X 施法
  shifaMarks,
  castShifa,
  canCastShifa,
  tickShifa,
  // Y 失救
  triggerFailedSave,
  // Z 体力变化
  HP_CHANGE_KINDS,
  noteHpChange,
  hpChangesThisTurn,
  hasHpChangeThisTurn,
  // AA 调整
  adjustHandCount,
  adjustHp,
  convertHp,
  adjust,
  // AB 跳过 xx 询问
  SKIP_KINDS,
  skipInquiry,
  resumeInquiry,
  isInquirySkipped,
  cannotRespond,
  cannotUseCardWhenOthersDying,
  cannotBlockTriggerSkill,
  // AC 蓄谋
  XUMOU_ZONE,
  putXumou,
  xumouCardsOf,
  isXumouVisibleTo,
  flushXumou,
  resolveXumou,
  // AD 隐匿
  isHidden,
  enterHidden,
  exitHidden,
  shouldRevealOnDamage,
  reHidden,
  // AE 韵律技
  yunlvIndex,
  yunlvCurrent,
  changeYunlv,
  tryZhuanYun,
  // AF 溢出体力
  setHpOverflow,
  hasHpOverflow,
  calcOverflow,
};