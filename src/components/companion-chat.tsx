"use client";

// 语伴会话页：全屏对话（文字 + 语音），AI 自由回答语言问题。
// - 会话持久：存 localStorage，退出再进恢复（用于「复制一篇文章做双语翻译、中途复制粘贴一部分到别处再回来」）。
// - 顶部「清空会话」：聊完一键清空当前会话，不动已收藏项。
// - 每条 AI 回复带「收藏」+「导入笔记」；收藏进 assistant_records / materials，导入笔记用 pointsToNoteContent 追加。
// - 头部「收藏」入口进收藏页。

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  Sparkles,
  Send,
  Mic,
  Square,
  Loader2,
  Heart,
  FilePlus2,
  Trash2,
  ImagePlus,
  Layers,
} from "lucide-react";
import type { AssistantPoint } from "@/lib/ai-note";
import { detectCardLang } from "@/lib/lang-detect";
import { useVoiceToText } from "@/lib/use-voice-to-text";
import {
  collectTextRecord,
  collectMediaRecord,
  appendNodesToNote,
  pointsToBlocks,
  findMediaUrl,
  markRecordNote,
  deleteRecord,
} from "@/lib/supabase/assistant";
import { createClient } from "@/lib/supabase/client";
import { parseMediaUrl } from "@/lib/media";
import { PointsPreview } from "./points-preview";

type ChatMessage = {
  role: "user" | "assistant";
  content: string;
  points?: AssistantPoint[];
  favorited?: boolean;
  recordId?: string;
  transcript?: { title: string; text: string };
};

// 识别「发来的媒体链接」：整条消息就是一个 YouTube / 音频直链 → 直接生成逐字稿。
const YT_RE =
  /^(?:https?:\/\/)?(?:www\.)?(?:youtube\.com\/(?:watch\?(?:[^#]*&)?v=|shorts\/|live\/|embed\/)|youtu\.be\/)[\w-]{11}/;
const AUDIO_RE = /^https?:\/\/.+\.(mp3|m4a|aac|wav|ogg|oga|opus|flac)(\?.*)?$/i;
function looksLikeMediaLink(t: string): boolean {
  const s = t.trim();
  return YT_RE.test(s) || AUDIO_RE.test(s);
}

/** 给逐字稿取个真实标题：优先 oEmbed（materials/meta），退了用 parseMediaUrl，再退用占位。 */
async function fetchTitle(url: string): Promise<string> {
  try {
    const res = await fetch("/api/materials/meta", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ url }),
      signal: AbortSignal.timeout(30_000),
    });
    if (res.ok) {
      const d = await res.json();
      if (typeof d?.title === "string" && d.title.trim()) return d.title.trim();
    }
  } catch {
    /* oEmbed 失败就退回 parseMediaUrl */
  }
  const parsed = parseMediaUrl(url);
  if (parsed?.title) return parsed.title;
  return "转录内容";
}

const STORAGE_KEY = "nestlingo:companion";
const TOOL_BTN =
  "inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-lg text-zinc-400 transition-colors hover:bg-zinc-100 hover:text-zinc-600";
const LANGS = [
  { key: "", label: "自动识别" },
  { key: "ko", label: "韩语" },
  { key: "th", label: "泰语" },
  { key: "ja", label: "日语" },
  { key: "en", label: "英语" },
  { key: "es", label: "西班牙语" },
];

function loadMessages(): ChatMessage[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed?.messages) ? parsed.messages : [];
  } catch {
    return [];
  }
}

export function CompanionChat() {
  const router = useRouter();
  const [messages, setMessages] = useState<ChatMessage[]>(loadMessages);
  const [input, setInput] = useState("");
  const [lang, setLang] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [extracting, setExtracting] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [collecting, setCollecting] = useState<Set<number>>(new Set());
  const listRef = useRef<HTMLDivElement>(null);
  const /* import dialog */ [importIndex, setImportIndex] = useState<number | null>(null);
  const [mode, setMode] = useState<"new" | "existing">("new");
  const [notes, setNotes] = useState<{ id: string; title: string }[]>([]);
  const [loadingNotes, setLoadingNotes] = useState(false);
  const [query, setQuery] = useState("");
  const [importBusy, setImportBusy] = useState(false);

  const voice = useVoiceToText((text) => void sendText(text));

  // 移动端：用 visualViewport 实时跟踪可见高度（键盘弹出会收缩），
  // 让会话页精确铺满可视区，避免 iOS 键盘把标题挤上去 / 底部多出可滚动空隙。
  const [viewportH, setViewportH] = useState<number | null>(null);
  useEffect(() => {
    const vv = window.visualViewport;
    if (!vv) return;
    const update = () => setViewportH(vv.height);
    update();
    vv.addEventListener("resize", update);
    vv.addEventListener("scroll", update);
    return () => {
      vv.removeEventListener("resize", update);
      vv.removeEventListener("scroll", update);
    };
  }, []);

  // 消息变化滚到底部。
  useEffect(() => {
    listRef.current?.scrollTo({ top: listRef.current.scrollHeight });
  }, [messages, busy]);

  // 会话持久化：每次改动写回 localStorage，清空时移除。
  useEffect(() => {
    if (typeof window === "undefined") return;
    try {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify({ messages }));
    } catch {
      /* 忽略（存储已满等） */
    }
  }, [messages]);

  // 「选已有」时载入候选笔记（同 import-material：过滤卡片文件，按最近更新排）。
  useEffect(() => {
    if (mode !== "existing" || notes.length > 0) return;
    setLoadingNotes(true);
    (async () => {
      try {
        const { data } = await createClient()
          .from("notes")
          .select("id, title")
          .is("source_type", null)
          .order("updated_at", { ascending: false });
        setNotes((data ?? []) as { id: string; title: string }[]);
      } catch {
        setNotes([]);
      } finally {
        setLoadingNotes(false);
      }
    })();
  }, [mode, notes.length]);

  const filteredNotes = notes.filter((n) =>
    n.title.toLowerCase().includes(query.trim().toLowerCase())
  );

  /** 找第 i 条 assistant 消息对应的用户提问（它之前最近的一条 user）。 */
  function promptOf(i: number): string {
    for (let j = i - 1; j >= 0; j--) {
      if (messages[j].role === "user") return messages[j].content;
    }
    return "";
  }

  /** 调 AI 给这条回复取一个主题标题（失败退回首行文字）。不再用「用户提问」当标题。 */
  async function titleFor(content: string, fallback: string): Promise<string> {
    try {
      const res = await fetch("/api/ai/title", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ text: content }),
        signal: AbortSignal.timeout(30_000),
      });
      if (res.ok) {
        const d = await res.json();
        const t = typeof d?.title === "string" ? d.title.trim() : "";
        if (t) return t.slice(0, 30);
      }
    } catch {
      /* 失败退回首行 */
    }
    const first = content.split("\n").map((s) => s.trim()).find(Boolean) ?? fallback;
    return (first || fallback).slice(0, 30);
  }

  /** 发来的是媒体链接 → 生成带标题的逐字稿（可一键导入笔记）。 */
  async function sendTranscript(url: string) {
    setBusy(true);
    setError(null);
    setDone(null);
    try {
      const title = await fetchTitle(url);
      const res = await fetch("/api/ai/transcribe", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ url }),
        signal: AbortSignal.timeout(120_000),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data?.error ?? "生成逐字稿失败");
        return;
      }
      const text = typeof data?.text === "string" ? data.text.trim() : "";
      if (!text) {
        setError("没识别到语音 / 字幕内容");
        return;
      }
      setMessages((m) => [
        ...m,
        {
          role: "assistant",
          content: `${title}\n\n${text}`,
          transcript: { title, text },
        },
      ]);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  /** 真正把一段文字发给语伴（文本发送 / 语音直发共用）。 */
  async function sendText(raw: string) {
    const text = raw.trim();
    if (!text || busy) return;
    if (looksLikeMediaLink(text)) {
      setMessages((m) => [...m, { role: "user", content: text }]);
      await sendTranscript(text);
      return;
    }
    const history = messages.map((m) => ({ role: m.role, content: m.content }));
    setMessages((m) => [...m, { role: "user", content: text }]);
    setBusy(true);
    setError(null);
    setDone(null);
    try {
      const res = await fetch("/api/ai/assistant", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ message: text, lang, history }),
        signal: AbortSignal.timeout(90_000),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data?.error ?? "请求失败");
        return;
      }
      setMessages((m) => [
        ...m,
        {
          role: "assistant",
          content: data.reply ?? "",
          points: Array.isArray(data.points) ? data.points : [],
        },
      ]);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  function send() {
    const text = input.trim();
    if (!text || busy) return;
    setInput("");
    void sendText(text);
  }

  /** 收藏 / 取消收藏切换：已收藏 → 删记录并复位（可重新收藏）；未收藏 → 新建收藏记录。 */
  async function collect(i: number) {
    const msg = messages[i];
    if (!msg || msg.role !== "assistant" || collecting.has(i)) return;
    setCollecting((s) => new Set(s).add(i));
    setError(null);
    try {
      // 已收藏 → 取消收藏：同步本地复位（记录可能在收藏夹页已被删，delete 不存在也不会报错，本地仍复位）。
      if (msg.favorited) {
        if (msg.recordId) {
          try {
            await deleteRecord(msg.recordId);
          } catch {
            /* 记录已不存在则忽略，本地照样复位 */
          }
        }
        setMessages((prev) =>
          prev.map((m, mi) => (mi === i ? { ...m, favorited: false, recordId: undefined } : m))
        );
        return;
      }
      // 未收藏 → 收藏：文字进 assistant_records，若带媒体链接则并收一条 materials。
      const prompt = promptOf(i);
      let mediaId: string | null = null;
      const hit = findMediaUrl(`${msg.content}\n${prompt}`);
      if (hit) {
        const id = await collectMediaRecord({
          url: hit.url,
          title: hit.parsed.title,
          type: hit.parsed.kind,
          thumbnail: hit.parsed.thumbnail,
        });
        if (id) mediaId = id;
      }
      const recordId = await collectTextRecord({
        kind: "note",
        prompt,
        reply: msg.content,
        points: msg.points,
        mediaId,
      });
      if (recordId) {
        setMessages((prev) =>
          prev.map((m, mi) => (mi === i ? { ...m, favorited: true, recordId } : m))
        );
      } else {
        setError("收藏失败，请重试");
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setCollecting((s) => {
        const next = new Set(s);
        next.delete(i);
        return next;
      });
    }
  }

  /** 导入这条回复进笔记（新建或选已有）：带逐字稿的收录整篇原文，否则收录知识点。 */
  async function importMsg(i: number, targetNoteId: string | null) {
    const msg = messages[i];
    if (msg?.transcript) {
      setImportBusy(true);
      setError(null);
      try {
        const nodes = [{ type: "paragraph", content: [{ type: "text", text: msg.transcript.text }] }];
        const title = (msg.transcript.title || "语伴逐字稿").slice(0, 40);
        const noteId = await appendNodesToNote({ noteId: targetNoteId, title, nodes });
        if (msg.recordId) await markRecordNote(msg.recordId, noteId);
        setImportIndex(null);
        router.push(`/notes/${noteId}`);
        router.refresh();
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
      } finally {
        setImportBusy(false);
      }
      return;
    }
    const pts = (msg.points ?? []).filter((p) => p.front);
    if (pts.length === 0) {
      setError("这条回复没有可导入的知识点");
      setImportIndex(null);
      return;
    }
    setImportBusy(true);
    setError(null);
    try {
      const nodes = pointsToBlocks(pts);
      const title = await titleFor(msg.content, "语伴导入");
      const noteId = await appendNodesToNote({ noteId: targetNoteId, title, nodes });
      if (msg.recordId) await markRecordNote(msg.recordId, noteId);
      setImportIndex(null);
      router.push(`/notes/${noteId}`);
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setImportBusy(false);
    }
  }

  /** 把这条回复直接生成一个「闪卡合集」（独立闪卡，source_type='cards'），免去先导入笔记再转卡的中间步。 */
  async function generateCards(i: number) {
    const msg = messages[i];
    const pts = (msg.points ?? []).filter((p) => p.front.trim());
    if (pts.length === 0) {
      setError("这条回复没有可生成的知识点");
      return;
    }
    setImportBusy(true);
    setError(null);
    try {
      const supabase = createClient();
      // 1) 建立闪卡文件（空笔记，source_type='cards'）。标题用 AI 生成的「主题标题」，不用用户提问。
      const title = await titleFor(msg.content, "语伴闪卡合集");
      const { data: note, error: noteErr } = await supabase
        .from("notes")
        .insert({ title: title || "语伴闪卡合集", source_type: "cards" })
        .select("id")
        .single();
      if (noteErr || !note) throw new Error(noteErr?.message ?? "创建闪卡合集失败");
      // 2) 每条知识点 → 卡片行（语法卡把变化/例句接到背面，正面保留原文，不塞中文解释）。
      const rows = pts.map((p, idx) => {
        const extraLabel = p.kind === "example" ? "拓展" : "例句";
        // 生词释义里若 AI 用换行分隔多个义项，折成顿号、保持同一行（避免背面多出一行孤立的词）。
        const meaning = p.kind === "word" ? p.back.replace(/\s*\n+\s*/g, "、") : p.back;
        const back = [
          meaning,
          p.kind === "grammar" && p.conjugations?.length
            ? p.conjugations.map((c) => `${c.rule}：${c.example}`).join("\n")
            : null,
          p.kind === "word" && p.note ? `搭配：${p.note}` : null,
          p.extra ? `${extraLabel}：${p.extra}` : null,
        ]
          .filter(Boolean)
          .join("\n");
        return {
          note_id: note.id,
          front: p.front.trim(),
          back: back.trim(),
          kind: p.kind === "article" ? null : p.kind ?? null,
          lang: detectCardLang({ front: p.front, back }),
          // 读音（泰语罗马音 / 日语假名…）存进 reading：CardFront 在词下方展示，背诵翻面时也带。
          reading: p.reading?.trim() || null,
          position: idx,
        };
      });
      const { error } = await supabase.from("cards").insert(rows);
      if (error) throw new Error(error.message);
      if (msg.recordId) await markRecordNote(msg.recordId, note.id);
      setImportBusy(false);
      router.push(`/notes/${note.id}/cards`);
      router.refresh();
    } catch (e) {
      setImportBusy(false);
      setError(e instanceof Error ? e.message : String(e));
    }
  }

  function clearSession() {
    if (!window.confirm("清空当前会话？已收藏的内容不会受影响。")) return;
    setMessages([]);
    setError(null);
    try {
      window.localStorage.removeItem(STORAGE_KEY);
    } catch {
      /* 忽略 */
    }
  }

  /** 图片 OCR：读成文字填进输入框（等同笔记里的 AI 助手上传图片）。 */
  async function onPickImage(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    setError(null);
    setExtracting("正在识别图片…");
    try {
      const dataUrl: string = await new Promise((resolve, reject) => {
        const r = new FileReader();
        r.onload = () => resolve(r.result as string);
        r.onerror = () => reject(new Error("读取图片失败"));
        r.readAsDataURL(file);
      });
      const comma = dataUrl.indexOf(",");
      const mediaType = dataUrl.slice(0, comma).match(/data:([^;]+)/)?.[1] ?? "image/png";
      const imageBase64 = dataUrl.slice(comma + 1);
      const res = await fetch("/api/ai/ocr", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ imageBase64, mediaType }),
        signal: AbortSignal.timeout(90_000),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data?.error ?? "识别失败");
        return;
      }
      setInput(data?.text ?? "");
      setDone("已识别图片文字，编辑后可发送");
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setExtracting(null);
    }
  }

  const importingTranscript =
    importIndex !== null && !!messages[importIndex]?.transcript;

  return (
    <div
      style={viewportH ? { height: viewportH } : undefined}
      className="mx-auto flex h-[100dvh] w-full max-w-2xl flex-col px-4 pt-[calc(env(safe-area-inset-top)+1rem)] pb-[calc(3.5rem+env(safe-area-inset-bottom)+0.75rem)] md:px-6 md:pt-6 md:pb-6"
    >
      {/* 标题栏：与其他一级页统一（标题左 + 动作右），独立于会话卡、不受卡宽限制；会话卡片放在标题下方、占满剩余高度。 */}
      <header className="flex shrink-0 items-center gap-2 border-b border-black/[0.06] pb-3 md:border-b-0 md:pb-4">
        <h1 className="min-w-0 flex-1 truncate text-2xl font-bold text-zinc-900">AI 语伴</h1>
        <div className="flex shrink-0 items-center gap-1.5">

          <button
            onClick={clearSession}
            className="inline-flex h-9 shrink-0 items-center rounded-lg px-3 text-sm text-zinc-400 transition-colors hover:bg-zinc-100 hover:text-zinc-700"
          >
            清空会话
          </button>
          <Link
            href="/companion/favorites"
            title="查看已收藏的回复与素材"
            className="inline-flex h-9 shrink-0 items-center gap-1 rounded-lg border border-teal-200 px-3 text-sm font-medium text-teal-700 transition-colors hover:bg-teal-50"
          >
            <Heart className="h-4 w-4" />
            收藏夹
          </Link>
        </div>
      </header>

      {/* 会话卡片：圆角边框、占满剩余高度，内部自滚动 */}
      <div className="mt-3 flex min-h-0 flex-1 flex-col overflow-hidden rounded-2xl border border-zinc-200 bg-white shadow-sm">
      {/* 消息区 + 底部弹式导入面板 */}
      <div ref={listRef} className="flex-1 space-y-3 overflow-y-auto px-4 py-4">
        {messages.length === 0 && (
          <div className="mt-12 text-center text-sm text-zinc-400">
            <Sparkles className="mx-auto mb-2 h-6 w-6 text-teal-400" />
            <p>
              问一个词、翻一句话、聊一个语法点，
              <br />
              或让我写一篇场景短文。
            </p>
          </div>
        )}

        {messages.map((m, i) =>
          m.role === "user" ? (
            <div key={i} className="flex justify-end">
              <div className="max-w-[85%] whitespace-pre-wrap rounded-2xl bg-teal-600 px-3 py-2 text-sm text-white">
                {m.content}
              </div>
            </div>
          ) : (
            <div key={i} className="flex justify-start">
              <div className="max-w-[92%] whitespace-pre-wrap rounded-2xl bg-zinc-100 px-3 py-2 text-sm text-zinc-800">
                {m.content}
                <div className="mt-2.5">
                  <PointsPreview points={m.points} />
                </div>
                <div className="mt-2.5 flex flex-wrap items-center gap-1.5 border-t border-zinc-200/70 pt-2">
                  <button
                    onClick={() => void collect(i)}
                    disabled={collecting.has(i)}
                    title={m.favorited ? "点击取消收藏" : "收藏"}
                    className={`inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-xs font-medium transition-colors ${
                      m.favorited
                        ? "bg-teal-50 text-teal-600 hover:bg-teal-100"
                        : "border border-zinc-200 text-zinc-500 hover:border-teal-300 hover:text-teal-600"
                    } disabled:opacity-70`}
                  >
                    <Heart className={`h-3 w-3 ${m.favorited ? "fill-current" : ""}`} />
                    {m.favorited ? "已收藏" : collecting.has(i) ? "收藏中…" : "收藏"}
                  </button>
                  <button
                    onClick={() => {
                      setImportIndex(i);
                      setMode("new");
                      setQuery("");
                      setNotes([]);
                    }}
                    className="inline-flex items-center gap-1.5 rounded-lg border border-zinc-200 px-2.5 py-1.5 text-xs font-medium text-zinc-500 transition-colors hover:border-teal-300 hover:text-teal-600"
                  >
                    <FilePlus2 className="h-3 w-3" />
                    导入笔记
                  </button>
                  {(m.points ?? []).length > 0 && (
                    <button
                      onClick={() => void generateCards(i)}
                      disabled={importBusy}
                      className="inline-flex items-center gap-1.5 rounded-lg border border-teal-200 px-2.5 py-1.5 text-xs font-medium text-teal-600 transition-colors hover:bg-teal-50 disabled:opacity-50"
                    >
                      <Layers className="h-3 w-3" />
                      {importBusy ? "生成中…" : "生成闪卡"}
                    </button>
                  )}
                </div>
              </div>
            </div>
          )
        )}

        {busy && (
          <div className="flex justify-start">
            <div className="flex items-center gap-2 rounded-2xl bg-zinc-100 px-3 py-2 text-sm text-zinc-400">
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
              思考中…
            </div>
          </div>
        )}
      </div>

      {/* 错误 + 提示 + 录音状态 */}
      {error && <p className="px-4 pb-1 text-xs text-red-600">{error}</p>}
      {done && <p className="px-4 pb-1 text-xs text-teal-600">{done}</p>}
      {voice.recording && (
        <p className="flex items-center gap-1.5 px-4 pb-1 text-xs font-medium text-red-500">
          <span className="h-2 w-2 animate-pulse rounded-full bg-red-500" />
          正在录音，再点一次停止
        </p>
      )}

      {/* 输入区：文本框与发送按钮同一行等高；图片 / 语音 + 语言选择收成一行小工具 */}
      <div className="shrink-0 border-t border-zinc-100 p-3">
        <div className="flex items-end gap-2">
          <textarea
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                void send();
              }
            }}
            placeholder="输入词、句子或提问…"
            rows={1}
            className="min-h-[40px] min-w-0 flex-1 resize-none rounded-xl border border-zinc-200 bg-white px-3 py-2.5 text-sm text-zinc-800 placeholder:text-sm placeholder:text-zinc-400 focus:border-teal-500 focus:outline-none"
          />
          <button
            onClick={() => void send()}
            disabled={busy || !input.trim()}
            className="h-[40px] shrink-0 rounded-xl bg-teal-600 px-3 text-white transition-colors hover:bg-teal-700 disabled:opacity-50"
            aria-label="发送"
          >
            <Send className="h-[18px] w-[18px]" />
          </button>
        </div>
        <div className="mt-1.5 flex items-center gap-0.5">
          <button
            onClick={() => fileInputRef.current?.click()}
            title="图片 OCR"
            aria-label="图片 OCR"
            className={TOOL_BTN}
          >
            <ImagePlus className="h-5 w-5" />
          </button>
          <input
            ref={fileInputRef}
            type="file"
            accept="image/*"
            className="hidden"
            onChange={onPickImage}
          />
          <button
            onClick={() => void voice.toggle()}
            title={voice.recording ? "停止录音" : "语音输入（识别后自动发送）"}
            aria-label="语音输入"
            className={`${TOOL_BTN} ${voice.recording ? "text-red-500" : ""}`}
          >
            {voice.recording ? <Square className="h-5 w-5" /> : <Mic className="h-5 w-5" />}
          </button>
          {voice.busy && (
            <span className="flex items-center gap-1 text-xs text-zinc-400">
              <Loader2 className="h-3 w-3 animate-spin" />
              转录中…
            </span>
          )}
          {extracting && (
            <span className="flex items-center gap-1 text-xs text-zinc-400">
              <Loader2 className="h-3 w-3 animate-spin" />
              识别中…
            </span>
          )}
          <select
            value={lang}
            onChange={(e) => setLang(e.target.value)}
            title="目标语言（翻译 / 场景对话 / 美文用）"
            className="ml-auto shrink-0 rounded-md border border-zinc-200 px-2.5 py-1.5 text-sm text-zinc-600 focus:border-teal-500 focus:outline-none"
          >
            {LANGS.map((l) => (
              <option key={l.key} value={l.key}>
                {l.label}
              </option>
            ))}
          </select>
        </div>
      </div>

      {/* ===== 导入到笔记弹窗（新建 / 选已有） ===== */}
      {importIndex !== null && (
        <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 sm:items-center">
          <div className="w-full max-w-md rounded-t-3xl bg-white p-5 shadow-xl sm:rounded-2xl">
            <div className="mb-3 flex items-center justify-between">
              <p className="text-base font-semibold text-zinc-900">导入到笔记</p>
              <button
                onClick={() => setImportIndex(null)}
                className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-md text-zinc-400 hover:bg-zinc-100 hover:text-zinc-700"
                aria-label="关闭"
              >
                <Trash2 className="h-5 w-5" />
              </button>
            </div>

            <div className="mb-3 flex gap-0.5 rounded-xl bg-black/[0.05] p-1">
              <button
                onClick={() => setMode("new")}
                className={`flex-1 rounded-lg px-3 py-2 text-sm font-medium transition-all ${
                  mode === "new" ? "bg-white text-teal-700 shadow-sm" : "text-zinc-500"
                }`}
              >
                新建笔记
              </button>
              <button
                onClick={() => setMode("existing")}
                className={`flex-1 rounded-lg px-3 py-2 text-sm font-medium transition-all ${
                  mode === "existing" ? "bg-white text-teal-700 shadow-sm" : "text-zinc-500"
                }`}
              >
                选已有笔记
              </button>
            </div>

            {mode === "new" ? (
              <p className="mb-3 text-xs text-zinc-400">
                {importingTranscript
                  ? "将新建一篇笔记，收录这份逐字稿。"
                  : "将新建一篇笔记，把这条回复的知识点追加进去。"}
              </p>
            ) : (
              <>
                <input
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  placeholder="搜索笔记…"
                  autoFocus
                  className="mb-2 w-full rounded-lg border border-zinc-200 px-3 py-2.5 text-sm text-zinc-800 focus:border-teal-500 focus:outline-none placeholder:text-sm"
                />
                <div className="max-h-48 space-y-1 overflow-y-auto">
                  {loadingNotes ? (
                    <p className="py-3 text-center text-sm text-zinc-400">加载中…</p>
                  ) : filteredNotes.length === 0 ? (
                    <p className="py-3 text-center text-sm text-zinc-400">没有匹配的笔记</p>
                  ) : (
                    filteredNotes.map((n) => (
                      <button
                        key={n.id}
                        onClick={() => void importMsg(importIndex, n.id)}
                        disabled={importBusy}
                        className="block w-full truncate rounded-lg border border-zinc-200 px-3 py-2.5 text-left text-sm text-zinc-700 transition-colors hover:border-teal-300"
                      >
                        {n.title}
                      </button>
                    ))
                  )}
                </div>
              </>
            )}

            {mode === "new" && (
              <button
                onClick={() => void importMsg(importIndex, null)}
                disabled={importBusy}
                className="mt-2 w-full rounded-lg bg-teal-600 px-3 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-teal-700 disabled:opacity-50"
              >
                {importBusy ? "导入中…" : "新建并导入"}
              </button>
            )}
          </div>
        </div>
      )}
      </div>
    </div>
  );
}
