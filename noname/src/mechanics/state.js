/**
 * 扩展机制 · 昂扬技 / 背水 / 卜算 / 乘势
 * ----------------------------------------------------------------
 * 由 src/mechanics.js 拆分而来，段结构与原文件一一对应。
 * 本文件不 import 任何模块：所有依赖（game / player / CARDS / SKILLS）
 * 都由调用方以参数传入。
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

