/**
 * 武将数据（标准包 / 标包）
 * ------------------------------------------------------------------
 * 字段说明：
 *   id      武将标识，图片路径为 noname/character/<id>.png
 *   name    显示名
 *   sex     male / female（影响【雌雄双股剑】、【离间】、【结姻】等）
 *   group   势力：wei / shu / wu / qun
 *   hp      体力上限
 *   skills  技能 id 数组（技能实现见 skills.js）
 *   isZhu   是否常备主公（身份模式主公候选）
 *   title   称号（展示用）
 *
 * 标包 26 将：魏 7 / 蜀 7 / 吴 8 / 群 4
 * （含华雄，5 体力群势力武将）
 */

/** 势力 */
export const GROUPS = {
  wei: { key: 'wei', label: '魏', color: '#4a6fa5' },
  shu: { key: 'shu', label: '蜀', color: '#b03a3a' },
  wu: { key: 'wu', label: '吴', color: '#3d8b6e' },
  qun: { key: 'qun', label: '群', color: '#7a6a55' },
  /**
   * 舟（= 再探泰拉）
   * ------------------------------------------------------------------
   * ⚠️「舟」是「再探泰拉」的**简称**，二者是同一个东西：
   *   本扩武将都属于这个包，势力显示为「舟」。
   *   因此选将页面只显示一个标签「再探泰拉」，
   *   不会再单独列出「舟」，避免两个内容相同的标签并排。
   */
  zhou: { key: 'zhou', label: '舟', color: '#3f7f9e' },
  /**
   * 乐（梦想协奏）
   * ------------------------------------------------------------------
   * 「梦想协奏」包的势力标识。
   * 与「舟」（再探泰拉）是两个不同的势力，各自有独立标签。
   */
  yue: { key: 'yue', label: '乐', color: '#8f6fb5' },
};

/**
 * 武将分类（选将页面的标签）
 * ------------------------------------------------------------------
 * 标准包武将不写 pack 字段（归入标准包，不单独出标签）。
 * 本扩武将写 pack: 'zaitan'，在选将页显示为「再探泰拉」。
 */
export const PACKS = {
  standard: { key: 'standard', label: '标准', color: '#8a7d6b' },
  zaitan: {
    key: 'zaitan',
    label: '再探泰拉',
    color: '#3f7f9e',
    // 该分类对应的势力（同一个东西，只是叫法不同）
    group: 'zhou',
  },
  /**
   * 梦想协奏
   * ------------------------------------------------------------------
   * 白金磷子所属的扩展包。势力为「乐」，
   * 与「再探泰拉」（势力「舟」）是两个不同的包。
   */
  mengxiang: {
    key: 'mengxiang',
    label: '梦想协奏',
    color: '#8f6fb5',
    group: 'yue',
  },
};

/**
 * 生成选将页面的标签列表
 * ------------------------------------------------------------------
 * 规则：若某个「分类」与某个「势力」指的是同一个东西，
 * 只保留分类那一个标签，避免重复。
 */
export function pickerTabs() {
  const tabs = [];
  const packs = Object.values(PACKS).filter((p) => p.key !== 'standard');
  packs.forEach((p) => tabs.push({
    key: `pack:${p.key}`, label: p.label, color: p.color,
  }));
  // 已被分类覆盖的势力不再重复出现（如「舟」被「再探泰拉」覆盖）
  const covered = new Set(packs.map((p) => p.group).filter(Boolean));
  Object.values(GROUPS).forEach((g) => {
    if (covered.has(g.key)) return;
    tabs.push({ key: `group:${g.key}`, label: g.label, color: g.color });
  });
  return tabs;
}

/** 取武将所属分类（未标注则算标准包） */
export function packOf(charId) {
  const c = CHARACTERS[charId];
  return (c && c.pack) || 'standard';
}

export const CHARACTERS = {
  /* ============================== 魏 (7) ============================== */
  caocao: {
    id: 'caocao', name: '曹操', title: '魏武帝',
    sex: 'male', group: 'wei', hp: 4,
    skills: ['jianxiong', 'hujia'],
    isZhu: true,
  },
  simayi: {
    id: 'simayi', name: '司马懿', title: '狼顾之鬼',
    sex: 'male', group: 'wei', hp: 3,
    skills: ['fankui', 'guicai'],
  },
  xiahoudun: {
    id: 'xiahoudun', name: '夏侯惇', title: '独眼的罗刹',
    sex: 'male', group: 'wei', hp: 4,
    skills: ['ganglie'],
  },
  zhangliao: {
    id: 'zhangliao', name: '张辽', title: '前将军',
    sex: 'male', group: 'wei', hp: 4,
    skills: ['tuxi'],
  },
  xuzhu: {
    id: 'xuzhu', name: '许褚', title: '虎痴',
    sex: 'male', group: 'wei', hp: 4,
    skills: ['luoyi'],
  },
  guojia: {
    id: 'guojia', name: '郭嘉', title: '早终的先知',
    sex: 'male', group: 'wei', hp: 3,
    skills: ['tiandu', 'yiji'],
  },
  zhenji: {
    id: 'zhenji', name: '甄姬', title: '薄幸的美人',
    sex: 'female', group: 'wei', hp: 3,
    skills: ['qingguo', 'luoshen'],
  },

  /* ============================== 蜀 (7) ============================== */
  liubei: {
    id: 'liubei', name: '刘备', title: '乱世的枭雄',
    sex: 'male', group: 'shu', hp: 4,
    skills: ['rende', 'jijiang'],
    isZhu: true,
  },
  guanyu: {
    id: 'guanyu', name: '关羽', title: '美髯公',
    sex: 'male', group: 'shu', hp: 4,
    skills: ['wusheng'],
  },
  zhangfei: {
    id: 'zhangfei', name: '张飞', title: '万夫不当',
    sex: 'male', group: 'shu', hp: 4,
    skills: ['paoxiao'],
  },
  zhugeliang: {
    id: 'zhugeliang', name: '诸葛亮', title: '卧龙',
    sex: 'male', group: 'shu', hp: 3,
    skills: ['guanxing', 'kongcheng'],
  },
  zhaoyun: {
    id: 'zhaoyun', name: '赵云', title: '虎威将军',
    sex: 'male', group: 'shu', hp: 4,
    skills: ['longdan'],
  },
  machao: {
    id: 'machao', name: '马超', title: '一骑当千',
    sex: 'male', group: 'shu', hp: 4,
    skills: ['mashu', 'tieji'],
  },
  huangyueying: {
    id: 'huangyueying', name: '黄月英', title: '归隐的杰女',
    sex: 'female', group: 'shu', hp: 3,
    skills: ['jizhi', 'qicai'],
  },

  /* ============================== 吴 (7) ============================== */
  sunquan: {
    id: 'sunquan', name: '孙权', title: '制衡的江东之主',
    sex: 'male', group: 'wu', hp: 4,
    skills: ['zhiheng', 'jiuyuan'],
    isZhu: true,
  },
  ganning: {
    id: 'ganning', name: '甘宁', title: '锦帆游侠',
    sex: 'male', group: 'wu', hp: 4,
    skills: ['qixi'],
  },
  lvmeng: {
    id: 'lvmeng', name: '吕蒙', title: '白衣渡江',
    sex: 'male', group: 'wu', hp: 4,
    skills: ['keji'],
  },
  huanggai: {
    id: 'huanggai', name: '黄盖', title: '轻身为国',
    sex: 'male', group: 'wu', hp: 4,
    skills: ['kurou'],
  },
  zhouyu: {
    id: 'zhouyu', name: '周瑜', title: '大都督',
    sex: 'male', group: 'wu', hp: 3,
    skills: ['yingzi', 'fanjian'],
  },
  daqiao: {
    id: 'daqiao', name: '大乔', title: '国色',
    sex: 'female', group: 'wu', hp: 3,
    skills: ['guose', 'liuli'],
  },
  luxun: {
    id: 'luxun', name: '陆逊', title: '儒生雄才',
    sex: 'male', group: 'wu', hp: 3,
    skills: ['qianxun', 'lianying'],
  },
  sunshangxiang: {
    id: 'sunshangxiang', name: '孙尚香', title: '弓腰姬',
    sex: 'female', group: 'wu', hp: 3,
    skills: ['jieyin', 'xiaoji'],
  },

  /* ============================== 群 (4) ============================== */
  huatuo: {
    id: 'huatuo', name: '华佗', title: '神医',
    sex: 'male', group: 'qun', hp: 3,
    skills: ['jijiu', 'qingnang'],
  },
  lvbu: {
    id: 'lvbu', name: '吕布', title: '武神',
    sex: 'male', group: 'qun', hp: 4,
    skills: ['wushuang'],
  },
  diaochan: {
    id: 'diaochan', name: '貂蝉', title: '绝世的舞姬',
    sex: 'female', group: 'qun', hp: 3,
    skills: ['lijian', 'biyue'],
  },
  huaxiong: {
    id: 'huaxiong', name: '华雄', title: '关西之虎',
    sex: 'male', group: 'qun', hp: 5,
    skills: ['shizhan'],
  },

  /* ========================= 再探泰拉 (3) ========================= */
  /**
   * 折桠 3/3 0 护甲，势力「舟」，分类「再探泰拉」。
   *
   * 技能：
   *   无我入春时 —— 每回合限一次。有角色受到伤害时，若该次伤害会
   *     确切减小其体力（伤害值 > 当前护甲），你可以流失 1 点体力并
   *     防止之；若因此濒死，则回复体力至 1，之后「本回合未使用过牌
   *     但成为过牌目标的其他角色」以及你自己，各获得 1 点护甲。
   *
   *   星火尽染寒 —— 出牌阶段开始时，可摸 X 张（X = 已损体力 + 2），
   *     这些牌使用时无距离、无次数限制；但本回合你使用的**所有牌**
   *     只能指定「手牌数不小于你」或「体力值不小于你」的角色。
   *
   * 立绘：需放置到 noname/character/zheya.png
   *       （仓库 images/character/折桠.png 即此图，可压缩后上传）
   */
  zheya: {
    id: 'zheya', name: '折桠', title: '时间的痕迹',
    sex: 'female', group: 'zhou', hp: 3,
    pack: 'zaitan',
    skills: ['wuworuchunshi', 'xinghuojinranhan'],
  },

  /**
   * 卡达 4/4、0 护甲，势力「舟」，分类「再探泰拉」。
   *
   * 技能：
   *   剪辑高手 —— 每种颜色每回合各限一次。每回合结束时，可将一张手牌
   *     置入弃牌堆，视为使用中央区的一张牌；若二者类型相同，可重复此流程；
   *     若花色相同，摸一张牌。（该操作视为「用 A 转化为 B 使用」，
   *     因此能触发【同步索敌攻击】）
   *
   *   同步索敌攻击 —— 你使用的牌结算后，若有其他角色体力或手牌数减少，
   *     你摸一张牌；以此技能获得的牌不计入手牌上限、使用时不受距离限制，
   *     若将之转化（当作其他牌）使用，再摸一张。
   *
   * 立绘：仓库 images/character/卡达.png（无需另传）
   */
  kada: {
    id: 'kada', name: '卡达', title: '机械援助',
    sex: 'female', group: 'zhou', hp: 4,
    pack: 'zaitan',
    skills: ['jianjigaoshou', 'tongbusuodigongji'],
  },

  /**
   * 白金磷子 4/4、0 护甲，势力「乐」，分类「梦想协奏」。
   *
   * 技能一：怯懦的琴键（锁定技 + 韵律技 + 转换技）
   *   · 韵律技（平/仄）：平 = 你体力未满时；仄 = 其他角色不能使用或
   *     打出**与结算中出现过花色**的牌。转韵：你扣减体力后。
   *   · 转换技（①/②）：你扣减体力后，① 摸三张牌或翻面；② 重新隐匿。
   *   · 激昂：连招（周始 + 周始）—— 即周始效果触发两次。
   *
   * 技能二：前行的决心（昂扬技 + 隐匿技）
   *   · 你登场时，于同一结算内使用 [0, 你手牌数] 张牌堆顶的牌；
   *   · 若你反面向上，下次发动技能可背水；
   *   · 已受伤时，每个花色首次使用后你从牌堆底摸一张牌；
   *   · 乘势：转韵。
   */
  baijinlinzi: {
    id: 'baijinlinzi', name: '白金磷子', title: '……',
    sex: 'female', group: 'yue', hp: 4,
    pack: 'mengxiang',
    skills: ['qienuodeqinjian', 'qianxingdejuexin'],
  },
};

/** 常备主公（身份模式中主公候选） */
export const LORD_CHARS = Object.values(CHARACTERS)
  .filter((c) => c.isZhu)
  .map((c) => c.id);

/** 全部武将 id */
export const ALL_CHARS = Object.keys(CHARACTERS);

/** 统计（供开屏提示） */
export const CHAR_STATS = {
  total: ALL_CHARS.length,
  byGroup: Object.values(CHARACTERS).reduce((acc, c) => {
    acc[c.group] = (acc[c.group] || 0) + 1;
    return acc;
  }, {}),
};

export default {
  CHARACTERS, GROUPS, PACKS, packOf, pickerTabs,
  LORD_CHARS, ALL_CHARS, CHAR_STATS,
};