"use client";

// AI 语伴弹窗（右侧抽屉）：自由聊天提问，AI 返回对话式回答 + 结构化「知识点」数组。
// 知识点做成可勾选列表，支持「加入笔记」（pointsToNoteContent 转成 callout 块插到笔记末尾）
// 或「转成闪卡」（按 kind 生成 word/example/grammar 卡，原文跳过）。
// 输入支持 文本 / 图片 OCR / 语音：后两者先转成文字填进输入框，再发给语伴。
// 复用 KIND_META 的标签 + 配色，与编辑器里的 callout 一致。

import { useEffect, useRef, useState } from "react";
import type { Editor } from "@tiptap/react";
import type { JSONContent } from "@tiptap/core";
import {
  Sparkles,
  Send,
  X,
  FilePlus2,
  Check,
  Loader2,
  Sprout,
  MessageSquare,
  Puzzle,
  ScrollText,
  Mic,
  Square,
  ImagePlus,
} from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { pointsToNoteContent, type AssistantPoint } from "@/lib/ai-note";
import { docToText } from "@/lib/doc-to-text";
import { parseCards } from "@/lib/parse-cards";
import { WORD_TITLES, EXAMPLE_TITLES, GRAMMAR_TITLES } from "@/lib/parse-sections";
import { KIND_META } from "@/lib/callout-extension";
import { detectCardLang } from "@/lib/lang-detect";
import { normalizeFront } from "@/lib/normalize-front";

const KIND_ICON = {
  word: Sprout,
  example: MessageSquare,
  grammar: Puzzle,
  article: ScrollText,
} as const;

type Message = { role: "user" | "assistant"; content: string };

const TOOL_BTN =
  "inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-lg text-zinc-400 transition-colors hover:bg-zinc-100 hover:text-zinc-600";

/** 语伴「语言」下拉：默认自由对话；选了目标语言则进入翻译/场景/美文模式（通用，不只为一个目标服务）。 */
const LANGS = [
  { key: "", label: "自由" },
  { key: "ko", label: "韩语" },
  { key: "th", label: "泰语" },
  { key: "ja", label: "日语" },
  { key: "en", label: "英语" },
  { key: "es", label: "西班牙语" },
];

/** 低调「模式气泡」：点了只往输入框塞一句模板 prompt（可自由编辑），不新增专用按钮。 */
const MODE_BUBBLES = [
  { label: "场景对话", fill: (l: string) => `我们来场景对话：你扮演[角色]，用${l || "外语"}跟我一句一句聊。我想练习的场景是：` },
  { label: "写美文", fill: (l: string) => `写一篇关于[主题]的${l || "外语"}美文，并把里面的生词、例句、语法拆出来。` },
  { label: "纠错", fill: () => `把上面这段对话里我说得不地道、有语病的地方挑出来，逐条纠正、说明更自然的说法，并整理成知识点（生词/例句/语法）。` },
  { label: "补全笔记", fill: () => `补全这篇笔记里的生词、例句、语法：补充释义、翻译和说明，给生词、语法各加一个例句。` },
];

type SavedState = {
  messages: Message[];
  points: AssistantPoint[] | null;
  selected: number[];
};

/** 从 localStorage 读语伴历史（按笔记隔离，重开面板还能看到之前的对话）。 */
function loadSaved(key: string): SavedState {
  if (typeof window === "undefined") return { messages: [], points: null, selected: [] };
  try {
    const raw = window.localStorage.getItem(key);
    if (!raw) return { messages: [], points: null, selected: [] };
    const parsed = JSON.parse(raw);
    return {
      messages: Array.isArray(parsed?.messages) ? parsed.messages : [],
      points: Array.isArray(parsed?.points) ? parsed.points : null,
      selected: Array.isArray(parsed?.selected) ? parsed.selected : [],
    };
  } catch {
    return { messages: [], points: null, selected: [] };
  }
}

/** 背面是否已被富化过（多行「释义\n例句」）：是则跳过，避免重复补全。 */
function alreadyEnriched(back: string): boolean {
  return (back ?? "").split("\n").filter((s) => s.trim()).length >= 2;
}

/** kind → 对应标题集合（「加入笔记」没有 callout 时，按标题找落点）。 */
const KIND_TITLES: Record<"word" | "example" | "grammar", Set<string>> = {
  word: WORD_TITLES,
  example: EXAMPLE_TITLES,
  grammar: GRAMMAR_TITLES,
};

/** 从「生词/例句/语法」callout 节点里抽现有卡片（只扫 callout 自身内容，不把 callout 之外的正文误当卡片）。
 *  这是修复「加入笔记后正文被吸进生词 callout」的关键：parseNote 是按整篇纯文本切分的，callout 之后
 *  直到下一个标题/分割线之间的正文段落会被误归进上一个 callout 区域；这里直接走节点结构，逐 callout 解析。 */
function existingCardsOf(
  editor: Editor | null
): { kind: "word" | "example" | "grammar"; front: string; back: string }[] {
  if (!editor) return [];
  try {
    const content = (editor.getJSON().content ?? []) as JSONContent[];
    const out: { kind: "word" | "example" | "grammar"; front: string; back: string }[] = [];
    for (const node of content) {
      if (node.type !== "callout") continue;
      const kind = node.attrs?.kind as string;
      if (kind !== "word" && kind !== "example" && kind !== "grammar") continue;
      // 只序列化 callout 自身的子内容（不含「生词」标签行），逐行成卡。
      const body = docToText({ type: "doc", content: node.content ?? [] });
      for (const c of parseCards(body, null, { bareToCard: true, scope: "callout" })) {
        if (!c.front) continue;
        out.push({ kind: kind as "word" | "example" | "grammar", front: c.front, back: c.back });
      }
    }
    return out;
  } catch {
    return [];
  }
}

/** 从当前笔记里抽出已有知识点（生词/例句/语法，正面 + 现有释义），供语伴「补全」作上下文。
 *  已经富化过的（背面多行）跳过，只把薄的发给 AI，实现「新增内容自动去重、不重复补全」。 */
function notePointsOf(
  editor: Editor | null
): { kind: "word" | "example" | "grammar"; front: string; back: string }[] {
  return existingCardsOf(editor).filter((c) => !alreadyEnriched(c.back));
}

export function AiAssistantPanel({
  editor,
  noteId,
  onClose,
}: {
  editor: Editor | null;
  noteId: string;
  onClose: () => void;
}) {
  const storageKey = `nestlingo:assistant:${noteId}`;
  const [messages, setMessages] = useState<Message[]>(() => loadSaved(storageKey).messages);
  const [input, setInput] = useState("");
  const [lang, setLang] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [points, setPoints] = useState<AssistantPoint[] | null>(() => loadSaved(storageKey).points);
  const [selected, setSelected] = useState<Set<number>>(() => new Set(loadSaved(storageKey).selected));
  const [addingCards, setAddingCards] = useState(false);
  const [done, setDone] = useState<string | null>(null);
  const [addedToNote, setAddedToNote] = useState(false);
  const addedTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // 多合一输入：extracting = 正在把 图片/语音 转文字；recording = 正在录音。
  const [extracting, setExtracting] = useState<string | null>(null);
  const [recording, setRecording] = useState(false);
  const listRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);

  // 消息 / 知识点更新时滚到底部。
  useEffect(() => {
    listRef.current?.scrollTo({ top: listRef.current.scrollHeight });
  }, [messages, points, busy]);

  // 历史持久化：按笔记存到 localStorage，重开面板还能看到之前的对话 + 知识点。
  useEffect(() => {
    if (typeof window === "undefined") return;
    try {
      window.localStorage.setItem(
        storageKey,
        JSON.stringify({ messages, points, selected: Array.from(selected) })
      );
    } catch {
      /* 存储已满等情况，忽略 */
    }
  }, [messages, points, selected, storageKey]);

  function selectedPoints(): AssistantPoint[] {
    if (!points) return [];
    return points.filter((_, i) => selected.has(i));
  }

  function toggle(i: number) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(i)) next.delete(i);
      else next.add(i);
      return next;
    });
  }

  function toggleAll() {
    if (!points) return;
    setSelected((prev) =>
      prev.size === points.length ? new Set() : new Set(points.map((_, i) => i))
    );
  }

  /** 清空当前笔记的语伴会话（消息 + 知识点 + 勾选），并删掉本地缓存。 */
  function clearSession() {
    if (!window.confirm("清除当前会话记录？")) return;
    setMessages([]);
    setPoints(null);
    setSelected(new Set());
    setError(null);
    setDone(null);
    try {
      window.localStorage.removeItem(storageKey);
    } catch {
      /* 忽略 */
    }
  }

  /** 真正把一段文字发给语伴（文本发送 / 语音直发共用）。 */
  async function sendText(raw: string) {
    const text = raw.trim();
    if (!text || busy) return;
    setMessages((m) => [...m, { role: "user", content: text }]);
    setBusy(true);
    setError(null);
    setDone(null);
    setPoints(null);
    try {
      const res = await fetch("/api/ai/assistant", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ message: text, lang, notePoints: notePointsOf(editor) }),
        signal: AbortSignal.timeout(90_000),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data?.error ?? "请求失败");
        return;
      }
      setMessages((m) => [...m, { role: "assistant", content: data.reply ?? "" }]);
      const pts: AssistantPoint[] = Array.isArray(data.points) ? data.points : [];
      setPoints(pts);
      setSelected(new Set(pts.map((_, i) => i)));
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

  /** 「加入笔记」按「解释」按钮同款放置规则：有对应 callout → 加进 callout；否则有对应标题 → 加在标题下；
   *  都没有 → 直接以普通段落追加到文末（不新建 callout）。按归一化正面去重：已有同词就覆盖那一行。 */
  function addToNote() {
    if (!editor) return;
    const pts = selectedPoints();
    if (pts.length === 0) return;

    const nonArticle = pts.filter((p) => p.kind !== "article");
    const articles = pts.filter((p) => p.kind === "article");

    // 现有笔记里的知识点（生词/例句/语法，仅扫 callout），按 front 归并。
    const existing = existingCardsOf(editor);
    const enriched = new Set(nonArticle.map((p) => `${p.kind}:${normalizeFront(p.front)}`));
    const overwritten = existing.filter((e) =>
      enriched.has(`${e.kind}:${normalizeFront(e.front)}`)
    ).length;

    const doc = editor.getJSON();
    const content = (doc.content ?? []) as JSONContent[];

    // 逐个 kind 独立放置，只动目标 callout / 目标标题区，其余节点一律不动。
    for (const kind of ["word", "example", "grammar"] as const) {
      const newPts = nonArticle.filter((p) => p.kind === kind);
      if (newPts.length === 0) continue;

      // 该 kind 的合并列表：新点在前，已有的（去掉被覆盖的）排后。
      const newFronts = new Set(newPts.map((p) => normalizeFront(p.front)));
      const rest: AssistantPoint[] = existing
        .filter((e) => e.kind === kind && !newFronts.has(normalizeFront(e.front)))
        .map((e) => ({ kind, front: e.front, back: e.back.replace(/\n/g, "  "), extra: "" }));
      const merged: AssistantPoint[] = [...newPts, ...rest];
      const block = pointsToNoteContent(merged, { list: false })[0]; // 一个 callout（正文为段落）
      const inner = (block.content ?? []) as JSONContent[];

      // a) 已有该 kind 的 callout → 只换它的内容（保留原 attrs，如 source）。
      const calloutIdx = content.findIndex(
        (n) => n.type === "callout" && n.attrs?.kind === kind
      );
      if (calloutIdx >= 0) {
        content[calloutIdx] = { ...content[calloutIdx], content: inner };
        continue;
      }

      // b) 顶层有该 kind 的标题 → 把段落插到该标题区末尾（扫到下一个 heading/callout 前）。
      const titles = KIND_TITLES[kind];
      const headingIdx = content.findIndex((n) => {
        if (n.type !== "heading") return false;
        const t = docToText({ type: "doc", content: [n] })
          .trim()
          .replace(/^#+\s*/, "")
          .toLowerCase();
        return titles.has(t);
      });
      if (headingIdx >= 0) {
        let insertAt = headingIdx + 1;
        for (let i = headingIdx + 1; i < content.length; i++) {
          const n = content[i];
          if (n.type === "heading" || n.type === "callout") break;
          insertAt = i + 1;
        }
        content.splice(insertAt, 0, ...inner);
        continue;
      }

      // c) 都没有 → 段落直接落到文末，不新建 callout。
      content.push(...inner);
    }

    // 原文照旧以 callout 追加到末尾。
    if (articles.length) content.push(...pointsToNoteContent(articles));

    editor.commands.setContent({ type: "doc", content });

    const added = pts.length - overwritten;
    setDone(
      overwritten > 0 ? `已加入笔记（覆盖 ${overwritten} 项，新增 ${added} 项）` : `已加入笔记（新增 ${added} 项）`
    );
    // 按钮即时反馈：变绿显示「已加入」，1.6s 后恢复，避免用户以为没点进去。
    setAddedToNote(true);
    if (addedTimerRef.current) clearTimeout(addedTimerRef.current);
    addedTimerRef.current = setTimeout(() => setAddedToNote(false), 1600);
  }

  async function toCards() {
    const pts = selectedPoints().filter((p) => p.kind !== "article");
    if (pts.length === 0) return;
    setAddingCards(true);
    setError(null);
    setDone(null);
    const supabase = createClient();
    // 去重：同一篇笔记里正面已存在就不重复收录。
    const { data: existing } = await supabase
      .from("cards")
      .select("front")
      .eq("note_id", noteId)
      .in(
        "front",
        pts.map((p) => p.front)
      );
    const existingFronts = new Set((existing ?? []).map((r) => r.front));
    const rows = pts
      .filter((p) => !existingFronts.has(p.front))
      .map((p) => {
        const back =
          p.kind === "grammar"
            ? [
                p.back,
                ...(p.conjugations ?? [])
                  .filter((c) => c.rule)
                  .map((c) =>
                    c.example ? `接续：${c.rule}（${c.example}）` : `接续：${c.rule}`
                  ),
                p.extra ? `例：${p.extra}` : "",
              ]
                .filter(Boolean)
                .join("\n\n")
            : [p.back, p.extra].filter(Boolean).join("\n\n");
        return {
          note_id: noteId,
          front: p.front,
          back,
          kind: p.kind,
          lang: detectCardLang({ front: p.front, back }),
          position: 0,
        };
      });
    const skipped = pts.length - rows.length;
    if (rows.length > 0) {
      const { error } = await supabase.from("cards").insert(rows);
      if (error) {
        setError(error.message);
        setAddingCards(false);
        return;
      }
    }
    setAddingCards(false);
    setDone(
      skipped > 0
        ? `已生成 ${rows.length} 张闪卡（跳过 ${skipped} 张已存在）`
        : `已生成 ${rows.length} 张闪卡`
    );
  }

  /** 图片 OCR：读成文字填进输入框。 */
  async function onPickImage(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    setError(null);
    setDone(null);
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

  /** 语音：点一下开始录音，再点一下停止 → 转录填进输入框。 */
  async function toggleRecording() {
    if (recording) {
      mediaRecorderRef.current?.stop();
      return;
    }
    if (!navigator.mediaDevices?.getUserMedia) {
      setError("当前环境不支持录音（需要 https 或 localhost；手机局域网 http 暂不可用）");
      return;
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const mime = MediaRecorder.isTypeSupported("audio/webm") ? "audio/webm" : "";
      const rec = new MediaRecorder(stream, mime ? { mimeType: mime } : undefined);
      mediaRecorderRef.current = rec;
      chunksRef.current = [];
      rec.ondataavailable = (e) => {
        if (e.data.size > 0) chunksRef.current.push(e.data);
      };
      rec.onstop = async () => {
        stream.getTracks().forEach((t) => t.stop());
        setRecording(false);
        const blob = new Blob(chunksRef.current, { type: rec.mimeType || "audio/webm" });
        await transcribeAudio(blob);
      };
      rec.start();
      setRecording(true);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "无法使用麦克风（请允许麦克风权限）");
    }
  }

  async function transcribeAudio(blob: Blob) {
    setError(null);
    setDone(null);
    setExtracting("正在转录语音…");
    try {
      const fd = new FormData();
      fd.append("file", blob, "audio.webm");
      const res = await fetch("/api/ai/transcribe-audio", {
        method: "POST",
        body: fd,
        signal: AbortSignal.timeout(90_000),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data?.error ?? "转录失败");
        return;
      }
      const text = typeof data?.text === "string" ? data.text.trim() : "";
      if (!text) {
        setDone("没识别到语音内容");
        return;
      }
      // 语音识别后自动发送、继续对话（口语练习一句接一句）；图片仍是转文字填框、编辑后发。
      await sendText(text);
      setDone("已识别语音并发送");
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setExtracting(null);
    }
  }

  const langLabel = LANGS.find((l) => l.key === lang)?.label ?? "";

  /** 「翻译」气泡：当作翻译器——把当前输入（可自行粘贴任意内容）翻成所选目标语言，地道自然。前缀指令、正文在下。 */
  function fillTranslate() {
    const target = langLabel || "目标语言";
    const instruction = `请把下面这段翻译成${target}，翻得地道自然、符合母语者表达：`;
    setInput((prev) => (prev.trim() ? `${instruction}\n${prev}` : `${instruction}\n`));
    requestAnimationFrame(() => textareaRef.current?.focus());
  }

  /** 点模式气泡：把模板 prompt 塞进输入框（追加，不覆盖已输入的文字），并聚焦到输入框。 */
  function fillMode(mode: (typeof MODE_BUBBLES)[number]) {
    const tpl = mode.fill(langLabel);
    setInput((prev) => (prev.trim() ? `${prev}\n${tpl}` : tpl));
    requestAnimationFrame(() => textareaRef.current?.focus());
  }

  const cardableCount = selectedPoints().filter((p) => p.kind !== "article").length;

  return (
    <>
      {/* 遮罩 */}
      <div className="fixed inset-0 z-40 bg-black/20" onClick={onClose} />

      {/* 右侧抽屉 */}
      <div className="fixed bottom-0 right-0 top-0 z-50 flex w-full max-w-[420px] flex-col bg-white shadow-2xl">
        {/* 头部 */}
        <div className="flex items-center justify-between border-b border-zinc-100 px-4 py-3">
          <div className="flex items-center gap-2.5">
            <span className="flex h-8 w-8 items-center justify-center rounded-lg brand-gradient text-white">
              <Sparkles className="h-4 w-4" />
            </span>
            <div>
              <p className="text-sm font-semibold text-zinc-900">AI 语伴</p>
              <p className="text-[11px] text-zinc-400">查词 · 问语法 · 要例句 · 生成短文</p>
            </div>
          </div>
          <div className="flex items-center gap-1">
            <button
              onClick={clearSession}
              className="rounded-md px-2 py-2 text-xs text-zinc-400 hover:bg-zinc-100 hover:text-zinc-700"
            >
              清除会话
            </button>
            <button
              onClick={onClose}
              className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-md text-zinc-400 hover:bg-zinc-100 hover:text-zinc-700"
              aria-label="关闭"
            >
              <X className="h-5 w-5" />
            </button>
          </div>
        </div>

        {/* 消息 + 知识点 */}
        <div ref={listRef} className="flex-1 space-y-3 overflow-y-auto px-4 py-4">
          {messages.length === 0 && (
            <div className="mt-10 text-center text-sm text-zinc-400">
              <Sparkles className="mx-auto mb-2 h-6 w-6 text-teal-400" />
              <p>
                问我一个词、一个语法点，
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
                <div className="max-w-[90%] whitespace-pre-wrap rounded-2xl bg-zinc-100 px-3 py-2 text-sm text-zinc-800">
                  {m.content}
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

          {/* 知识点勾选列表（仅最新一次回复） */}
          {points && points.length > 0 && (
            <div className="rounded-2xl border border-zinc-200 bg-white p-3 shadow-sm">
              <div className="mb-2 flex items-center justify-between">
                <p className="text-xs font-semibold text-zinc-500">
                  知识点（{selected.size}/{points.length}）
                </p>
                <button
                  onClick={toggleAll}
                  className="text-xs font-medium text-teal-600 hover:text-teal-700"
                >
                  {selected.size === points.length ? "全不选" : "全选"}
                </button>
              </div>

              <ul className="space-y-1">
                {points.map((p, i) => {
                  const meta = KIND_META[p.kind] ?? KIND_META.word;
                  const Icon = KIND_ICON[p.kind] ?? Sprout;
                  return (
                    <li
                      key={i}
                      className="flex items-start gap-2 rounded-lg p-1.5 transition-colors hover:bg-zinc-50"
                    >
                      <input
                        type="checkbox"
                        checked={selected.has(i)}
                        onChange={() => toggle(i)}
                        className="mt-0.5 h-4 w-4 shrink-0 accent-teal-600"
                      />
                      <div className="min-w-0 flex-1">
                        <p className="flex items-center gap-1.5 text-sm font-medium text-zinc-900">
                          <Icon className="h-3.5 w-3.5 shrink-0" style={{ color: meta.color }} />
                          <span className="truncate">{p.front}</span>
                        </p>
                        {p.back && <p className="mt-0.5 whitespace-pre-wrap text-xs text-zinc-500">{p.back}</p>}
                        {(p.conjugations ?? []).map((c, ci) =>
                          c.rule ? (
                            <p key={ci} className="mt-0.5 text-xs font-medium text-teal-700">
                              接续：{c.rule}
                              {c.example ? `（${c.example}）` : ""}
                            </p>
                          ) : null
                        )}
                        {p.extra && <p className="mt-0.5 text-xs text-zinc-400">{p.extra}</p>}
                      </div>
                      <span
                        className="shrink-0 rounded-full px-2 py-0.5 text-[10px] font-medium"
                        style={{ color: meta.color, backgroundColor: `${meta.color}1a` }}
                      >
                        {meta.label}
                      </span>
                    </li>
                  );
                })}
              </ul>

              <div className="mt-2.5 flex gap-2">
                <button
                  onClick={addToNote}
                  disabled={selected.size === 0}
                  className={`flex flex-1 items-center justify-center gap-1.5 rounded-lg px-3 py-2 text-sm font-medium transition-colors disabled:opacity-50 ${
                    addedToNote
                      ? "bg-teal-600 text-white"
                      : "border border-teal-200 text-teal-700 hover:bg-teal-50"
                  }`}
                >
                  {addedToNote ? (
                    <Check className="h-3.5 w-3.5" />
                  ) : (
                    <FilePlus2 className="h-3.5 w-3.5" />
                  )}
                  {addedToNote ? "已加入" : "加入笔记"}
                </button>
                <button
                  onClick={toCards}
                  disabled={addingCards || cardableCount === 0}
                  className="flex flex-1 items-center justify-center gap-1.5 rounded-lg bg-teal-600 px-3 py-2 text-sm font-semibold text-white transition-colors hover:bg-teal-700 disabled:opacity-50"
                >
                  {addingCards ? (
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  ) : (
                    <Sparkles className="h-3.5 w-3.5" />
                  )}
                  转成闪卡
                </button>
              </div>

              {done && (
                <p className="mt-2 text-center text-xs font-medium text-teal-600">{done}</p>
              )}
            </div>
          )}
        </div>

        {/* 错误 + 状态 + 输入 */}
        {error && <p className="px-4 pb-1 text-xs text-red-600">{error}</p>}
        {extracting && (
          <p className="flex items-center gap-1.5 px-4 pb-1 text-xs text-zinc-500">
            <Loader2 className="h-3 w-3 animate-spin" />
            {extracting}
          </p>
        )}
        {recording && (
          <p className="flex items-center gap-1.5 px-4 pb-1 text-xs font-medium text-red-500">
            <span className="h-2 w-2 animate-pulse rounded-full bg-red-500" />
            正在录音，再点一次停止
          </p>
        )}

        <div className="border-t border-zinc-100 p-3">
          {/* 低调模式气泡（模板，点了塞进输入框）；「翻译」是可翻译任意内容的翻译器气泡（前缀指令 + 正文） */}
          <div className="mb-1.5 flex flex-wrap items-center gap-1.5">
            {MODE_BUBBLES.map((m) => (
              <button
                key={m.label}
                type="button"
                onClick={() => fillMode(m)}
                title={`填入「${m.label}」模板，可编辑后再发送`}
                className="rounded-full border border-zinc-200 px-2.5 py-0.5 text-[11px] text-zinc-400 transition-colors hover:border-teal-200 hover:bg-teal-50 hover:text-teal-600"
              >
                {m.label}
              </button>
            ))}
            <button
              type="button"
              onClick={fillTranslate}
              title="当作翻译器：把输入的内容（可粘贴任意文字）翻成所选目标语言，地道自然"
              className="rounded-full border border-zinc-200 px-2.5 py-0.5 text-[11px] text-zinc-400 transition-colors hover:border-teal-200 hover:bg-teal-50 hover:text-teal-600"
            >
              翻译
            </button>
          </div>

          <div className="flex items-end gap-2">
            <textarea
              ref={textareaRef}
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  void send();
                }
              }}
              placeholder="输入词、句子或提问…（Enter 发送）"
              rows={2}
              className="min-h-0 flex-1 resize-none rounded-xl border border-zinc-200 px-3 py-2.5 text-sm text-zinc-800 focus:border-teal-500 focus:outline-none placeholder:text-sm"
            />
            <button
              onClick={() => void send()}
              disabled={busy || !input.trim()}
              className="rounded-xl bg-teal-600 p-2.5 text-white transition-colors hover:bg-teal-700 disabled:opacity-50"
              aria-label="发送"
            >
              <Send className="h-5 w-5" />
            </button>
          </div>

          {/* 多合一输入工具行：图片 / 语音 / 链接 */}
          <div className="mt-1.5 flex items-center gap-0.5">
            <button
              type="button"
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
              type="button"
              onClick={() => void toggleRecording()}
              title={recording ? "停止录音" : "语音输入（识别后自动发送）"}
              aria-label="语音输入"
              className={`${TOOL_BTN} ${recording ? "text-red-500 hover:text-red-600" : ""}`}
            >
              {recording ? <Square className="h-5 w-5" /> : <Mic className="h-5 w-5" />}
            </button>
            <select
              value={lang}
              onChange={(e) => setLang(e.target.value)}
              title="目标语言（翻译 / 场景对话 / 美文用）"
              className="ml-auto rounded-md border border-zinc-200 px-1.5 py-1 text-xs text-zinc-500 focus:border-teal-500 focus:outline-none"
            >
              {LANGS.map((l) => (
                <option key={l.key} value={l.key}>
                  {l.label}
                </option>
              ))}
            </select>
          </div>
        </div>
      </div>
    </>
  );
}
