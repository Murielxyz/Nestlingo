// 服务端读数据用的函数（只在 Server Component 里调用）。
// 写操作在对应的客户端组件里，用 client.ts 的 createClient() 直接做，做完 router.refresh()。

import { createClient } from "./server";
import type {
  Folder,
  Note,
  Card,
  CardWithNote,
  CardFolderGroup,
  ReviewState,
  ReviewStats,
  CollectionSummary,
  UserSettings,
  WordTheme,
  Material,
  MaterialWithNote,
  MaterialCollection,
  SourceMaterial,
} from "@/lib/types";
import { themeOf } from "@/lib/word-themes";
import { detectLang, cardLang } from "@/lib/lang-detect";

/** 待复习的一张卡 + 它已有的复习状态（没复习过为 null）。 */
export type ReviewItem = {
  card: Card;
  state: ReviewState | null;
};

/** 从任何被抛出的值里尽力抠出一个可读的字符串（Supabase 的错误常是普通对象，不是 Error 实例）。 */
function extractErrorMessage(err: unknown): string {
  if (err instanceof Error) return err.message;
  if (err && typeof err === "object") {
    const obj = err as Record<string, unknown>;
    if (typeof obj.message === "string" && obj.message) return obj.message;
    if (typeof obj.error === "string" && obj.error) return obj.error;
    if (typeof obj.details === "string" && obj.details) return obj.details;
    if (typeof obj.hint === "string" && obj.hint) return obj.hint;
    try {
      const s = JSON.stringify(err);
      if (s && s !== "{}") return s;
    } catch {
      // 忽略 JSON 序列化失败，走最后的兜底
    }
  }
  return String(err);
}

/** 把 Supabase 的错误翻译成给用户看的人话。 */
export function friendlyQueryError(err: unknown): string {
  const obj = err && typeof err === "object" ? (err as Record<string, unknown>) : null;
  const code = typeof obj?.code === "string" ? obj.code : "";
  const msg = extractErrorMessage(err);
  // 表不存在：schema.sql 还没跑（code 42P01 / PGRST205 = schema cache 里找不到表）
  if (/table|relation|schema cache|42P01|PGRST205/i.test(`${code} ${msg}`)) {
    return "数据库表还没建：请在 Supabase 控制台运行 schema.sql（SQL Editor → New query → 粘贴运行）。";
  }
  // 网络问题：连不上 Supabase
  if (/fetch|network|failed|timeout|abort|ECONN|ENOTFOUND|ERR_SOCKET/i.test(msg)) {
    return "连不上 Supabase 服务器（网络问题）。请稍后重试。";
  }
  return `读取失败：${msg}`;
}

export async function listFolders(): Promise<Folder[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("folders")
    .select("id, name, parent_id, position, color, created_at, updated_at")
    .order("position", { ascending: true })
    .order("created_at", { ascending: true });
  if (error) throw error;
  return (data ?? []) as Folder[];
}

/** 列出笔记；传 folderId 则只看某个文件夹里的。 */
export async function listNotes(folderId?: string | null): Promise<Note[]> {
  const supabase = await createClient();
  let query = supabase
    .from("notes")
    .select("id, folder_id, title, content_text, source_type, created_at, updated_at")
    // 卡片文件（「添加闪卡」生成的空笔记）只在卡片页/复习页出现，不在笔记列表里占位
    .is("source_type", null)
    .order("updated_at", { ascending: false });
  if (folderId) {
    query = query.eq("folder_id", folderId);
  }
  const { data, error } = await query;
  if (error) throw error;
  return (data ?? []) as Note[];
}

export async function getNote(id: string): Promise<Note | null> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("notes")
    .select("*")
    .eq("id", id)
    .single();
  if (error) return null;
  return data as Note;
}

export async function getFolder(id: string): Promise<Folder | null> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("folders")
    .select("*")
    .eq("id", id)
    .single();
  if (error) return null;
  return data as Folder;
}

export async function listCards(noteId: string): Promise<Card[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("cards")
    .select("*")
    .eq("note_id", noteId)
    .order("position", { ascending: true })
    .order("created_at", { ascending: true });
  if (error) throw error;
  return (data ?? []) as Card[];
}

/** 单张卡片 + 它所属笔记的标题（单卡详情页用）。没有这张卡返回 null。 */
export async function getCard(id: string): Promise<CardWithNote | null> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("cards")
    .select("*")
    .eq("id", id)
    .single();
  if (error || !data) return null;

  let note_title: string | null = null;
  if (data.note_id) {
    const { data: n } = await supabase
      .from("notes")
      .select("title")
      .eq("id", data.note_id)
      .single();
    note_title = n?.title ?? null;
  }
  return { ...(data as Card), note_title };
}

/** 不挂在任何笔记下的独立闪卡（「添加闪卡」从任意文本生成）。 */
export async function listOrphanCards(): Promise<Card[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("cards")
    .select("*")
    .is("note_id", null)
    .order("created_at", { ascending: false });
  if (error) throw error;
  return (data ?? []) as Card[];
}

/**
 * 从一组卡片里挑出占比最高的语言。优先用已存储的 `card.lang`（用户可修正），没存过的才动态检测。
 * 中文与日语共用汉字：纯汉字日语词（日本語 / 勉強）会被 detectLang 误判成中文。
 * 因此当「正面表决=中文」这种有歧义时，用笔记正文 contentText 二次确认是否其实是日语
 * （正文含假名 / 助词 / 句子，比单个纯汉字词可靠）；泰 / 韩 / 假名脚本唯一，正面表决即准，
 * 不做改写以免把外来文本带偏；正面完全测不出（全 other）时用正文兜底。
 */
function dominantLang(
  cards: { front: string; back?: string | null; lang?: string | null }[],
  contentText?: string | null
): string {
  const counts = new Map<string, number>();
  for (const card of cards) {
    const l = cardLang(card);
    counts.set(l, (counts.get(l) ?? 0) + 1);
  }
  let best = "other";
  let bestCount = -1;
  for (const [l, n] of counts) {
    if (l === "other") continue;
    if (n > bestCount) {
      best = l;
      bestCount = n;
    }
  }
  if (!contentText) return best;
  const whole = detectLang(contentText);
  if (best === "chinese" && whole === "japanese") return "japanese";
  if (best === "other") return whole === "other" ? "other" : whole;
  return best;
}

/** 卡片页的分组索引：把卡片按「文件夹 → 笔记」聚合，返回每个笔记下的卡片数 + 主要语言。 */
export async function listCardGroups(): Promise<CardFolderGroup[]> {
  const supabase = await createClient();

  // 1. 挂在笔记下的卡片，数出每个 note_id 有几张，并记下正/反面 + 已存的 lang 用来判断主要语言
  const { data: cardRows, error: err1 } = await supabase
    .from("cards")
    .select("note_id, front, back, lang")
    .not("note_id", "is", null);
  if (err1) throw err1;

  const counts = new Map<string, number>();
  const cardsByNote = new Map<string, { front: string; back: string | null; lang: string | null }[]>();
  for (const r of cardRows ?? []) {
    const id = r.note_id as string;
    counts.set(id, (counts.get(id) ?? 0) + 1);
    if (!cardsByNote.has(id)) cardsByNote.set(id, []);
    cardsByNote.get(id)!.push({
      front: r.front as string,
      back: (r.back ?? null) as string | null,
      lang: (r.lang ?? null) as string | null,
    });
  }
  const noteIds = Array.from(counts.keys());
  if (noteIds.length === 0) return [];

  // 2. 这些笔记的标题 + 所属文件夹 + 来源类型（区分卡片文件）
  const { data: notes, error: err2 } = await supabase
    .from("notes")
    .select("id, title, folder_id, source_type, content_text")
    .in("id", noteIds);
  if (err2) throw err2;

  // 3. 涉及的文件夹名
  const folderIds = Array.from(
    new Set(
      (notes ?? [])
        .map((n) => n.folder_id)
        .filter((x): x is string => Boolean(x))
    )
  );
  const folderNameMap = new Map<string, string>();
  if (folderIds.length > 0) {
    const { data: folders, error: err3 } = await supabase
      .from("folders")
      .select("id, name")
      .in("id", folderIds);
    if (err3) throw err3;
    for (const f of folders ?? []) folderNameMap.set(f.id, f.name);
  }

  // 分组：folder → notes
  const folderMap = new Map<string, CardFolderGroup>();
  for (const n of notes ?? []) {
    const key = n.folder_id ?? "__none__";
    if (!folderMap.has(key)) {
      folderMap.set(key, {
        folderId: n.folder_id,
        folderName: n.folder_id ? (folderNameMap.get(n.folder_id) ?? "") : "未分类",
        notes: [],
      });
    }
    folderMap.get(key)!.notes.push({
      noteId: n.id,
      title: n.title,
      count: counts.get(n.id) ?? 0,
      sourceType: n.source_type ?? null,
      lang: dominantLang(cardsByNote.get(n.id) ?? [], n.content_text),
    });
  }

  // 有文件夹的按名排序，「未分类」放最后。
  return Array.from(folderMap.values()).sort((a, b) => {
    if (a.folderId === null) return 1;
    if (b.folderId === null) return -1;
    return a.folderName.localeCompare(b.folderName, "zh");
  });
}

/**
 * 列出「今天到期」的复习卡片（没复习过的也一律算到期）。
 * 传 noteId 只看某篇笔记的卡。数据量小，到期判断放在 JS 里做。
 */
export async function listReviewCards(
  noteId: string | null,
  kind?: string | null
): Promise<ReviewItem[]> {
  const supabase = await createClient();

  let q = supabase
    .from("cards")
    .select("*")
    .order("position", { ascending: true })
    .order("created_at", { ascending: true });
  // noteId 为空 = 只看独立闪卡（不挂任何笔记）；否则只看某篇笔记
  if (noteId) q = q.eq("note_id", noteId);
  else q = q.is("note_id", null);

  const { data: cards, error: err1 } = await q;
  if (err1) throw err1;
  if (!cards?.length) return [];

  const cardIds = cards.map((c) => c.id);
  const { data: states, error: err2 } = await supabase
    .from("review_state")
    .select("*")
    .in("card_id", cardIds);
  if (err2) throw err2;

  const stateMap = new Map<string, ReviewState>();
  for (const s of states ?? []) stateMap.set(s.card_id, s as ReviewState);

  const now = Date.now();
  // kind 为空 = 复习这个合集的全部卡（普通 / 生词 / 例句 / 语法都算，用户点「开始背诵」期望把整篇都过一遍）；
  // 指定 kind 时只看那一种。改前 kind 为空只放行「普通卡」(!c.kind)，导致笔记转卡后全是 word/example/grammar，
  // 点「开始背诵」一张都匹配不到 → 误显示「都复习完了」。
  const kindMatches = (c: Card) => (kind ? c.kind === kind : true);
  return (cards as Card[])
    .filter((c) => {
      const s = stateMap.get(c.id);
      if (!s) return true; // 没复习过 → 待复习
      return new Date(s.due_at).getTime() <= now;
    })
    .filter(kindMatches)
    .map((c) => ({ card: c, state: stateMap.get(c.id) ?? null }));
}

/** 待复习的一个「文件」（笔记 + 类别）及它的到期卡片数。noteId 为空表示独立闪卡。 */
export type DueFile = {
  noteId: string | null;
  kind: string | null;
  title: string;
  count: number;
};

/**
 * 复习页的「文件列表」（Anki 式）：
 * 把所有到期卡片按「所属笔记 + 类别（生词/例句/普通）」分组，
 * 返回每个文件待复习的张数，不融合在一起。
 */
export async function listDueFiles(): Promise<DueFile[]> {
  const supabase = await createClient();

  const { data: cards, error: err1 } = await supabase.from("cards").select("*");
  if (err1) throw err1;
  if (!cards?.length) return [];

  const cardIds = cards.map((c) => c.id);
  const { data: states, error: err2 } = await supabase
    .from("review_state")
    .select("*")
    .in("card_id", cardIds);
  if (err2) throw err2;

  const stateMap = new Map<string, ReviewState>();
  for (const s of states ?? []) stateMap.set(s.card_id, s as ReviewState);

  const now = Date.now();
  const byKey = new Map<
    string,
    { noteId: string | null; kind: string | null; count: number }
  >();
  for (const c of cards as Card[]) {
    const s = stateMap.get(c.id);
    if (!s || new Date(s.due_at).getTime() <= now) {
      const kind = c.kind ?? null;
      const key = `${c.note_id ?? "orphans"}::${kind ?? ""}`;
      const e = byKey.get(key);
      if (e) e.count += 1;
      else byKey.set(key, { noteId: c.note_id ?? null, kind, count: 1 });
    }
  }

  const noteIds = Array.from(byKey.values())
    .map((e) => e.noteId)
    .filter((x): x is string => Boolean(x));
  const titleMap = new Map<string, string>();
  if (noteIds.length > 0) {
    const { data: notes, error: err3 } = await supabase
      .from("notes")
      .select("id, title")
      .in("id", noteIds);
    if (err3) throw err3;
    for (const n of notes ?? []) titleMap.set(n.id, n.title);
  }

  const files: DueFile[] = [];
  for (const e of byKey.values()) {
    const base =
      e.noteId === null ? "独立闪卡" : (titleMap.get(e.noteId) ?? "无标题");
    const suffix =
      e.kind === "word" ? "生词" : e.kind === "example" ? "例句" : e.kind === "grammar" ? "语法" : "";
    files.push({
      noteId: e.noteId,
      kind: e.kind,
      title: suffix ? `${base} · ${suffix}` : base,
      count: e.count,
    });
  }
  return files.sort((a, b) => b.count - a.count);
}

/** 读用户设置；没存过就返回默认值（每日目标默认 20 张）。 */
export async function getUserSettings(): Promise<UserSettings> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("user_settings")
    .select(
      "daily_goal, reminder_enabled, reminder_time, recognition_rules, hidden_themes, ai_text_provider, ai_speech_provider, ai_vision_provider"
    )
    .limit(1)
    .maybeSingle();
  if (error) throw error;
  return {
    daily_goal: data?.daily_goal ?? 20,
    reminder_enabled: data?.reminder_enabled ?? false,
    reminder_time: data?.reminder_time ?? null,
    recognition_rules: (data?.recognition_rules ?? null) as UserSettings["recognition_rules"],
    hidden_themes: (data?.hidden_themes ?? []) as string[],
    ai_text_provider: (data?.ai_text_provider ?? null) as string | null,
    ai_speech_provider: (data?.ai_speech_provider ?? null) as string | null,
    ai_vision_provider: (data?.ai_vision_provider ?? null) as string | null,
  };
}

/** 只读当前用户的 AI 模型选择（三个任务各自的 provider），给 AI lib 内部路由用。
 *  没录/出错都返回 null 三个，让调用方落回环境默认。 */
export async function getUserAiProviders(): Promise<{
  text: string | null;
  speech: string | null;
  vision: string | null;
}> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("user_settings")
    .select("ai_text_provider, ai_speech_provider, ai_vision_provider")
    .limit(1)
    .maybeSingle();
  return {
    text: (data?.ai_text_provider ?? null) as string | null,
    speech: (data?.ai_speech_provider ?? null) as string | null,
    vision: (data?.ai_vision_provider ?? null) as string | null,
  };
}

/** 用户自定义词群分类（新建时间在前）。 */
export async function listWordThemes(): Promise<WordTheme[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("word_themes")
    .select("*")
    .order("created_at", { ascending: true });
  if (error) throw error;
  return (data ?? []) as WordTheme[];
}

// ============================================================
// 复习页：统计 / 合集选择 / 待加强
// ============================================================

/** 复习总览：统计 + 可选合集 + 待加强的卡。 */
export type ReviewOverview = {
  stats: ReviewStats;
  collections: CollectionSummary[];
  weakCards: ReviewItem[];
};

const KIND_SUFFIX = (k: string | null) =>
  k === "word" ? "生词" : k === "example" ? "例句" : k === "grammar" ? "语法" : "";

/** 所有卡片（综合测试用）。 */
export async function listAllCards(): Promise<Card[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("cards")
    .select("*")
    .order("created_at", { ascending: true });
  if (error) throw error;
  return (data ?? []) as Card[];
}

/** 所有「到期」的卡（没背过的 + due_at 已到），跨全部笔记/独立卡。故事模式挑生词用。 */
export async function listDueCardsAll(): Promise<ReviewItem[]> {
  const supabase = await createClient();
  const [cardsRes, statesRes] = await Promise.all([
    supabase.from("cards").select("*"),
    supabase.from("review_state").select("*"),
  ]);
  if (cardsRes.error) throw cardsRes.error;
  if (statesRes.error) throw statesRes.error;
  const stateMap = new Map<string, ReviewState>();
  for (const s of statesRes.data ?? []) stateMap.set(s.card_id, s as ReviewState);
  const now = Date.now();
  return ((cardsRes.data ?? []) as Card[])
    .filter((c) => {
      const s = stateMap.get(c.id);
      if (!s) return true;
      return new Date(s.due_at).getTime() <= now;
    })
    .map((c) => ({ card: c, state: stateMap.get(c.id) ?? null }));
}

/** 某个合集（笔记 + 类别，或独立闪卡）里的全部卡片。noteId 为 null 表示独立闪卡。 */
export async function listCollectionCards(
  noteId: string | null,
  kind: string | null
): Promise<Card[]> {
  const supabase = await createClient();
  let q = supabase
    .from("cards")
    .select("*")
    .order("position", { ascending: true })
    .order("created_at", { ascending: true });
  if (noteId) q = q.eq("note_id", noteId);
  else q = q.is("note_id", null);
  if (kind) q = q.eq("kind", kind);
  const { data, error } = await q;
  if (error) throw error;
  return (data ?? []) as Card[];
}

/** 待加强的卡：上次答错（评分 ≤2）或多次忘记（lapses>0 且间隔很短），按最不熟排前。 */
export async function listWeakCards(): Promise<ReviewItem[]> {
  const supabase = await createClient();
  const [cardsRes, statesRes] = await Promise.all([
    supabase.from("cards").select("*"),
    supabase.from("review_state").select("*"),
  ]);
  if (cardsRes.error) throw cardsRes.error;
  if (statesRes.error) throw statesRes.error;
  const stateMap = new Map<string, ReviewState>();
  for (const s of statesRes.data ?? []) stateMap.set(s.card_id, s as ReviewState);
  return ((cardsRes.data ?? []) as Card[])
    .filter((c) => {
      const s = stateMap.get(c.id);
      if (!s) return false;
      return (s.last_rating ?? 0) <= 2 || (s.lapses > 0 && s.interval_days < 7);
    })
    .sort((a, b) => {
      const sa = stateMap.get(a.id)!;
      const sb = stateMap.get(b.id)!;
      return (sa.last_rating ?? 0) - (sb.last_rating ?? 0) || sb.lapses - sa.lapses;
    })
    .map((c) => ({ card: c, state: stateMap.get(c.id) ?? null }));
}

/** 测试错题集的卡（最近选错的排前），附上复习状态供「开始背」用。 */
export async function listTestErrors(): Promise<ReviewItem[]> {
  const supabase = await createClient();
  const { data: errs, error: e1 } = await supabase
    .from("test_errors")
    .select("card_id")
    .order("updated_at", { ascending: false });
  if (e1) throw e1;
  const cardIds = (errs ?? []).map((e) => e.card_id as string);
  if (cardIds.length === 0) return [];
  const { data: cards, error: e2 } = await supabase
    .from("cards")
    .select("*")
    .in("id", cardIds);
  if (e2) throw e2;
  const cardMap = new Map<string, Card>();
  for (const c of cards ?? []) cardMap.set(c.id, c as Card);
  const ordered = cardIds
    .map((id) => cardMap.get(id))
    .filter((c): c is Card => Boolean(c));
  const { data: states } = await supabase
    .from("review_state")
    .select("*")
    .in("card_id", ordered.map((c) => c.id));
  const stateMap = new Map<string, ReviewState>();
  for (const s of states ?? []) stateMap.set(s.card_id, s as ReviewState);
  return ordered.map((c) => ({ card: c, state: stateMap.get(c.id) ?? null }));
}

/** 复习总览：统计 + 合集 + 待加强。 */
export async function getReviewOverview(): Promise<ReviewOverview> {
  const supabase = await createClient();
  const [cardsRes, statesRes, notesRes] = await Promise.all([
    supabase.from("cards").select("*"),
    supabase.from("review_state").select("*"),
    supabase.from("notes").select("id, title"),
  ]);
  if (cardsRes.error) throw cardsRes.error;
  if (statesRes.error) throw statesRes.error;
  if (notesRes.error) throw notesRes.error;

  const cards = (cardsRes.data ?? []) as Card[];
  const states = (statesRes.data ?? []) as ReviewState[];
  const notes = (notesRes.data ?? []) as { id: string; title: string }[];

  const stateMap = new Map<string, ReviewState>();
  for (const s of states) stateMap.set(s.card_id, s);
  const noteMap = new Map<string, string>();
  for (const n of notes) noteMap.set(n.id, n.title);

  const now = Date.now();
  const dayStart = (offset: number) => {
    const d = new Date();
    d.setHours(0, 0, 0, 0);
    d.setDate(d.getDate() + offset);
    return d.getTime();
  };
  const todayStart = dayStart(0);

  let reviewed = 0;
  let due = 0;
  let mastered = 0;
  let weak = 0;
  let todayReviewed = 0;
  for (const c of cards) {
    const s = stateMap.get(c.id);
    if (!s) {
      due++; // 没背过的卡视为「待复习」——与下方各合集 due、listReviewCards 口径一致
      continue; // 但仍不计入已复习/已掌握/待加强
    }
    reviewed++;
    if (new Date(s.due_at).getTime() <= now) due++;
    if (s.interval_days >= 21 || (s.reps >= 3 && (s.last_rating ?? 0) >= 3)) mastered++;
    if ((s.last_rating ?? 0) <= 2 || (s.lapses > 0 && s.interval_days < 7)) weak++;
    if (new Date(s.updated_at).getTime() >= todayStart) todayReviewed++;
  }

  const recentDays: { label: string; count: number }[] = [];
  for (let i = 6; i >= 0; i--) {
    const start = dayStart(-i);
    const end = start + 86400000;
    let count = 0;
    for (const s of states) {
      const t = new Date(s.updated_at).getTime();
      if (t >= start && t < end) count++;
    }
    const d = new Date(start);
    recentDays.push({ label: `${d.getMonth() + 1}/${d.getDate()}`, count });
  }

  // 合集：按 (note_id, kind) 分组，统计总数与到期数，并记下最近复习时间。
  const groupMap = new Map<
    string,
    { noteId: string | null; kind: string | null; total: number; due: number; lastReviewedAt: number }
  >();
  for (const c of cards) {
    const key = `${c.note_id ?? "orphans"}::${c.kind ?? ""}`;
    let g = groupMap.get(key);
    if (!g) {
      g = { noteId: c.note_id ?? null, kind: c.kind ?? null, total: 0, due: 0, lastReviewedAt: 0 };
      groupMap.set(key, g);
    }
    g.total++;
    const s = stateMap.get(c.id);
    if (!s || new Date(s.due_at).getTime() <= now) g.due++;
    if (s) {
      const t = new Date(s.updated_at).getTime();
      if (t > g.lastReviewedAt) g.lastReviewedAt = t;
    }
  }
  const collections: CollectionSummary[] = Array.from(groupMap.values())
    .map((g) => {
      const base = g.noteId === null ? "独立闪卡" : (noteMap.get(g.noteId) ?? "无标题");
      const suffix = KIND_SUFFIX(g.kind);
      return {
        key: `${g.noteId ?? "orphans"}::${g.kind ?? ""}`,
        noteId: g.noteId,
        kind: g.kind,
        title: suffix ? `${base} · ${suffix}` : base,
        total: g.total,
        due: g.due,
        lastReviewedAt: g.lastReviewedAt > 0 ? g.lastReviewedAt : null,
      };
    })
    .sort((a, b) => b.due - a.due || b.total - a.total);

  const weakCards: ReviewItem[] = cards
    .filter((c) => {
      const s = stateMap.get(c.id);
      if (!s) return false;
      return (s.last_rating ?? 0) <= 2 || (s.lapses > 0 && s.interval_days < 7);
    })
    .sort((a, b) => {
      const sa = stateMap.get(a.id)!;
      const sb = stateMap.get(b.id)!;
      return (sa.last_rating ?? 0) - (sb.last_rating ?? 0) || sb.lapses - sa.lapses;
    })
    .slice(0, 12)
    .map((c) => ({ card: c, state: stateMap.get(c.id) ?? null }));

  return {
    stats: {
      totalCards: cards.length,
      reviewed,
      due,
      mastered,
      weak,
      todayReviewed,
      recentDays,
    },
    collections,
    weakCards,
  };
}

/** 所有「可归类到词群主题」的卡（生词 + 例句，含所属笔记标题）。
 *  词群页按主题分组用；现在生词、例句都按主题一起归，不再分成两类。 */
export async function listWordCards(): Promise<CardWithNote[]> {
  const supabase = await createClient();
  const { data: cards, error } = await supabase
    .from("cards")
    .select("*")
    .in("kind", ["word", "example"])
    .order("position", { ascending: true })
    .order("created_at", { ascending: true });
  if (error) throw error;

  const noteIds = Array.from(
    new Set(
      (cards ?? [])
        .map((c) => c.note_id)
        .filter((x): x is string => Boolean(x))
    )
  );
  const titleMap = new Map<string, string>();
  if (noteIds.length > 0) {
    const { data: notes } = await supabase
      .from("notes")
      .select("id, title")
      .in("id", noteIds);
    for (const n of notes ?? []) titleMap.set(n.id, n.title);
  }

  return (cards ?? []).map((c) => {
    const card = c as Card;
    return {
      ...card,
      note_title: card.note_id ? titleMap.get(card.note_id) ?? null : null,
    };
  });
}

/** 某个主题下的全部卡（生词 + 例句，测试用，不过滤到期）。 */
export async function listThemeCards(themeKey: string): Promise<Card[]> {
  const supabase = await createClient();
  const [cardsRes, themesRes] = await Promise.all([
    supabase
      .from("cards")
      .select("*")
      .in("kind", ["word", "example"])
      .order("position", { ascending: true })
      .order("created_at", { ascending: true }),
    supabase.from("word_themes").select("*"),
  ]);
  if (cardsRes.error) throw cardsRes.error;
  const userThemes = (themesRes.data ?? []) as WordTheme[];
  return ((cardsRes.data ?? []) as Card[]).filter(
    (c) => themeOf(c, userThemes) === themeKey
  );
}

/** 某个主题下「到期」的卡（生词 + 例句）+ 复习状态（背诵用，跟按笔记背诵同规则）。 */
export async function listThemeReviewItems(themeKey: string): Promise<ReviewItem[]> {
  const supabase = await createClient();
  const [cardsRes, themesRes] = await Promise.all([
    supabase
      .from("cards")
      .select("*")
      .in("kind", ["word", "example"])
      .order("position", { ascending: true })
      .order("created_at", { ascending: true }),
    supabase.from("word_themes").select("*"),
  ]);
  if (cardsRes.error) throw cardsRes.error;
  const userThemes = (themesRes.data ?? []) as WordTheme[];

  const matched = ((cardsRes.data ?? []) as Card[]).filter(
    (c) => themeOf(c, userThemes) === themeKey
  );
  if (matched.length === 0) return [];

  const cardIds = matched.map((c) => c.id);
  const { data: states, error: err2 } = await supabase
    .from("review_state")
    .select("*")
    .in("card_id", cardIds);
  if (err2) throw err2;
  const stateMap = new Map<string, ReviewState>();
  for (const s of states ?? []) stateMap.set(s.card_id, s as ReviewState);

  const now = Date.now();
  return matched
    .filter((c) => {
      const s = stateMap.get(c.id);
      if (!s) return true; // 没复习过 → 待复习
      return new Date(s.due_at).getTime() <= now;
    })
    .map((c) => ({ card: c, state: stateMap.get(c.id) ?? null }));
}

// ============================================================
// 素材库：素材 + 素材合集
// ============================================================

/** 所有素材合集（新建时间在前），照 listWordThemes。 */
export async function listMaterialCollections(): Promise<MaterialCollection[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("material_collections")
    .select("*")
    .order("created_at", { ascending: true });
  if (error) throw error;
  return (data ?? []) as MaterialCollection[];
}

/** 所有素材（时间倒序），并带上所属笔记标题（照 listWordCards 的 titleMap 合并）。 */
export async function listMaterials(): Promise<MaterialWithNote[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("materials")
    .select("*")
    .order("created_at", { ascending: false });
  if (error) throw error;
  const rows = (data ?? []) as Material[];

  const noteIds = Array.from(
    new Set(
      rows
        .map((m) => m.note_id)
        .filter((x): x is string => Boolean(x))
    )
  );
  const titleMap = new Map<string, string>();
  if (noteIds.length > 0) {
    const { data: notes } = await supabase
      .from("notes")
      .select("id, title")
      .in("id", noteIds);
    for (const n of notes ?? []) titleMap.set(n.id, n.title);
  }
  return rows.map((m) => ({
    ...m,
    note_title: m.note_id ? titleMap.get(m.note_id) ?? null : null,
  }));
}

/** 找出这篇笔记「来自」的素材（反向：materials.note_id → 该笔记）。失败返回空数组，不打断打开笔记。 */
export async function listSourceMaterials(noteId: string): Promise<SourceMaterial[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("materials")
    .select("id,title,url")
    .eq("note_id", noteId)
    .order("created_at", { ascending: true })
    .limit(10);
  if (error) return [];
  return (data ?? []) as SourceMaterial[];
}

/** 单条素材。没有返回 null（照 getCard 的容错）。 */
export async function getMaterial(id: string): Promise<Material | null> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("materials")
    .select("*")
    .eq("id", id)
    .single();
  if (error || !data) return null;
  return data as Material;
}

/** 单个素材合集。没有返回 null。 */
export async function getMaterialCollection(id: string): Promise<MaterialCollection | null> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("material_collections")
    .select("*")
    .eq("id", id)
    .single();
  if (error || !data) return null;
  return data as MaterialCollection;
}

/** 某个合集下的全部素材（时间倒序），带所属笔记标题（照 listMaterials 合并）。 */
export async function listMaterialsByCollection(
  collectionId: string
): Promise<MaterialWithNote[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("materials")
    .select("*")
    .eq("collection_id", collectionId)
    .order("created_at", { ascending: false });
  if (error) throw error;
  const rows = (data ?? []) as Material[];

  const noteIds = Array.from(
    new Set(
      rows
        .map((m) => m.note_id)
        .filter((x): x is string => Boolean(x))
    )
  );
  const titleMap = new Map<string, string>();
  if (noteIds.length > 0) {
    const { data: notes } = await supabase
      .from("notes")
      .select("id, title")
      .in("id", noteIds);
    for (const n of notes ?? []) titleMap.set(n.id, n.title);
  }
  return rows.map((m) => ({
    ...m,
    note_title: m.note_id ? titleMap.get(m.note_id) ?? null : null,
  }));
}
