// 与数据库表一一对应的类型。字段名和数据库列名保持一致。

export type Folder = {
  id: string;
  name: string;
  parent_id: string | null;
  position: number;
  color: string | null;
  created_at: string;
  updated_at: string;
};

export type Note = {
  id: string;
  folder_id: string | null;
  title: string;
  content: unknown; // TipTap 富文本 JSON
  content_text: string | null; // 纯文本，供搜索 / 粘贴识别
  source_type: string | null;
  created_at: string;
  updated_at: string;
};

export type Card = {
  id: string;
  note_id: string | null;
  front: string;
  back: string | null;
  front_audio: string | null;
  back_audio: string | null;
  tags: string[] | null;
  kind: string | null; // 'word' 生词 / 'example' 例句 / null 普通
  theme: string | null; // AI 智能整理归到的场景主题 key（如 "food"）；null 表示还没整理过
  position: number;
  created_at: string;
  updated_at: string;
};

/** 带所属笔记标题的卡片（「全部卡片」页用）。 */
export type CardWithNote = Card & { note_title: string | null };

/** 卡片页的分组结构：文件夹 → 笔记（含卡片数）。 */
export type CardNoteGroup = {
  noteId: string;
  title: string;
  count: number;
  sourceType: string | null; // "cards" = 卡片文件；null = 普通笔记
  /** 该笔记下卡片的主要语言（按正面文字自动检测，如 "thai"/"korean"；测不出为 "other"）。 */
  lang: string | null;
};
export type CardFolderGroup = {
  folderId: string | null;
  folderName: string;
  notes: CardNoteGroup[];
};

/** 用户设置（每日复习目标、复习提醒、识别规则、隐藏的主题）。 */
export type UserSettings = {
  daily_goal: number;
  reminder_enabled: boolean;
  reminder_time: string | null;
  recognition_rules: RecognitionRules | null;
  /** 用户隐藏（删除）的内置词群主题 key（如 "food"），这些主题不再出现在词群页。 */
  hidden_themes: string[];
};

/** 一条自定义分隔规则：命中即按指定方式把一行拆成「正面 / 背面」。 */
export type SplitRule = {
  /** 规则名称（仅用于显示，帮助自己记住这条规则）。 */
  name: string;
  /** 分隔方式：两个空格 / 制表符 / 冒号 / 自定义正则。 */
  mode: "double-space" | "tab" | "colon" | "custom";
  /** 自定义正则（mode=custom 时用，不含斜杠）。 */
  customPattern?: string;
  /** 命中后生成的卡片类型（普通 = 不标类型）。 */
  kind: "word" | "example" | "grammar" | "general";
  /** 作用范围：全部内容，还是只在彩色区块（生词/例句/语法）内。 */
  appliesTo: "all" | "callout";
};

/** 闪卡识别规则：自定义「正面 / 背面 / 拓展」三类表头关键词 + 行内分隔符 + 识别范围。 */
export type RecognitionRules = {
  front: string[];
  back: string[];
  extra: string[];
  /** 自定义行内分隔符（如 "=="），命中「词==释义」直接拆正反面；留空用内置 词—释义/词：释义。 */
  separator: string | null;
  /** 只在 生词/例句/语法 callout 内识别（避免把正文普通段落误转成闪卡）。 */
  calloutOnly: boolean;
  /** 读音（罗马音）放正面还是背面，默认背面（另起一行【读音】）。 */
  reading?: "front" | "back";
  /** 反面里「两个及以上空格」分隔的内容自动换行（默认开）。 */
  wrapBackSpaces?: boolean;
  /** 反面里按分号（；/;）把例句分句成多行（默认关）。 */
  splitBySemicolon?: boolean;
  /** 自定义分隔规则（「新增规则」）：命中即按指定方式拆正反面，可带卡片类型。 */
  customRules?: SplitRule[];
};

/** 用户自定义的词群分类（名字 + 关键词，命中即收录）。 */
export type WordTheme = {
  id: string;
  user_id: string;
  name: string;
  keywords: string[];
  created_at: string;
};

/** 复习状态（每张卡一条，SM-2 间隔重复）。 */
export type ReviewState = {
  id: string;
  card_id: string;
  ease: number;
  interval_days: number;
  reps: number;
  lapses: number;
  due_at: string;
  last_rating: number | null;
  created_at: string;
  updated_at: string;
};

/** 复习页的统计数字。 */
export type ReviewStats = {
  totalCards: number;
  reviewed: number; // 有复习记录的卡数
  due: number; // 现在到期（含没复习过的）
  mastered: number; // 间隔 ≥21 天或已稳定答对
  weak: number; // 待加强（上次答错 / 多次忘记）
  todayReviewed: number; // 今天复习的卡数
  recentDays: { label: string; count: number }[]; // 最近 7 天每天复习张数
};

/** 一个可自由选择的闪卡合集（笔记 + 类别，或独立卡片）。 */
export type CollectionSummary = {
  key: string;
  noteId: string | null;
  kind: string | null;
  title: string;
  total: number;
  due: number;
  /** 最近一次复习某张卡的时间（毫秒时间戳）；没复习过为 null。用来找「最近在背的合集」。 */
  lastReviewedAt: number | null;
};
