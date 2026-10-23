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
};

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

export default { CHARACTERS, GROUPS, LORD_CHARS, ALL_CHARS, CHAR_STATS };