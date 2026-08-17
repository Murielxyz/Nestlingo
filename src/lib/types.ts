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
};
export type CardFolderGroup = {
  folderId: string | null;
  folderName: string;
  notes: CardNoteGroup[];
};

/** 用户设置（每日复习目标、复习提醒）。 */
export type UserSettings = {
  daily_goal: number;
  reminder_enabled: boolean;
  reminder_time: string | null;
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

/** 媒体学习条目：一段 YouTube 视频或一段音频，可转录成文字稿再生成精读笔记。 */
export type MediaItem = {
  id: string;
  user_id: string;
  title: string;
  source_url: string;
  kind: string; // 'youtube' | 'audio'
  embed_url: string | null;
  thumbnail: string | null;
  transcript: string | null;
  note_id: string | null;
  created_at: string;
  updated_at: string;
};
