/**
 * 技能辅助：qianxing
 * 技能实现中复用的自由函数
 * 由 tools/split_skills.cjs 从旧 skills.js 切出。
 */

/** 取某角色【木牛流马】下的牌 */
export function muniuCards(player) {
  const eq = player.equips && player.equips.equip5;
  if (!eq || eq.name !== 'muniu' || !eq.storage) return [];
  return eq.storage.cards || [];
}

/**
 * 「昂扬：连招（周始 + 周始）」的一次周始效果
 * ------------------------------------------------------------------
 * 按需求方给定，本技能的周始效果就是**再触发一次周始**，
 * 连招意味着连续触发两次。
 * 这里实现为一次「激昂」结算：摸一张牌并重置昂扬技。
 */
export async function runZhouShiEffect(player, game) {
  if (!player || !player.alive) return;
  game.log(`【周始】${player.name} 结算一次周始效果`);
  await player.draw(1);
  game.emit();
}

/**
 * 「前行的决心」的登场结算
 * ==================================================================
 * 需求方给定：你登场时，**于同一结算内**使用 [0, 你手牌数] 张牌堆顶的牌。
 *
 * 精确定义（已与需求方逐条确认，用一个例子固定下来）：
 *   假设牌堆顶依次是【杀】【杀】【无中生有】。
 *
 *   ① **窗口 = 牌堆顶 X 张**，X = **当前手牌数**（会随结算变化）。
 *      登场手牌 1 张 → 窗口只看到牌堆顶 1 张（无中生有）。
 *
 *   ② 用掉一张后，那个**位置就空了（"空气"）**，
 *      **不会从第 X+1 张补位进来**。
 *      上例：用掉无中生有 → 手牌变 3 → 窗口扩大为看牌堆顶 3 张，
 *      但第 3 位（无中生有）已用掉 → 实际是「空气、杀、杀」，
 *      所以还能用那 **2 张【杀】**。
 *
 *   ③ 因此**永远不会因为用掉一张而去翻更后面的牌**。
 *
 *   ④ 不能用的牌**按原顺序放回牌堆顶**。
 *
 *   ⑤ 整个「前行」是一段**不可打断的结算块**：
 *      期间的血量照常扣，但**濒死结算排队**，等块走完才依次处理。
 *      这也是为了配合【怯懦的琴键】——「仄」的封锁集合在块内**累积**。
 */
export async function resolveQianxing(player, game) {
  const firstLimit = player.countCards('h');
  game.log(`【前行的决心】${player.name} 登场，`
    + `进入「同一结算」，窗口为牌堆顶 ${firstLimit} 张`);

  game.beginSameResolution('前行的决心');

  /*
   * 窗口模型
   * ----------------------------------------------------------------
   * slots 是按「牌堆顶顺序」排列的数组，长度 = 窗口宽度。
   *   slots[i] = 该位置上的牌；用掉后置为 null（"空气"），
   *   **不再补位**——这正是需求方强调的「不会去翻第 X+1 张」。
   *
   * 窗口宽度会随手牌数增长而变宽：变宽时，只把**新覆盖到的位置**
   * 从牌堆取出填入（这些位置此前不在窗口内，属于"新看到"的牌）。
   */
  const slots = [];        // 窗口内每个位置的牌（null = 已用掉/空）
  const taken = [];        // 从牌堆取出、归本技能管理的牌（用于归还）
  const used = [];
  let width = 0;           // 当前窗口宽度
  let guard = 0;

  /** 确保窗口宽度至少为 w（只扩不缩），并把新覆盖的位置填上牌 */
  const ensureWidth = (w) => {
    while (slots.length < w) {
      slots.push(undefined);        // undefined = 尚未看过该位置
    }
    while (width < w) {
      const idx = width;
      // 该位置若是「已用掉」的（null）就不取牌
      if (slots[idx] === null) { width++; continue; }
      if (slots[idx] !== undefined) { width++; continue; }
      /*
       * ⚠️ 第二个参数 true = 牌堆空时**不要自动洗牌**。
       * 否则牌堆见底时会 reshuffle 弃牌堆，把刚刚用掉的牌又翻回来，
       * 导致同一张牌被反复使用（实测【无中生有】被用了 3 次）。
       * 这也符合「不会去翻更后面的牌」的语义。
       */
      const more = game.takeFromDeckTop(1, true);
      if (!more.length) {
        // 牌堆真的见底了 → 该位置视为"空"，不再填充
        slots[idx] = null;
        width++;
        continue;
      }
      slots[idx] = more[0];
      width++;
    }
  };

  try {
    while (guard++ < 80) {
      // X = 当前手牌数（窗口中已用掉的位置不计入可用张数）
      const limit = player.countCards('h');
      if (used.length >= limit) break;

      // 窗口随上限变宽（只扩不缩；用掉的位置不会补位）
      ensureWidth(limit);

      // 从窗口里找下一个「还没用过、且位置有效」的牌
      let picked = null;
      for (let i = 0; i < slots.length; i++) {
        const c = slots[i];
        if (c === null || c === undefined) continue;   // 空气 / 未覆盖
        if (picked === null) { picked = { i, c }; break; }
      }
      if (!picked) break;      // 窗口内已无可用的牌

      const { i, c: card } = picked;

      /*
       * 不能用（或选择不用）的牌
       * 需求方给定：**不能用或者没有用的牌最后按照原顺序放回牌堆顶**。
       * 因此这里不消耗它，直接结束循环（它仍在 slots 里，最后归还）。
       */
      const usable = game.cardUsableNow(player, card);
      let want = usable;
      if (usable && player.isHuman) {
        want = await game.io.chooseOption({
          prompt: `【前行的决心】：牌堆顶第 ${i + 1} 张【`
            + `${card.fullname || card.name}】，是否使用？`
            + `（已用 ${used.length} / 上限 ${limit}）`,
          options: ['使用', '不用'],
        }).then((r) => r !== '不用' && r !== 'no').catch(() => true);
      }

      if (!want || !usable) {
        game.log(`【前行的决心】${card.fullname || card.name}`
          + `${usable ? '（选择不用）' : '（无法使用）'}，`
          + `将按原顺序放回牌堆顶`);
        break;
      }

      // 真正使用：该位置置空（不再补位）
      slots[i] = null;
      game.log(`【前行的决心】${player.name} 使用牌堆顶第 ${i + 1} 张 `
        + `${card.fullname || card.name}（该位置留空，不补位）`);
      const targets = await game.pickTargetsForVirtual(player, card)
        .catch(() => []);
      await game.useCard(player, card, targets);
      used.push(card);
      game.emit();
    }
  } finally {
    /*
     * 未使用的牌**按原顺序**放回牌堆顶
     * ----------------------------------------------------------------
     * 只归还仍留在窗口里、且尚未用掉的牌；
     * 顺序 = 它们在牌堆顶的原始先后顺序。
     */
    const toReturn = slots.filter((c) => c && c !== null)
      .filter((c) => !used.includes(c));
    if (toReturn.length) {
      game.putOnDeckTop(toReturn);
      game.log(`【前行的决心】${toReturn.length} 张未使用的牌`
        + `按原顺序放回牌堆顶`);
    }

    // 结束「同一结算」块 → 依次处理积压的濒死等
    await game.endSameResolution();
  }

  game.log(`【前行的决心】${player.name} 于同一结算内实际使用了 `
    + `${used.length} 张牌`);
  game.emit();
  return used;
}

/**
 * 「已受伤时，每个花色首次使用后你从牌堆底摸一张牌」
 * ==================================================================
 * ⚠️ 需求方重要指正：
 *   这个效果**只在「前行的决心」的那个「同一结算」用牌中生效**，
 *   **不应该出现在平常的用牌之中**。
 *
 * 因此这里**必须**先检查当前是否处于「前行的决心」的结算块内
 *（game._blockLabel === '前行的决心'），否则直接返回。
 *
 * 供引擎在「使用牌后」调用。
 */
export async function noteSuitUsed(player, card, game) {
  if (!player || !card || !game) return false;
  if (!player.hasSkill('qianxingdejuexin')) return false;
  /*
   * 闸门：必须处于【前行的决心】的「同一结算」块内。
   * 平常出牌时 _deferDepth 为 0 / _blockLabel 不是本技能 → 不生效。
   */
  if (!game._deferDepth || game._blockLabel !== '前行的决心') return false;
  // 必须「已受伤」
  if (player.hp >= player.maxHp) return false;
  player.storage = player.storage || {};
  /*
   * 「首次」按**每次「前行的决心」结算块**分别计算
   * ----------------------------------------------------------------
   * 需求方确认：每次结算块内各算一次。
   * 因此这里用「本次块的标识」来判断——若记录的块号不是当前块，
   * 就清空重来。
   */
  const blockId = game._blockSeq || 0;
  if (player.storage.qianxing_suitBlock !== blockId) {
    player.storage.qianxing_suitBlock = blockId;
    player.storage.qianxing_suits = [];
  }
  const key = 'qianxing_suits';
  const used = player.storage[key] || [];
  if (used.includes(card.suit)) return false;
  used.push(card.suit);
  player.storage[key] = used;

  // 从牌堆底摸一张
  const bottom = game.takeFromDeckBottom(1);
  if (bottom.length) {
    await player.gain(bottom);
    game.log(`【前行的决心】${player.name} 首次使用 ${card.suitLabel} 花色的牌，`
      + `从牌堆底摸一张牌`);
  }
  game.emit();
  return true;
}
