/**
 * 卡牌数据（标准包）
 * ------------------------------------------------------------------
 * 牌堆格式参考无名杀： [花色, 点数, 牌名]
 *   花色：spade 黑桃 / heart 红桃 / club 梅花 / diamond 方块
 *   点数：1..13（1=A, 11=J, 12=Q, 13=K）
 *
 * 牌的定义拆成「纯数据」与「行为」两部分：
 *   - 纯数据放本文件，可序列化
 *   - 行为（content / filterTarget 等）放 rules.js，按 name 注册
 */

/** 花色 */
export const SUITS = {
  spade: { key: 'spade', label: '♠', name: '黑桃', color: 'black' },
  heart: { key: 'heart', label: '♥', name: '红桃', color: 'red' },
  club: { key: 'club', label: '♣', name: '梅花', color: 'black' },
  diamond: { key: 'diamond', label: '♦', name: '方片', color: 'red' },
};

/** 点数转显示文本 */
export function numberLabel(n) {
  return ({ 1: 'A', 11: 'J', 12: 'Q', 13: 'K' })[n] || String(n);
}

/**
 * 卡牌定义
 * type: basic 基本牌 / trick 锦囊牌 / equip 装备牌
 * subtype(装备): equip1 武器 / equip2 防具 / equip3 防御马 / equip4 进攻马
 */
/* ==========================================================================
 * 装备槽位定义
 * --------------------------------------------------------------------------
 * 这是装备区的唯一权威定义，引擎与界面都从这里取。
 *
 * key     : equips 对象里的键名
 * label   : 显示名
 * short   : 界面格子里的短标签
 * order   : 界面排列顺序（武器 → 防具 → 宝物 → 进攻马 → 防御马）
 *
 * 说明：标准包只有 武器/防具/进攻马/防御马 四类，
 * 宝物槽位（equip5）为后续扩展预留，标准包内不会有牌使用它。
 * 未来做「废除装备区」时，只需给对应槽位打标记即可。
 * ========================================================================== */
export const EQUIP_SLOTS = [
  { key: 'equip1', label: '武器', short: '武', order: 1, range: true },
  { key: 'equip2', label: '防具', short: '防', order: 2, range: false },
  { key: 'equip5', label: '宝物', short: '宝', order: 3, range: false },
  { key: 'equip4', label: '进攻马', short: '进', order: 4, range: false },
  { key: 'equip3', label: '防御马', short: '防', order: 5, range: false },
];

/** 槽位 key → 定义 */
export const EQUIP_SLOT_MAP = Object.fromEntries(
  EQUIP_SLOTS.map((s) => [s.key, s]),
);

/** 新建一个空的装备区对象 */
export function makeEmptyEquips() {
  const e = {};
  for (const s of EQUIP_SLOTS) e[s.key] = null;
  return e;
}

/* ==========================================================================
 * 卡牌定义
 * ========================================================================== */
export const CARDS = {
  /* ============================ 基本牌 ============================ */
  sha: {
    name: 'sha',
    type: 'basic',
    subtype: 'attack',
    label: '杀',
    fullname: '杀',
    // 使用目标数
    selectTarget: 1,
    // 攻击范围限制：目标须在自己攻击范围内
    useRange: true,
    // 每回合出牌阶段限用一次
    usable: 1,
    // 目标不能是自己
    notSelf: true,
    desc: '出牌阶段，对攻击范围内的一名其他角色使用。其需打出一张【闪】，否则受到你造成的 1 点伤害。每回合限用一次。',
    tip: '对攻击范围内一名角色造成 1 点伤害',
  },
  shan: {
    name: 'shan',
    type: 'basic',
    subtype: 'respond',
    label: '闪',
    fullname: '闪',
    // 不能主动使用，只能响应
    respondOnly: true,
    desc: '当你成为【杀】的目标时，你可以打出一张【闪】来抵消。',
    tip: '抵消一次【杀】',
  },
  tao: {
    name: 'tao',
    type: 'basic',
    subtype: 'heal',
    label: '桃',
    fullname: '桃',
    selectTarget: 1,
    // 只能对自己使用（濒死时除外）
    selfOnly: true,
    desc: '出牌阶段，对自己使用，回复 1 点体力。当有角色处于濒死状态时，你可以对其使用。',
    tip: '回复 1 点体力',
  },

  /* ============================ 锦囊牌 ============================ */
  juedou: {
    name: 'juedou',
    type: 'trick',
    label: '决斗',
    fullname: '决斗',
    selectTarget: 1,
    notSelf: true,
    desc: '出牌阶段，对一名其他角色使用。由其开始，你与其轮流打出一张【杀】，首先不出【杀】的一方受到另一方造成的 1 点伤害。',
    tip: '与目标轮流打出【杀】',
  },
  guohe: {
    name: 'guohe',
    type: 'trick',
    label: '过河',
    fullname: '过河拆桥',
    selectTarget: 1,
    notSelf: true,
    // 目标须有牌
    targetHasCard: true,
    desc: '出牌阶段，对一名区域内有牌的其他角色使用。你弃置其区域内的一张牌。',
    tip: '弃置目标的一张牌',
  },
  shunshou: {
    name: 'shunshou',
    type: 'trick',
    label: '顺手',
    fullname: '顺手牵羊',
    selectTarget: 1,
    notSelf: true,
    targetHasCard: true,
    // 距离限制为 1
    distanceLimit: 1,
    desc: '出牌阶段，对距离 1 以内、区域内有牌的一名其他角色使用。你获得其区域内的一张牌。',
    tip: '获得目标的一张牌',
  },
  wuzhong: {
    name: 'wuzhong',
    type: 'trick',
    label: '无中',
    fullname: '无中生有',
    selectTarget: 0,
    selfOnly: true,
    desc: '出牌阶段，对自己使用。你摸两张牌。',
    tip: '摸两张牌',
  },
  wugu: {
    name: 'wugu',
    type: 'trick',
    label: '五谷',
    fullname: '五谷丰登',
    selectTarget: -1,
    // 对全场所有角色（含自己）
    allPlayers: true,
    desc: '出牌阶段，对所有角色使用。每名目标角色各亮出一张牌，然后各获得一张。',
    tip: '全场每名角色各获得一张牌',
  },
  taoyuan: {
    name: 'taoyuan',
    type: 'trick',
    label: '桃园',
    fullname: '桃园结义',
    selectTarget: -1,
    allPlayers: true,
    desc: '出牌阶段，对所有角色使用。每名目标角色回复 1 点体力。',
    tip: '全场每名角色回复 1 点体力',
  },
  nanman: {
    name: 'nanman',
    type: 'trick',
    label: '南蛮',
    fullname: '南蛮入侵',
    selectTarget: -1,
    allOtherPlayers: true,
    desc: '出牌阶段，对所有其他角色使用。每名目标角色需打出一张【杀】，否则受到你造成的 1 点伤害。',
    tip: '全场其他角色不出【杀】则受伤',
  },
  wanjian: {
    name: 'wanjian',
    type: 'trick',
    label: '万箭',
    fullname: '万箭齐发',
    selectTarget: -1,
    allOtherPlayers: true,
    desc: '出牌阶段，对所有其他角色使用。每名目标角色需打出一张【闪】，否则受到你造成的 1 点伤害。',
    tip: '全场其他角色不出【闪】则受伤',
  },
  wuxie: {
    name: 'wuxie',
    type: 'trick',
    label: '无懈',
    fullname: '无懈可击',
    selectTarget: 0,
    // 只能响应锦囊
    respondOnly: true,
    desc: '当一张锦囊牌对一名角色生效前，你可以使用此牌抵消之。',
    tip: '抵消一张锦囊牌的效果',
  },
  jiedao: {
    name: 'jiedao',
    type: 'trick',
    label: '借刀',
    fullname: '借刀杀人',
    selectTarget: 2,
    // 第一目标须有武器
    requireWeapon: true,
    desc: '出牌阶段，对一名装备区里有武器牌的其他角色使用，并选择其攻击范围内的一名角色。该角色需对其使用一张【杀】，否则将武器牌交给你。',
    tip: '令持武器者对他人出【杀】',
  },
  lebu: {
    name: 'lebu',
    type: 'trick',
    label: '乐不',
    fullname: '乐不思蜀',
    selectTarget: 1,
    notSelf: true,
    // 延时锦囊
    delayed: true,
    judgeToAvoid: { suit: 'heart' },
    desc: '出牌阶段，对一名其他角色使用。将其置于其判定区。判定阶段判定：若结果不为红桃，跳过其出牌阶段。',
    tip: '判定非红桃则跳过其出牌阶段',
  },
  shandian: {
    name: 'shandian',
    type: 'trick',
    label: '闪电',
    fullname: '闪电',
    selectTarget: 0,
    selfOnly: true,
    delayed: true,
    // 判定为黑桃 2~9 则生效
    judgeToTrigger: { suit: 'spade', min: 2, max: 9 },
    desc: '出牌阶段，对自己使用。将其置于自己判定区。判定阶段判定：若结果为黑桃 2~9，则受到 3 点雷电伤害，否则将其移动到下家判定区。',
    tip: '判定黑桃 2~9 则受 3 点雷电伤害',
  },

  /* ============================ 装备牌 ============================ */
  zhuge: {
    name: 'zhuge',
    type: 'equip',
    subtype: 'equip1',
    label: '诸葛',
    fullname: '诸葛连弩',
    attackRange: 1,
    equipSkill: 'zhuge_skill',
    desc: '攻击范围 1。出牌阶段，你可以使用任意数量的【杀】。',
    tip: '攻击范围 1，【杀】无次数限制',
  },
  qinggang: {
    name: 'qinggang',
    type: 'equip',
    subtype: 'equip1',
    label: '青釭',
    fullname: '青釭剑',
    attackRange: 2,
    equipSkill: 'qinggang_skill',
    desc: '攻击范围 2。你的【杀】无视目标防具。',
    tip: '攻击范围 2，无视防具',
  },
  cixiong: {
    name: 'cixiong',
    type: 'equip',
    subtype: 'equip1',
    label: '雌雄',
    fullname: '雌雄双股剑',
    attackRange: 2,
    equipSkill: 'cixiong_skill',
    desc: '攻击范围 2。你使用【杀】指定异性目标后，可令其选择：弃置一张手牌，或令你摸一张牌。',
    tip: '攻击范围 2，对异性目标有额外效果',
  },
  qinglong: {
    name: 'qinglong',
    type: 'equip',
    subtype: 'equip1',
    label: '青龙',
    fullname: '青龙偃月刀',
    attackRange: 3,
    equipSkill: 'qinglong_skill',
    desc: '攻击范围 3。你使用的【杀】被【闪】抵消时，你可以对目标再使用一张【杀】。',
    tip: '攻击范围 3，【杀】被闪后可再杀',
  },
  zhangba: {
    name: 'zhangba',
    type: 'equip',
    subtype: 'equip1',
    label: '丈八',
    fullname: '丈八蛇矛',
    attackRange: 3,
    equipSkill: 'zhangba_skill',
    desc: '攻击范围 3。你可以将两张手牌当【杀】使用或打出。',
    tip: '攻击范围 3，两张手牌当【杀】',
  },
  guanshi: {
    name: 'guanshi',
    type: 'equip',
    subtype: 'equip1',
    label: '贯石',
    fullname: '贯石斧',
    attackRange: 3,
    equipSkill: 'guanshi_skill',
    desc: '攻击范围 3。你使用的【杀】被【闪】抵消时，你可以弃置两张牌，令此【杀】依然造成伤害。',
    tip: '攻击范围 3，可弃两张牌强命',
  },
  fangtian: {
    name: 'fangtian',
    type: 'equip',
    subtype: 'equip1',
    label: '方天',
    fullname: '方天画戟',
    attackRange: 4,
    equipSkill: 'fangtian_skill',
    desc: '攻击范围 4。你使用【杀】时若为最后一张手牌，可以额外指定两个目标。',
    tip: '攻击范围 4，最后手牌可多目标',
  },
  qilin: {
    name: 'qilin',
    type: 'equip',
    subtype: 'equip1',
    label: '麒麟',
    fullname: '麒麟弓',
    attackRange: 5,
    equipSkill: 'qilin_skill',
    desc: '攻击范围 5。你使用【杀】对目标造成伤害时，可以弃置其装备区里的一张坐骑牌。',
    tip: '攻击范围 5，可弃置目标坐骑',
  },
  bagua: {
    name: 'bagua',
    type: 'equip',
    subtype: 'equip2',
    label: '八卦',
    fullname: '八卦阵',
    equipSkill: 'bagua_skill',
    desc: '当你需要使用或打出【闪】时，你可以判定：若为红色，视为你使用或打出一张【闪】。',
    tip: '需要【闪】时可判定，红色则视为出闪',
  },
  renwang: {
    name: 'renwang',
    type: 'equip',
    subtype: 'equip2',
    label: '仁王',
    fullname: '仁王盾',
    equipSkill: 'renwang_skill',
    desc: '黑色的【杀】对你无效。',
    tip: '黑色【杀】对你无效',
  },
  tengjia: {
    name: 'tengjia',
    type: 'equip',
    subtype: 'equip2',
    label: '藤甲',
    fullname: '藤甲',
    equipSkill: 'tengjia_skill',
    desc: '【南蛮入侵】、【万箭齐发】和普通【杀】对你无效。你受到火焰伤害时，此伤害 +1。',
    tip: '免疫南蛮/万箭/普通杀，怕火焰',
  },
  jueying: {
    name: 'jueying',
    type: 'equip',
    subtype: 'equip3',
    label: '绝影',
    fullname: '绝影',
    // 防御马：其他人到你的距离 +1
    distanceTo: 1,
    desc: '其他角色计算与你的距离时 +1。',
    tip: '他人到你的距离 +1',
  },
  dilu: {
    name: 'dilu',
    type: 'equip',
    subtype: 'equip3',
    label: '的卢',
    fullname: '的卢',
    distanceTo: 1,
    desc: '其他角色计算与你的距离时 +1。',
    tip: '他人到你的距离 +1',
  },
  zhuahuang: {
    name: 'zhuahuang',
    type: 'equip',
    subtype: 'equip3',
    label: '爪黄',
    fullname: '爪黄飞电',
    distanceTo: 1,
    desc: '其他角色计算与你的距离时 +1。',
    tip: '他人到你的距离 +1',
  },
  dawan: {
    name: 'dawan',
    type: 'equip',
    subtype: 'equip3',
    label: '大宛',
    fullname: '大宛',
    distanceTo: 1,
    desc: '其他角色计算与你的距离时 +1。',
    tip: '他人到你的距离 +1',
  },
  zixin: {
    name: 'zixin',
    type: 'equip',
    subtype: 'equip3',
    label: '紫骍',
    fullname: '紫骍',
    distanceTo: 1,
    desc: '其他角色计算与你的距离时 +1。',
    tip: '他人到你的距离 +1',
  },
  chitu: {
    name: 'chitu',
    type: 'equip',
    subtype: 'equip4',
    label: '赤兔',
    fullname: '赤兔',
    // 进攻马：你到其他人的距离 -1
    distanceFrom: 1,
    desc: '你计算与其他角色的距离时 -1。',
    tip: '你到他人的距离 -1',
  },
  dayuan: {
    name: 'dayuan',
    type: 'equip',
    subtype: 'equip4',
    label: '大宛马',
    fullname: '大宛马',
    distanceFrom: 1,
    desc: '你计算与其他角色的距离时 -1。',
    tip: '你到他人的距离 -1',
  },
  zhuahuangfeidian: {
    name: 'zhuahuangfeidian',
    type: 'equip',
    subtype: 'equip4',
    label: '爪黄飞电',
    fullname: '爪黄飞电',
    distanceFrom: 1,
    desc: '你计算与其他角色的距离时 -1。',
    tip: '你到他人的距离 -1',
  },
  hanbing: {
    name: 'hanbing',
    type: 'equip',
    subtype: 'equip1',          // 武器（原误标为 equip2 防具）
    label: '寒冰',
    fullname: '寒冰剑',
    attackRange: 2,
    equipSkill: 'hanbing_skill',
    desc: '攻击范围 2。你使用【杀】造成伤害时，可以防止此伤害，改为弃置目标两张牌。',
    tip: '攻击范围 2，可改为弃置目标两张牌',
  },

  /* ==================================================================
   * 风林火山（神话再临）新增牌
   * ------------------------------------------------------------------
   * 规则与数值对齐无名杀 card/extra.js，代码为本项目独立实现。
   * 目前只加入游戏牌，武将留待后续。
   * ================================================================== */

  /* ---------------------------- 基本牌 ---------------------------- */
  jiu: {
    name: 'jiu',
    type: 'basic',
    subtype: 'buff',
    label: '酒',
    fullname: '酒',
    selfOnly: true,
    usable: 1,                  // 每回合限一次（非濒死时）
    desc: '出牌阶段，对自己使用，令你本回合使用的下一张【杀】伤害 +1，'
      + '每回合限一次。当你处于濒死状态时，对自己使用，回复 1 点体力。',
    tip: '本回合下一张【杀】伤害 +1；濒死时当【桃】用',
  },

  /* ---------------------------- 锦囊牌 ---------------------------- */
  huogong: {
    name: 'huogong',
    type: 'trick',
    label: '火攻',
    fullname: '火攻',
    nature: 'fire',
    selectTarget: 1,
    notSelf: true,
    desc: '出牌阶段，对一名有手牌的角色使用。其展示一张手牌，'
      + '然后你可以弃置一张与其展示牌花色相同的手牌，对其造成 1 点火焰伤害。',
    tip: '展示目标一张手牌，弃同花色牌造成火焰伤害',
  },
  tiesuo: {
    name: 'tiesuo',
    type: 'trick',
    label: '铁索',
    fullname: '铁索连环',
    // 可以指定 1~2 名角色（含自己）
    selectTarget: 2,
    targetMin: 1,
    targetMax: 2,
    canSelf: true,
    desc: '出牌阶段，横置或重置 1~2 名角色。'
      + '处于横置状态的角色受到属性伤害时，其他横置角色也受到同来源同属性同点数的伤害，然后重置。',
    tip: '横置/重置角色，连接属性伤害',
  },
  bingliang: {
    name: 'bingliang',
    type: 'trick',
    label: '兵粮',
    fullname: '兵粮寸断',
    delayed: true,
    selectTarget: 1,
    notSelf: true,
    distanceLimit: 1,
    desc: '出牌阶段，对距离 1 内的一名其他角色使用。'
      + '将其置于其判定区，判定阶段判定：若不为梅花，跳过其摸牌阶段。',
    tip: '判定非梅花则跳过摸牌阶段',
  },

  /* ---------------------------- 装备牌 ---------------------------- */
  zhuque: {
    name: 'zhuque',
    type: 'equip',
    subtype: 'equip1',
    label: '朱雀',
    fullname: '朱雀羽扇',
    attackRange: 4,
    equipSkill: 'zhuque_skill',
    desc: '攻击范围 4。你可以将一张普通【杀】当火【杀】使用或打出。',
    tip: '攻击范围 4，可将普通【杀】当火【杀】',
  },
  guding: {
    name: 'guding',
    type: 'equip',
    subtype: 'equip1',
    label: '古锭',
    fullname: '古锭刀',
    attackRange: 2,
    equipSkill: 'guding_skill',
    desc: '攻击范围 2。你使用【杀】造成伤害时，若目标没有手牌，此伤害 +1。',
    tip: '攻击范围 2，对无手牌目标伤害 +1',
  },
  baiyin: {
    name: 'baiyin',
    type: 'equip',
    subtype: 'equip2',
    label: '白银',
    fullname: '白银狮子',
    equipSkill: 'baiyin_skill',
    desc: '锁定技。当你受到伤害时，若此伤害大于 1，防止多余伤害。'
      + '当你失去装备区里的【白银狮子】时，回复 1 点体力。',
    tip: '伤害超过 1 时只受 1 点；失去时回复 1 点',
  },
  hualiu: {
    name: 'hualiu',
    type: 'equip',
    subtype: 'equip3',
    label: '骅骝',
    fullname: '骅骝',
    distanceTo: 1,
    desc: '其他角色计算与你的距离时 +1。',
    tip: '他人到你的距离 +1',
  },
  muniu: {
    name: 'muniu',
    type: 'equip',
    subtype: 'equip5',          // 宝物（第一个使用 equip5 槽位的牌）
    label: '木牛',
    fullname: '木牛流马',
    equipSkill: 'muniu_skill',
    desc: '出牌阶段限一次，你可以将一张手牌置于【木牛流马】下（称为「辎」）。'
      + '你可以将【木牛流马】下的牌如手牌般使用或打出。'
      + '当你失去装备区里的【木牛流马】时，将其下的牌置入弃牌堆。',
    tip: '可存放手牌，并像手牌一样使用其中的牌',
  },
};

/**
 * 牌堆（标准包 112 张，与无名杀标准包 list 一致）
 * 格式：[花色, 点数, 牌名]
 *
 * 注意：牌堆中存在「同花色同点数同牌名」的重复条目（如两张 ♠8 杀），
 * 这是标准包的正常设定，不是数据错误。
 */
export const DECK_LIST = [
  // 杀 x30
  ['spade', 7, 'sha'], ['spade', 8, 'sha'], ['spade', 8, 'sha'], ['spade', 9, 'sha'],
  ['spade', 9, 'sha'], ['spade', 10, 'sha'], ['spade', 10, 'sha'],
  ['club', 2, 'sha'], ['club', 3, 'sha'], ['club', 4, 'sha'], ['club', 5, 'sha'],
  ['club', 6, 'sha'], ['club', 7, 'sha'], ['club', 8, 'sha'], ['club', 8, 'sha'],
  ['club', 9, 'sha'], ['club', 9, 'sha'], ['club', 10, 'sha'], ['club', 10, 'sha'],
  ['club', 11, 'sha'], ['club', 11, 'sha'],
  ['heart', 10, 'sha'], ['heart', 10, 'sha'], ['heart', 11, 'sha'],
  ['diamond', 6, 'sha'], ['diamond', 7, 'sha'], ['diamond', 8, 'sha'],
  ['diamond', 9, 'sha'], ['diamond', 10, 'sha'], ['diamond', 13, 'sha'],

  // 闪 x15
  ['heart', 2, 'shan'], ['heart', 2, 'shan'], ['heart', 13, 'shan'],
  ['diamond', 2, 'shan'], ['diamond', 2, 'shan'], ['diamond', 3, 'shan'],
  ['diamond', 4, 'shan'], ['diamond', 5, 'shan'], ['diamond', 6, 'shan'],
  ['diamond', 7, 'shan'], ['diamond', 8, 'shan'], ['diamond', 9, 'shan'],
  ['diamond', 10, 'shan'], ['diamond', 11, 'shan'], ['diamond', 11, 'shan'],

  // 桃 x8
  ['heart', 3, 'tao'], ['heart', 4, 'tao'], ['heart', 6, 'tao'], ['heart', 7, 'tao'],
  ['heart', 8, 'tao'], ['heart', 9, 'tao'], ['heart', 12, 'tao'], ['diamond', 12, 'tao'],

  // 装备：防具
  ['spade', 2, 'bagua'], ['club', 2, 'bagua'],
  ['club', 2, 'renwang'],
  ['spade', 2, 'tengjia'], ['club', 2, 'tengjia'],

  // 装备：防御马
  ['spade', 5, 'jueying'], ['club', 5, 'dilu'],
  ['heart', 13, 'zhuahuang'], ['spade', 13, 'dawan'], ['diamond', 13, 'zixin'],

  // 装备：进攻马
  ['heart', 5, 'chitu'],
  ['diamond', 13, 'dayuan'], ['heart', 13, 'zhuahuangfeidian'],

  // 装备：武器
  ['club', 1, 'zhuge'], ['diamond', 1, 'zhuge'],
  ['spade', 6, 'qinggang'],
  ['spade', 5, 'qinglong'],
  ['spade', 12, 'zhangba'],
  ['diamond', 5, 'guanshi'],
  ['diamond', 12, 'fangtian'],
  ['heart', 5, 'qilin'],
  ['spade', 2, 'hanbing'],
  ['spade', 2, 'cixiong'], ['diamond', 2, 'cixiong'],

  // 锦囊
  ['heart', 3, 'wugu'], ['heart', 4, 'wugu'],
  ['heart', 1, 'taoyuan'],
  ['spade', 7, 'nanman'], ['spade', 13, 'nanman'], ['club', 7, 'nanman'],
  ['heart', 1, 'wanjian'],
  ['spade', 1, 'juedou'], ['club', 1, 'juedou'], ['diamond', 1, 'juedou'],
  ['heart', 7, 'wuzhong'], ['heart', 8, 'wuzhong'], ['heart', 9, 'wuzhong'], ['heart', 11, 'wuzhong'],
  ['spade', 3, 'shunshou'], ['spade', 4, 'shunshou'], ['spade', 11, 'shunshou'],
  ['diamond', 3, 'shunshou'], ['diamond', 4, 'shunshou'],
  ['spade', 3, 'guohe'], ['spade', 4, 'guohe'], ['spade', 12, 'guohe'],
  ['club', 3, 'guohe'], ['club', 4, 'guohe'], ['heart', 12, 'guohe'],
  ['club', 12, 'jiedao'], ['club', 13, 'jiedao'],
  ['spade', 11, 'wuxie'], ['club', 12, 'wuxie'], ['club', 13, 'wuxie'],
  ['spade', 6, 'lebu'], ['club', 6, 'lebu'], ['heart', 6, 'lebu'],
  ['spade', 1, 'shandian'], ['heart', 12, 'shandian'],

  /* ==================================================================
   * 风林火山（神话再临）牌堆
   * ------------------------------------------------------------------
   * 花色点数与无名杀 card/extra.js 完全一致（共 22 张）。
   * ================================================================== */

  // 基本牌：酒 ×5
  ['spade', 3, 'jiu'], ['spade', 9, 'jiu'],
  ['club', 3, 'jiu'], ['club', 9, 'jiu'],
  ['diamond', 9, 'jiu'],

  // 锦囊：火攻 ×3
  ['heart', 2, 'huogong'], ['heart', 3, 'huogong'], ['diamond', 12, 'huogong'],

  // 锦囊：铁索连环 ×6
  ['spade', 11, 'tiesuo'], ['spade', 12, 'tiesuo'],
  ['club', 10, 'tiesuo'], ['club', 11, 'tiesuo'],
  ['club', 12, 'tiesuo'], ['club', 13, 'tiesuo'],

  // 锦囊：兵粮寸断 ×2
  ['spade', 10, 'bingliang'], ['club', 4, 'bingliang'],

  // 装备：朱雀羽扇 / 古锭刀 / 白银狮子 / 骅骝 / 木牛流马
  ['diamond', 1, 'zhuque'],
  ['spade', 1, 'guding'],
  ['club', 1, 'baiyin'],
  ['diamond', 13, 'hualiu'],
  ['diamond', 5, 'muniu'],     // 花色点数对齐无名杀（方块5）
];

/** 统计信息（供开屏提示用） */
export const DECK_STATS = {
  total: DECK_LIST.length,
  byName: DECK_LIST.reduce((acc, [, , n]) => {
    acc[n] = (acc[n] || 0) + 1;
    return acc;
  }, {}),
};

export default { CARDS, DECK_LIST, SUITS, numberLabel, DECK_STATS };