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
 * 牌的两大分类：伤害类 / 非伤害类
 * --------------------------------------------------------------------------
 * 需求方 m08184 给出的划分（逐张指定，不是按牌面 type 推的）：
 *
 *   伤害类：杀（含火杀/雷杀/刺杀）、酒、决斗、南蛮入侵、万箭齐发、借刀杀人、
 *           浮雷、闪电、火烧联营、水淹七军、火攻、出其不意、武器牌、进攻马
 *   非伤害类：桃、兵粮寸断、乐不思蜀、调兵遣将、洞烛先机、过河拆桥、
 *           顺手牵羊、逐近弃远、增兵减灶、金蝉脱壳、舌战群儒、树上开花、
 *           铁索连环、无懈可击、五谷丰登、挟令、无中生有、桃园结义、
 *           远交近攻、防具牌、宝物牌、防御马
 *
 * 装备里的「武器牌 / 进攻马」算伤害类，「防具 / 宝物 / 防御马」算非伤害类，
 * 因此这里用槽位判断，而不是把每张装备牌名都列一遍。
 * ========================================================================== */

/** 伤害类的非装备牌（按牌名 key） */
export const DAMAGE_CARD_KEYS = [
  'sha',            // 杀（火杀 / 雷杀 / 刺杀 共用这个 key）
  'jiu',            // 酒
  'juedou',         // 决斗
  'nanman',         // 南蛮入侵
  'wanjian',        // 万箭齐发
  'jiedao',         // 借刀杀人
  'fulei',          // 浮雷
  'shandian',       // 闪电
  'huoshaolianying', // 火烧联营
  'shuiyan',        // 水淹七军
  'huogong',        // 火攻
  'chuqi',          // 出其不意
];

/** 算作伤害类的装备槽位：武器、进攻马 */
export const DAMAGE_EQUIP_SLOTS = ['equip1', 'equip4'];

/**
 * 判断一张牌（按牌名）是否属于伤害类。
 * 火杀 / 雷杀 / 刺杀 的 name 都是 'sha'，自然命中。
 */
export function isDamageCardName(name) {
  if (DAMAGE_CARD_KEYS.includes(name)) return true;
  const def = CARDS[name];
  return !!(def && def.type === 'equip' && DAMAGE_EQUIP_SLOTS.includes(def.subtype));
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
    desc: '出牌阶段，对所有角色使用。亮出的牌数比目标人数多 2 张，'
      + '然后从使用者开始依次各获得一张，未被选走的牌进入弃牌堆。',
    tip: '亮出「人数 + 2」张牌，依次各取一张',
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
    attackRange: 3,
    equipSkill: 'qinggang_skill',
    desc: '锁定技，攻击范围 3。你的【杀】无视目标的防具、护甲与技能。',
    tip: '攻击范围 3，无视防具、护甲与技能',
  },
  cixiong: {
    name: 'cixiong',
    type: 'equip',
    subtype: 'equip1',
    label: '雌雄',
    fullname: '雌雄双股剑',
    attackRange: 2,
    equipSkill: 'cixiong_skill',
    desc: '攻击范围 2。当你使用【杀】指定一名与你性别不同的角色为目标后，'
      + '你可以令其弃置一张手牌，然后你摸一张牌。',
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
    desc: '攻击范围 3。你可以将两张牌当作【杀】使用或打出；'
      + '用两张类型相同的牌转化的【杀】造成的伤害 +1。',
    tip: '攻击范围 3，两张牌当杀，同类型伤害 +1',
  },
  guanshi: {
    name: 'guanshi',
    type: 'equip',
    subtype: 'equip1',
    label: '贯石',
    fullname: '贯石斧',
    attackRange: 3,
    equipSkill: 'guanshi_skill',
    desc: '攻击范围 3。你使用的【杀】被抵消时，你可以熔铸两张牌，令此【杀】依然造成伤害。',
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
    desc: '攻击范围 5。当你使用【杀】对目标角色造成伤害时，可以弃置其装备区里的一张牌。',
    tip: '攻击范围 5，可弃置目标一张装备',
  },
  bagua: {
    name: 'bagua',
    type: 'equip',
    subtype: 'equip2',
    label: '八卦',
    fullname: '八卦阵',
    equipSkill: 'bagua_skill',
    desc: '当你需要使用或打出【闪】时，你可以进行判定：若结果为红色，视为你使用或打出一张【闪】；'
      + '若结果为红桃或黑桃，你获得判定牌。',
    tip: '需要【闪】时可判定，红色则视为出闪，红桃/黑桃拿回判定牌',
  },
  renwang: {
    name: 'renwang',
    type: 'equip',
    subtype: 'equip2',
    label: '仁王',
    fullname: '仁王盾',
    equipSkill: 'renwang_skill',
    desc: '锁定技，黑色的【杀】对你无效。轮次技，你成为黑色锦囊牌的目标时，可以令之对你无效。',
    tip: '黑杀无效，每轮还能挡一次黑色锦囊',
  },
  tengjia: {
    name: 'tengjia',
    type: 'equip',
    subtype: 'equip2',
    label: '藤甲',
    fullname: '藤甲',
    equipSkill: 'tengjia_skill',
    desc: '锁定技，【南蛮入侵】、【万箭齐发】和普通【杀】对你无效；'
      + '当你受到火焰伤害时，伤害值 +1，然后你可以弃置此牌并摸一张牌。',
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
    attackRange: 3,
    equipSkill: 'hanbing_skill',
    desc: '攻击范围 3。你使用【杀】造成伤害时，可以防止此伤害，改为弃置目标两张牌。',
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
    /**
     * 可重铸（参考无名杀 recastable）
     * 玩家可以选择不使用此牌，而是「重铸」：弃置它并摸一张新牌。
     */
    recastable: true,
    desc: '出牌阶段，横置或重置 1~2 名角色。'
      + '处于横置状态的角色受到属性伤害时，其他横置角色也受到同来源同属性同点数的伤害，然后重置。'
      + '（可重铸：弃置此牌并摸一张牌）',
    tip: '横置/重置角色（可重铸换牌）',
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
    desc: '攻击范围 4。当你使用【杀】时，你可以将此【杀】改为火【杀】或雷【杀】。',
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
    desc: '攻击范围 2。锁定技，当你使用【杀】对目标角色造成伤害时，'
      + '若该角色没有手牌或装备牌，此伤害 +1。',
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
      + '当你失去装备区里的【白银狮子】后，你回复 1 点体力并摸一张牌。',
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
    /**
     * 可重铸
     * ------------------------------------------------------------------
     * 官方【木牛流马】带有重铸：出牌阶段可以将其置入弃牌堆并摸一张牌。
     * 若不做成 recastable，玩家就会「找不到怎么用」。
     */
    recastable: true,
    desc: '出牌阶段限一次，你可以将一张手牌置于【木牛流马】下（称为「辎」）。'
      + '你可以将【木牛流马】下的牌如手牌般使用或打出。'
      + '当你失去装备区里的【木牛流马】时，将其下的牌置入弃牌堆。',
    tip: '可存放手牌，并像手牌一样使用其中的牌（可重铸）',
  },

  /* ==================================================================
   * 四副牌堆新增的装备
   * ================================================================== */
  yitian: {
    name: 'yitian',
    type: 'equip',
    subtype: 'equip1',
    label: '倚天',
    fullname: '倚天剑',
    attackRange: 2,
    equipSkill: 'yitian_skill',
    desc: '攻击范围 2。当你使用【杀】造成伤害后，你可以弃置一张手牌并回复 1 点体力；'
      + '或重铸一张牌，获得 1 点护甲。',
    tip: '攻击范围 2，杀中后可回血或换护甲',
  },
  jingyin: {
    name: 'jingyin',
    type: 'equip',
    subtype: 'equip2',
    label: '精银',
    fullname: '精银甲',
    equipSkill: 'jingyin_skill',
    desc: '你可以将一张手牌当【闪】打出；你打出非转化的【闪】时摸一张牌。'
      + '此技能不会被无效，也不能被无视。',
    tip: '手牌当闪，打出真闪摸一张（不会被青釭剑无视）',
  },
  huxinjing: {
    name: 'huxinjing',
    type: 'equip',
    subtype: 'equip2',
    label: '护心',
    fullname: '护心镜',
    equipSkill: 'huxinjing_skill',
    /** 可以对其他角色使用：给他装备上（顶掉原防具） */
    usableOnOther: true,
    desc: '当你受到致命伤害或大于 1 点的伤害时，你可以弃置此牌防止之，'
      + '然后摸伤害值张牌。此牌也可以对其他角色使用（为其装备）。',
    tip: '挡一次大伤害，摸等量的牌',
  },
  tianjitu: {
    name: 'tianjitu',
    type: 'equip',
    subtype: 'equip5',
    label: '天机',
    fullname: '天机图',
    equipSkill: 'tianji_skill',
    desc: '锁定技，此牌进入你的装备区时，你弃置一张其他牌；'
      + '此牌离开你的装备区时，你将手牌摸至七张。',
    tip: '进装备区要弃一张牌，离开时手牌补到 7',
  },
  jianma: {
    name: 'jianma',
    type: 'equip',
    subtype: 'equip4',
    label: '−1马',
    fullname: '−1马',
    distanceFrom: 1,
    desc: '你计算与其他角色的距离时 -1。',
    tip: '你到他人的距离 -1',
  },
  fangma: {
    name: 'fangma',
    type: 'equip',
    subtype: 'equip3',
    label: '+1马',
    fullname: '+1马',
    distanceTo: 1,
    desc: '其他角色计算与你的距离时 +1。',
    tip: '他人到你的距离 +1',
  },

  /* ==================================================================
   * 扩展牌（用户自定义，四副牌堆）
   * ------------------------------------------------------------------
   * 【刺杀】不单列：它是【杀】的一种形态（卡牌上加 cisha 标记），
   * 这样「杀」的所有判定（次数、决斗/南蛮响应）都自动生效。
   * 【火杀】【雷杀】同理，用 Card.nature 表示。
   * ================================================================== */
  shanshan: {
    name: 'shanshan',
    type: 'basic',
    subtype: 'respond',
    label: '闪闪',
    fullname: '闪闪',
    respondOnly: true,
    desc: '你可以将此牌当【闪】打出，抵消【杀】；也可以当【无懈可击】打出，抵消锦囊。'
      + '抵消后，你获得被抵消的那张牌。',
    tip: '可当【闪】或【无懈】，抵消后获得该牌',
  },
  zhujin: {
    name: 'zhujin',
    type: 'trick',
    label: '逐近',
    fullname: '逐近弃远',
    selectTarget: 1,
    notSelf: true,
    targetHasCard: true,
    desc: '出牌阶段，对一名其他角色使用。若你与其距离大于 1，你弃置其区域里一张牌；'
      + '若距离为 1，你获得其区域里一张牌。',
    tip: '远则弃置、近则获得对方一张牌',
  },
  dongzhu: {
    name: 'dongzhu',
    type: 'trick',
    label: '洞烛',
    fullname: '洞烛先机',
    selectTarget: 0,
    selfOnly: true,
    desc: '出牌阶段，对你使用。你卜算 2，然后摸两张牌。',
    tip: '卜算 2 后摸两张',
  },
  zengbing: {
    name: 'zengbing',
    type: 'trick',
    label: '增兵',
    fullname: '增兵减灶',
    selectTarget: 1,
    notSelf: true,
    desc: '出牌阶段，对一名角色使用。目标角色摸三张牌，然后选择一项：弃置一张非基本牌；或弃置两张牌。',
    tip: '目标摸三张，再弃一张非基本牌或两张牌',
  },
  fulei: {
    name: 'fulei',
    type: 'trick',
    label: '浮雷',
    fullname: '浮雷',
    selectTarget: 0,
    selfOnly: true,
    delayed: true,
    desc: '出牌阶段，对你使用。将【浮雷】置入你的判定区。判定若为黑桃，你受到 X 点雷电伤害'
      + '（X 为此【浮雷】判定出黑桃的次数）；然后将其置入下家的判定区。',
    tip: '判定黑桃则受雷电伤害，然后传给下家',
  },
  shushangkaihua: {
    name: 'shushangkaihua',
    type: 'trick',
    label: '树上',
    fullname: '树上开花',
    selectTarget: 0,
    selfOnly: true,
    desc: '出牌阶段，对你使用。你弃置至多两张牌，然后摸等量的牌；'
      + '若你以此法弃置了装备牌，则多摸两张牌。',
    tip: '弃至多两张再摸等量，弃装备牌多摸两张',
  },
  shuiyan: {
    name: 'shuiyan',
    type: 'trick',
    label: '水淹',
    fullname: '水淹七军',
    selectTarget: 1,
    notSelf: true,
    desc: '出牌阶段，对一名其他角色使用。目标角色选择一项：弃置包含装备区的至少两张装备牌；'
      + '或受到你造成的 1 点雷电伤害。',
    tip: '要么弃两张装备牌，要么吃 1 点雷电伤害',
  },
  xieling: {
    name: 'xieling',
    type: 'trick',
    label: '挟令',
    fullname: '挟令',
    selectTarget: 0,
    selfOnly: true,
    desc: '出牌阶段，对你使用。你可以结束出牌阶段，并于回合结束时选择一项：'
      + '获得一个额外阶段；或弃置一张牌，获得两个不同的额外阶段。',
    tip: '结束出牌阶段，换取一个或两个额外阶段',
  },
  shezhan: {
    name: 'shezhan',
    type: 'trick',
    label: '舌战',
    fullname: '舌战群儒',
    selectTarget: 0,
    selfOnly: true,
    desc: '出牌阶段，对你使用。你摸一张牌后，所有其他角色选择是否与你同时拼点；'
      + '若你的拼点牌最大或无人与你拼点，你摸两张牌。',
    tip: '与他人拼点，最大或无人应战则摸两张',
  },
  diaobing: {
    name: 'diaobing',
    type: 'trick',
    label: '调兵',
    fullname: '调兵遣将',
    selectTarget: -1,
    allPlayers: true,
    desc: '出牌阶段，对你和有手牌的其他角色使用。你摸一张牌后，亮出牌堆顶 X 张牌，'
      + '从你开始的目标角色依次选择是否用一张手牌与亮出牌交换；'
      + '均结束后，你将亮出牌按任意顺序放回牌堆两侧。（X 为存活人数的一半，向上取整）',
    tip: '亮出牌堆顶若干牌，依次与手牌交换',
  },
  chuqi: {
    name: 'chuqi',
    type: 'trick',
    label: '出其',
    fullname: '出其不意',
    selectTarget: 1,
    notSelf: true,
    desc: '出牌阶段，对一名其他角色使用。目标角色进行一次判定，'
      + '若其不弃置一张与判定牌同花色的手牌，则受到 1 点无来源伤害。',
    tip: '不弃同花色手牌则受 1 点伤害',
  },
  huoshaolianying: {
    name: 'huoshaolianying',
    type: 'trick',
    label: '火烧',
    fullname: '火烧联营',
    selectTarget: -1,
    allPlayers: true,
    desc: '出牌阶段，对与你距离最小的所有其他角色使用。目标角色各受到 1 点无来源火焰伤害。',
    tip: '距离你最近的角色各受 1 点火焰伤害',
  },
  jinchan: {
    name: 'jinchan',
    type: 'basic',
    subtype: 'respond',
    label: '金蝉',
    fullname: '金蝉脱壳',
    respondOnly: true,
    desc: '当你成为即时牌的目标时，你可以弃置此牌，令之对你无效。'
      + '此牌被弃置时，你摸一张牌；若此牌为你的最后一张手牌，则改为摸两张。',
    tip: '弃置此牌抵消对自己生效的牌，并摸牌',
  },
  yuanjiao: {
    name: 'yuanjiao',
    type: 'trick',
    label: '远交',
    fullname: '远交近攻',
    selectTarget: -1,
    allPlayers: true,
    desc: '出牌阶段，对一名手牌数与体力值之和最小（且不包括你）的其他角色使用。'
      + '目标角色摸一张牌后，你摸三张牌。',
    tip: '让最弱的对手摸一张，你摸三张',
  },

  /* ==================================================================
   * 轮换牌 · 卡包一《星神的一瞥》
   * ------------------------------------------------------------------
   * 需求方给定：新增牌类型「星神赐福」——
   *   · 不属于基本 / 锦囊 / 装备，也不属于即时牌、伤害类牌等统计口径；
   *   · 不能被【无懈可击】抵消（只有【IX】能压它）；
   *   · 没有特别声明前，即使存在于牌堆也不能被转化。
   * 多数是「出牌阶段对一名本局未受星神赐福的角色使用」。
   * ================================================================== */
  nanuke: {
    name: 'nanuke',
    type: 'blessing',
    label: '纳努克',
    fullname: '纳努克',
    selectTarget: 1,
    needUnblessed: true,
    desc: '出牌阶段，对一名本局未受星神赐福的角色使用。目标角色失去 1 点体力，'
      + '你可以弃置两张手牌令之改为失去 2 点体力。',
    tip: '目标失去 1（弃两张手牌则 2）点体力',
  },
  lan: {
    name: 'lan',
    type: 'blessing',
    label: '岚',
    fullname: '岚',
    selectTarget: 1,
    needUnblessed: true,
    desc: '出牌阶段，对一名本局未受星神赐福的角色使用。目标角色于当前回合结束后获得一个额外回合。',
    tip: '目标在本回合结束后获得一个额外回合',
  },
  boshizun: {
    name: 'boshizun',
    type: 'blessing',
    label: '博识尊',
    fullname: '博识尊',
    selectTarget: 1,
    needUnblessed: true,
    desc: '出牌阶段，对一名本局未受星神赐福的角色使用。目标角色从其下家开始，'
      + '依次观看所有其他角色的手牌并获得其中一张，本回合这些角色的手牌对目标角色始终可见。',
    tip: '目标依次看遍全场手牌并各取一张',
  },
  ix: {
    name: 'ix',
    type: 'blessing',
    label: 'IX',
    fullname: 'IX',
    // 对「一张正在使用的牌」使用，不是对角色使用
    useOnCard: true,
    respondOnly: true,
    desc: '对一名角色使用或打出的一张牌使用。那张牌的效果无效。'
      + '（可以让星神赐福无效，但仍算作成为过星神赐福的目标）',
    tip: '无效掉一张正在结算的牌',
  },
  kelipo: {
    name: 'kelipo',
    type: 'blessing',
    label: '克里珀',
    fullname: '克里珀',
    selectTarget: 1,
    needUnblessed: true,
    desc: '出牌阶段，对一名本局未受星神赐福的角色使用。目标角色获得 3 点护甲。',
    tip: '目标获得 3 点护甲',
  },
  yaoshi: {
    name: 'yaoshi',
    type: 'blessing',
    label: '药师',
    fullname: '药师',
    selectTarget: 1,
    needUnblessed: true,
    desc: '出牌阶段，对一名本局未受星神赐福的角色使用。目标角色回复 2 点体力；'
      + '若因此回复至上限，你观看其手牌并获得其中一张。',
    tip: '目标回复 2 点体力',
  },
  aoboluosi: {
    name: 'aoboluosi',
    type: 'blessing',
    label: '奥博洛斯',
    fullname: '奥博洛斯',
    selectTarget: 1,
    needUnblessed: true,
    desc: '出牌阶段，对一名本局未受星神赐福的角色使用。目标角色本回合手牌上限变为 1，'
      + '造成伤害时可以摸 X 张牌（X 为伤害值）；用这张牌的效果以外摸牌时，可以少摸一张并回复 1 点体力。',
    tip: '目标本回合手牌上限 1、伤害后摸牌',
  },
  aha: {
    name: 'aha',
    type: 'blessing',
    label: '阿哈',
    fullname: '阿哈',
    selectTarget: 1,
    needUnblessed: true,
    desc: '出牌阶段，对一名本局未受星神赐福的角色使用。目标角色进行一次判定：'
      + '红色回复 1 点体力；黑色失去 1 点体力；偶数摸一张牌；奇数弃置一张牌。',
    tip: '目标判定，按颜色与奇偶结算',
  },
  tayiziyuluosi: {
    name: 'tayiziyuluosi',
    type: 'blessing',
    label: '塔伊兹育罗斯',
    fullname: '塔伊兹育罗斯',
    selectTarget: 1,
    needUnblessed: true,
    desc: '出牌阶段，对一名本局未受星神赐福的角色使用。目标角色摸六张牌，'
      + '本回合其使用或打出牌前须弃置一张牌或失去 1 点体力，否则不能使用或打出牌。',
    tip: '目标摸六张，本回合用牌要先付代价',
  },
  xipei: {
    name: 'xipei',
    type: 'blessing',
    label: '希佩',
    fullname: '希佩',
    selectTarget: 1,
    needUnblessed: true,
    respondOnly: true,
    onDamage: true,
    desc: '未受星神赐福的角色受到伤害时，才能对该受伤角色使用。那次伤害变为 0，'
      + '本回合所有角色造成的伤害 -1，然后你、受伤角色、伤害来源各摸一张牌。',
    tip: '取消一次伤害，本回合伤害 -1',
  },
  misi: {
    name: 'misi',
    type: 'blessing',
    label: '迷思',
    fullname: '迷思',
    selectTarget: 1,
    needUnblessed: true,
    desc: '出牌阶段，对一名本局未受星神赐福的角色使用。目标角色接下来两次使用牌时'
      + '可以扣置后声明牌名，其他角色可依次质疑；相同则该牌额外结算一次，'
      + '不同则质疑者于结算后摸一张牌。',
    tip: '目标下两次用牌可声明牌名',
  },
  fuli: {
    name: 'fuli',
    type: 'blessing',
    label: '浮黎',
    fullname: '浮黎',
    selectTarget: 1,
    needUnblessed: true,
    desc: '出牌阶段，对一名本局未受星神赐福的角色使用。目标角色至多获得弃牌堆中'
      + '【基本或锦囊】【武器或防具】【坐骑或宝物】三组种类各一张的牌。',
    tip: '目标从弃牌堆按类别各取一张',
  },

  /* ==================================================================
   * 轮换牌 · 卡包二《通宝雅集》
   * ================================================================== */
  dayantongbao: {
    name: 'dayantongbao',
    type: 'equip',
    subtype: 'equip2',
    label: '大炎通宝',
    fullname: '大炎通宝',
    equipSkill: 'tongbao_dayan_skill',
    // 也视为防具，占用防具区；可以对其他角色使用
    asArmor: true,
    usableOnOther: true,
    desc: '锁定技，此装备也视为防具牌，占用防具区；离开你的装备区时你摸一张牌。可以对其他角色使用此牌。',
    tip: '宝物/防具，离开装备区摸一张',
  },
  hanre: {
    name: 'hanre',
    type: 'equip',
    subtype: 'equip5',
    label: '旱热',
    fullname: '旱热',
    equipSkill: 'tongbao_hanre_skill',
    desc: '锁定技，每回合首张被使用的红色牌对你造成的伤害 -1。',
    tip: '每回合首张红牌对你伤害 -1',
  },
  hongcai: {
    name: 'hongcai',
    type: 'equip',
    subtype: 'equip2',
    label: '虹彩',
    fullname: '虹彩',
    equipSkill: 'tongbao_hongcai_skill',
    desc: '锁定技，你成为过所有颜色的牌的目标的回合结束后，你摸两张牌。',
    tip: '集齐红黑目标后回合结束摸两张',
  },
  wurenzhizheng: {
    name: 'wurenzhizheng',
    type: 'equip',
    subtype: 'equip1',
    label: '武人之争',
    fullname: '武人之争',
    range: 3,
    equipSkill: 'tongbao_wuren_skill',
    desc: '你使用【杀】结算后，可进行一次判定：红色，本回合你的伤害类牌造成的伤害 +1；'
      + '黑色，本回合你造成的伤害视为流失体力。',
    tip: '杀后判定：红则伤害+1，黑则伤害变流失体力',
  },
  baiyejuxing: {
    name: 'baiyejuxing',
    type: 'equip',
    subtype: 'equip2',
    label: '百业俱兴',
    fullname: '百业俱兴',
    equipSkill: 'tongbao_baiye_skill',
    desc: '锁定技，你的防御距离 +1；若你有防御马，每回合你首次成为伤害类牌的目标结算后，你摸一张牌。',
    tip: '防御距离+1，首次被伤害类牌指定后摸牌',
  },
  hanmenzhi: {
    name: 'hanmenzhi',
    type: 'trick',
    label: '寒门志',
    fullname: '寒门志',
    selectTarget: 0,
    autoTargets: 'minHand',
    desc: '出牌阶段，对手牌数最少的所有角色使用。目标角色各摸两张牌后，本回合不能使用或打出牌。',
    tip: '手牌最少的角色各摸两张并封牌',
  },
  yuliangyi: {
    name: 'yuliangyi',
    type: 'trick',
    label: '遇良奕',
    fullname: '遇良奕',
    selectTarget: 1,
    notSelf: true,
    desc: '出牌阶段，对一名其他角色使用。目标角色与你各将手牌摸至 8 张后，'
      + '本回合你仅能对其使用手牌；其他所有角色于回合结束前调离；'
      + '出牌阶段结束后你与目标角色弃置以此法获得的牌。',
    tip: '双方手牌摸至 8，你只能对他用牌',
  },
  zhanxueliu: {
    name: 'zhanxueliu',
    type: 'equip',
    subtype: 'equip5',
    label: '战血流',
    fullname: '战血流',
    equipSkill: 'tongbao_zhanxue_skill',
    desc: '锁定技，你的手牌上限 -1；你成为牌的目标时，使用者本回合的手牌上限 -1。',
    tip: '手牌上限-1，被指定时使用者上限-1',
  },
  yiziluo: {
    name: 'yiziluo',
    type: 'equip',
    subtype: 'equip5',
    label: '一字落',
    fullname: '一字落',
    equipSkill: 'tongbao_yizi_skill',
    desc: '锁定技，你不能于摸牌阶段外获得牌；你的摸牌阶段不会被跳过且额定摸牌数 +2。',
    tip: '只能摸牌阶段得牌，摸牌阶段+2',
  },
  zhengshangji: {
    name: 'zhengshangji',
    type: 'trick',
    label: '争商机',
    fullname: '争商机',
    selectTarget: 0,
    allPlayers: true,
    desc: '出牌阶段，对所有角色使用。从你开始依次选择是否弃置所有手牌，'
      + '每弃置一个种类的牌摸一张、每弃置两个花色的牌摸三张。',
    tip: '全员弃手牌换摸牌',
  },
  baizaoshengjing: {
    name: 'baizaoshengjing',
    type: 'equip',
    subtype: 'equip2',
    label: '百灶盛景',
    fullname: '百灶盛景',
    equipSkill: 'tongbao_baizao_skill',
    desc: '每回合你首次不因此牌的效果失去牌后，扣置于该牌上；此牌离开你的装备区时，'
      + '你摸两倍扣置牌种类数量的牌。轮次技，你可移去一张扣置牌以视为使用或打出之。',
    tip: '记录失去的牌，离开时按种类摸牌',
  },
  guijidaibi: {
    name: 'guijidaibi',
    type: 'equip',
    subtype: 'equip1',
    label: '诡异代币',
    fullname: '诡异代币',
    range: 5,
    equipSkill: 'tongbao_guiji_skill',
    desc: '锁定技，此牌进入/离开你的装备区时你摸/弃两张牌；你造成的伤害不会被减少。',
    tip: '进出装备区摸弃两张，伤害不被减少',
  },
};

/**
 * 牌堆（四副扑克，不含大小王）
 * ------------------------------------------------------------------
 * 格式：[花色, 点数, 牌名, 标记]
 *   标记 'fire' / 'thunder' → 火杀 / 雷杀（Card.nature）
 *   标记 'cisha'            → 刺杀（对闪的响应有额外要求）
 *
 * 由 S/H/C/D 四个小工具按花色聚合，方便对照「每种花色各有哪些点数」。
 */
const S = (nums, name, tag) => nums.map((n) => ['spade', n, name, tag]);
const H = (nums, name, tag) => nums.map((n) => ['heart', n, name, tag]);
const C = (nums, name, tag) => nums.map((n) => ['club', n, name, tag]);
const D = (nums, name, tag) => nums.map((n) => ['diamond', n, name, tag]);

export const DECK_LIST = [
  /* ---------------- 杀 ---------------- */
  ...S([3, 4, 5, 6, 7, 7, 8, 9, 12], 'sha'),
  ...C([4, 5, 6, 6, 7, 7, 8, 9, 10], 'sha'),
  ...H([5, 10], 'sha'),
  ...D([5, 6, 7, 8, 9], 'sha'),

  // 火杀
  ...D([3, 4, 7, 9, 10], 'sha', 'fire'),
  ...H([3, 3, 4, 4, 11], 'sha', 'fire'),

  // 雷杀
  ...C([1, 2, 2, 3, 3, 5], 'sha', 'thunder'),
  ...S([4, 8, 10, 10], 'sha', 'thunder'),

  // 刺杀
  ...S([2, 3, 5], 'sha', 'cisha'),
  ...C([4, 12], 'sha', 'cisha'),

  /* ---------------- 闪 ---------------- */
  ...C([1, 10, 11, 12], 'shan'),
  ...H([1, 2, 3, 5, 7, 7, 7, 8, 8, 9, 9, 11, 13, 13], 'shan'),
  ...D([1, 2, 2, 3, 4, 4, 6, 7, 8, 10, 11, 11], 'shan'),

  // 闪闪（当【闪】或【无懈】用）
  ...S([11], 'shanshan'),

  /* ---------------- 桃 ---------------- */
  ...D([1, 2, 5, 5, 7, 10, 12], 'tao'),
  ...H([1, 2, 4, 6, 6, 9, 11], 'tao'),

  /* ---------------- 酒 ---------------- */
  ...S([2, 4, 10], 'jiu'),
  ...C([3, 6, 7, 9, 13], 'jiu'),
  ...D([13], 'jiu'),

  /* ---------------- 锦囊 ---------------- */
  ...H([1, 1], 'taoyuan'),

  ...D([1], 'wanjian'), ...H([2], 'wanjian'),

  ...S([1], 'juedou'), ...C([3], 'juedou'), ...D([5], 'juedou'), ...H([7], 'juedou'),

  ...D([12], 'wugu'), ...H([13], 'wugu'),

  ...S([9], 'shunshou'), ...C([8], 'shunshou'),
  ...D([9], 'shunshou'), ...H([8], 'shunshou'),

  ...S([6, 7, 8], 'guohe'), ...C([9], 'guohe'),

  // 逐近弃远
  ...H([12], 'zhujin'), ...S([6], 'zhujin'),

  ...D([4, 10, 11], 'lebu'),

  ...S([2, 2, 12], 'nanman'), ...C([11], 'nanman'),

  ...H([3, 8, 10], 'wuzhong'),

  ...D([3], 'dongzhu'),

  ...C([4], 'zengbing'),

  ...C([8, 13], 'jiedao'),

  ...H([5], 'huogong'), ...D([9], 'huogong'),

  ...C([2, 7], 'bingliang'),

  ...S([1, 3], 'tiesuo'), ...C([1, 12], 'tiesuo'),

  ...S([11], 'shandian'),

  ...S([11], 'fulei'),

  ...S([13, 13], 'wuxie'), ...C([12, 13], 'wuxie'),
  ...D([12, 12, 13], 'wuxie'), ...H([12, 12], 'wuxie'),

  ...C([10], 'shushangkaihua'),

  ...S([4], 'shuiyan'),

  ...D([6], 'xieling'),

  ...H([5], 'shezhan'),

  ...D([13], 'diaobing'),

  ...S([9], 'chuqi'),

  ...H([9], 'huoshaolianying'),

  ...S([13], 'jinchan'),

  ...H([12], 'yuanjiao'),

  /* ==================================================================
   * 装备（四副牌堆，30 个装备位中的 29 张）
   * ================================================================== */
  ...S([1], 'zhuge'), ...D([1], 'zhuge'),
  ...C([1], 'cixiong'),
  ...S([6], 'qinggang'),
  ...S([9], 'guanshi'),
  ...H([6], 'zhangba'),
  ...H([12], 'qilin'),
  ...C([8], 'hanbing'),
  ...S([7], 'guding'),
  ...D([6], 'zhuque'),
  ...D([8], 'muniu'),
  ...S([10], 'yitian'),
  ...C([6], 'jingyin'),
  ...H([4], 'huxinjing'),
  ...S([3], 'bagua'), ...C([2], 'bagua'),
  ...C([5], 'renwang'), ...S([8], 'renwang'),
  ...S([5], 'baiyin'),
  ...C([10], 'tengjia'), ...D([4], 'tengjia'),
  ...S([13], 'jianma'), ...C([11], 'jianma'), ...C([13], 'jianma'), ...H([13], 'jianma'),
  ...S([11], 'fangma'), ...S([12], 'fangma'), ...D([11], 'fangma'), ...H([11], 'fangma'),
  ...C([5], 'tianjitu'),
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