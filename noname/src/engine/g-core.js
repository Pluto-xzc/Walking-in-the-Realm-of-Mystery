/**
 * 核心引擎 · Game 方法集 · 区域与牌堆
 * ------------------------------------------------------------------
 * 由 src/engine.js 拆分而来。牌的进出区域、中央区 / 弃牌堆、牌堆顶底操作、日志与刷新。
 * 本文件导出普通对象字面量，方法会被混入 Game.prototype，内部 this 即 Game 实例。
 */

import { DECK_LIST } from '../cards.js';
import { noteIgnitedDiscard, isIgnited, addToRenku, renkuCards, noteHpChange, isHidden, enterHidden, cannotRespond } from '../mechanics.js';
import { ZONE } from './zones.js';
import { Card } from './card.js';
import { Player } from './player.js';

export default {
getRenku() { return renkuCards(this); },

async toRenku(cards) { return addToRenku(this, cards); },

noteHpChange(player, kind, num, before) {
  return noteHpChange(this, player, kind, num, before);
},

cannotRespond(player) { return cannotRespond(player); },

isHidden(player) { return isHidden(player); },

beginSameResolution(label = '') {
  this._deferDepth = (this._deferDepth || 0) + 1;
  if (this._deferDepth === 1) {
    this._deferred = [];
    this._blockSuits = [];
    this._blockLabel = label;
    // 块序号：供「每次块内各算一次」这类计数使用
    this._blockSeq = (this._blockSeq || 0) + 1;
    this.log(`—— 「同一结算」开始${label ? `（${label}）` : ''} ——`);
  }
  return this._deferDepth;
},

async endSameResolution() {
  this._deferDepth = Math.max(0, (this._deferDepth || 0) - 1);
  if (this._deferDepth > 0) return 0;

  const pending = this._deferred || [];
  this._deferred = [];
  const label = this._blockLabel;
  this._blockLabel = null;
  this.log(`—— 「同一结算」结束${label ? `（${label}）` : ''}，`
    + `开始处理 ${pending.length} 项积压结算 ——`);

  // 依次处理积压的濒死
  for (const item of pending) {
    if (item.kind !== 'dying') continue;
    if (this.over) break;
    if (!item.player || !item.player.alive) continue;
    if (item.player.hp > 0) continue;    // 期间已被救回
    await this.enterDying(item.player, item.source);
  }
  this._blockSuits = null;
  this.emit();
  return pending.length;
},

isSuitSeenInBlock(suit) {
  if (!suit || !this._blockSuits) return false;
  return this._blockSuits.includes(suit);
},

noteBlockSuit(suit) {
  if (!suit) return;
  this._blockSuits = this._blockSuits || [];
  if (!this._blockSuits.includes(suit)) this._blockSuits.push(suit);
},

toCenter(cards) {
  for (const c of this._asCardList(cards)) {
    if (!c) continue;
    c.zone = 'center';
    if (!this.centerZone.includes(c)) this.centerZone.push(c);
    // 中央区的牌同时算作弃牌堆的一部分
    if (!this.discardPile.includes(c)) this.discardPile.push(c);
  }
  this.emit();
},

toDiscard(cards, ...rest) {
  // 末位若是选项对象，则取出（支持 toDiscard(cards, {direct:true})）
  let opts = {};
  if (rest.length && rest[rest.length - 1] && typeof rest[rest.length - 1] === 'object'
    && rest[rest.length - 1].name === undefined) {
    opts = rest.pop();
  }
  const input = rest.length
    ? [].concat(cards || [], rest)
    : cards;
  const list = this._asCardList(input).filter(Boolean);
  for (const c of list) {
    c.zone = 'discard';
    if (!this.discardPile.includes(c)) this.discardPile.push(c);
    // 若仍在当前回合内，同时保留在中央区直到回合结束
    // （direct 的牌跳过这一步：它们没被「使用」，不属于处理区）
    if (!opts.direct && this._inCurrentTurn && !this.centerZone.includes(c)) {
      this.centerZone.push(c);
    } else if (opts.direct) {
      // 双保险：万一之前已在中央区，也要摘掉
      const ci = this.centerZone.indexOf(c);
      if (ci >= 0) this.centerZone.splice(ci, 1);
    }
  }
  this.emit();

  /*
   * 【点燃】结算
   * ----------------------------------------------------------------
   * 每有两张「被点燃」的牌被弃置，其**原持有者**受到 1 点火焰伤害。
   * 这里用 fire-and-forget 的方式触发：弃牌入口是同步语义，
   * 不能阻塞；伤害结算走 doDamage 的异步流程。
   */
  if (list.some((c) => isIgnited(c))) {
    Promise.resolve().then(() => noteIgnitedDiscard(this, list)).catch(() => {});
  }
},

_asCardList(cards) {
  if (!cards) return [];
  if (Array.isArray(cards)) return cards;
  // 可能是单个 Card 实例
  if (typeof cards === 'object' && cards.name !== undefined) return [cards];
  return [];
},

getDiscardPile() {
  return this.discardPile.slice();
},

getCenterZone() {
  return this.centerZone.slice();
},

peekDiscardPile() {
  return this.discardPile.length
    ? this.discardPile[this.discardPile.length - 1] : null;
},

flushCenterZone() {
  for (const c of this.centerZone) {
    c.zone = 'discard';
  }
  this.centerZone = [];
  this.emit();
},

canSeeCard(card, viewer) {
  if (!card) return false;
  if (!viewer) return true;
  return card.isVisibleTo(viewer);
},

getVisibleCards(target, zone = 'he', viewer = null) {
  const all = target.getCards(zone);
  if (!viewer) return { visible: all, hidden: 0 };
  const visible = [];
  let hidden = 0;
  for (const c of all) {
    if (this.canSeeCard(c, viewer)) visible.push(c);
    else hidden++;
  }
  return { visible, hidden };
},

revealCards(cards, by = null) {
  for (const c of this._asCardList(cards)) {
    if (!c) continue;
    c.setRevealed(true, by || c.owner);
  }
  this.emit();
},

hideCards(cards) {
  for (const c of this._asCardList(cards)) {
    if (!c) continue;
    c.setRevealed(false);
  }
  this.emit();
},

async showCards(cards, player, ms = 1500) {
  const list = this._asCardList(cards);
  this.showingCards = list.slice();
  this.showingBy = player || null;
  this.log(`${player ? player.name + ' ' : ''}展示了 ${list.map((c) => c.text).join('、')}`);
  this.emit();
  if (this.io && typeof this.io.sleep === 'function') await this.io.sleep(ms);
  this.showingCards = [];
  this.showingBy = null;
  this.emit();
},

getShowingCards() {
  return (this.showingCards || []).slice();
},

emit() { this.onUpdate(); },

log(text) {
  this.logs.push({ text, turn: this.turnCount });
  if (this.logs.length > 500) this.logs.shift();
  this.emit();
},

setup(playerChars, io, ai) {
  this.io = io;
  this.ai = ai;
  this.players = playerChars.map((c, i) => {
    const p = new Player(c.charId, i, c.isHuman);
    p.game = this;
    return p;
  });
  this.buildDeck();

  /*
   * 【隐匿技】游戏开始时进入隐匿
   * ----------------------------------------------------------------
   * 需求方给定：**游戏开始时，有隐匿技的角色隐匿**。
   * 登场时点有二：① 他们自己的回合开始时；② 即将受到伤害时。
   * （② 在 doDamage 里处理，① 在 runTurn 里处理）
   */
  for (const p of this.players) {
    if (p.hasHiddenSkill) enterHidden(p);
  }

  this.emit();
},

buildDeck() {
  this.deck = DECK_LIST.map(([suit, num, name]) => new Card(suit, num, name));
  this.shuffle(this.deck);
  this.discardPile = [];
},

shuffle(arr) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
},

randomPick(arr) { return arr[Math.floor(Math.random() * arr.length)]; },

takeFromDeckTop(n, noReshuffle) {
  const out = [];
  for (let i = 0; i < n; i++) {
    if (!this.deck.length && !noReshuffle) this.reshuffle();
    if (!this.deck.length) break;
    const c = this.deck.pop();
    c.zone = ZONE.FLYING;
    out.push(c);
  }
  return out;
},

takeFromDeckBottom(n, noReshuffle) {
  const out = [];
  for (let i = 0; i < n; i++) {
    if (!this.deck.length && !noReshuffle) this.reshuffle();
    if (!this.deck.length) break;
    const c = this.deck.shift();
    c.zone = ZONE.FLYING;
    out.push(c);
  }
  return out;
},

putOnDeckTop(cards) { this.deck.push(...cards.slice().reverse()); },

putOnDeckBottom(cards) { this.deck.unshift(...cards.slice().reverse()); },

getUseHistory(player, filter) {
  return this.useEvents.filter((e) => e.kind === 'use'
    && (!player || e.player === player)
    && (!filter || filter(e)));
},

getRespondHistory(player, filter) {
  return this.useEvents.filter((e) => e.kind === 'respond'
    && (!player || e.player === player)
    && (!filter || filter(e)));
},

reshuffle() {
  if (!this.discardPile.length) return;
  this.log('牌堆已重洗');
  this.deck = this.discardPile.slice();
  this.discardPile = [];
  this.shuffle(this.deck);
},

async playerGain(player, cards, from) {
  for (const c of cards) {
    if (!c) continue;
    // 被原持有者以外的角色获得 → 失去明置状态
    // （虚拟牌没有该方法，需判空）
    if (typeof c.checkRevealLost === 'function') c.checkRevealLost(player);
    // 从原区域移除（避免同一张牌同时存在于多处）
    for (const p of this.players) {
      const hi = p.hand.indexOf(c);
      if (hi >= 0) p.hand.splice(hi, 1);
      const ji = p.judges.indexOf(c);
      if (ji >= 0) p.judges.splice(ji, 1);
      for (const k of Object.keys(p.equips)) {
        if (p.equips[k] === c) p.equips[k] = null;
      }
    }
    this._removeFromPiles(c);
    c.zone = 'hand';
    c.owner = player;
    player.hand.push(c);
  }
  this.emit();
}
};
