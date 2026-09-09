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
  /** 闪卡合集显示名（改合集名不碰原始笔记标题；没单独设时展示 title）。 */
  cards_title?: string | null;
  content: unknown; // TipTap 富文本 JSON
  content_text: string | null; // 纯文本，供搜索 / 粘贴识别
  source_type: string | null;
  /** 置顶：在列表里浮到该文件夹（或全部笔记）顶部。库可能还没加该列，故可选。 */
  pinned?: boolean;
  /** 这篇笔记已生成的闪卡数（列表里显示小标识用）；库查询时统计，非表字段。 */
  cardCount?: number;
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
  lang: string | null; // 卡片语言（thai/korean/chinese/japanese/other）；转卡时自动判断，可手动改
  reading: string | null; // 日语生词读音（JSON 字符串存 text+reading 分段）；背诵/卡片在汉字上方标假名
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
  /** 该笔记下「待学」的卡数（没背过的 + 背过但已到期的），闪卡合集卡显示「待学 N 张」用。 */
  due: number;
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
  /** 每次进背诵默认随机顺序（开关默认关，进会话也可临时切回）。 */
  review_shuffle: boolean;
  recognition_rules: RecognitionRules | null;
  /** 用户隐藏（删除）的内置词群主题 key（如 "food"），这些主题不再出现在词群页。 */
  hidden_themes: string[];
  /** AI 模型选择（每任务一个）：null=用环境默认。text='claude'|'deepseek'，speech='groq'|'openai'，vision='claude'|'openai'。 */
  ai_text_provider: string | null;
  ai_speech_provider: string | null;
  ai_vision_provider: string | null;
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

/** 素材库素材的一条状态：待处理 / 已导入。 */
export type MaterialStatus = "pending" | "imported";

/** 素材类型：可内嵌的媒体（youtube/audio/spotify）+ 链接/播客 + 文件/AI 生成。 */
export type MaterialType =
  | "youtube"
  | "audio"
  | "spotify"
  | "link"
  | "podcast"
  | "file"
  | "generated";

/** 素材类型的中文标签（筛选 chips / 徽章 / 预览提示共用）。 */
export const MATERIAL_TYPE_LABEL: Record<MaterialType, string> = {
  youtube: "视频",
  audio: "音频",
  spotify: "音乐",
  link: "文章",
  podcast: "播客",
  file: "文件",
  generated: "AI",
};

/** 用户自建素材合集（照 WordTheme：无 updated_at）。带可选的语言/类型定义标签（不设则按素材兜底）。 */
export type MaterialCollection = {
  id: string;
  user_id: string;
  name: string;
  /** 合集定义的语言标签（如 "japanese"）；null = 未设置，筛选时按里面素材的语言兜底。 */
  lang: string | null;
  /** 合集定义的类型标签（如 "youtube"/"podcast"）；null = 未设置，按素材类型兜底。 */
  type: MaterialType | null;
  created_at: string;
};

/** 一条素材（照 Card：带 updated_at）。 */
export type Material = {
  id: string;
  url: string;
  type: MaterialType;
  title: string;
  source: string | null;
  thumbnail: string | null;
  lang: string | null;
  status: MaterialStatus;
  note_id: string | null;
  collection_id: string | null;
  /** AI 生成 / 网页文章提取的正文原文（转成笔记时用；普通素材为 null）。 */
  content: string | null;
  /** 上传文件素材的子类：audio / image / doc。 */
  file_kind: string | null;
  created_at: string;
  updated_at: string;
};

/** 带所属笔记标题的素材（素材库列表用，照 CardWithNote）。 */
export type MaterialWithNote = Material & { note_title: string | null };

/** 一篇笔记「来自」的素材（反向：materials.note_id → 该笔记）。用于笔记页回标来源；一篇笔记可导入多条素材。 */
export type SourceMaterial = {
  id: string;
  title: string | null;
  url: string;
};

/** 导入到笔记时的附加载荷：把素材的哪一部分作为笔记内容写入。
 *  - articleText：AI 生成 / 网页文章抽出的正文 → 包成「原文」callout 写入（可被 AI 精读、转卡时跳过）。
 *  - audioUrl/audioTitle：播客选定某集后，用该集的音频直链内嵌（覆盖素材自身的 url/type）。
 *  - title：新建笔记时用这个标题（缺省用素材标题，如文章提取出的页面标题）。 */
export type MaterialImportExtra = {
  articleText?: string;
  title?: string;
  audioUrl?: string;
  audioTitle?: string;
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
