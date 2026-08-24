"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useEditor, useEditorState, EditorContent } from "@tiptap/react";
import { Plugin, PluginKey } from "@tiptap/pm/state";
import { Decoration, DecorationSet } from "@tiptap/pm/view";
import type { Node as PMNode } from "@tiptap/pm/model";
import Placeholder from "@tiptap/extension-placeholder";
import {
  Bold,
  Italic,
  Underline,
  Highlighter,
  List,
  Quote,
  Table as TableIcon,
  Columns2,
  Minus,
  Image as ImageIcon,
  Video,
  Sprout,
  MessageSquare,
  Puzzle,
  ScrollText,
  Undo2,
  Redo2,
  AudioLines,
  Rss,
  Sparkles,
  Upload,
  ScanText,
  Loader2,
  Link2,
  X,
} from "lucide-react";
import { editorExtensions } from "@/lib/editor-extensions";
import { docToText } from "@/lib/doc-to-text";
import { parseMediaUrl } from "@/lib/media";
import { transcriptCallout } from "@/lib/ai-note";
import { Extension } from "@tiptap/core";
import type { JSONContent } from "@tiptap/core";
import { createPortal } from "react-dom";
import { createClient } from "@/lib/supabase/client";
import { detectCardLang } from "@/lib/lang-detect";
import { AiAssistantPanel } from "./ai-assistant-panel";
import { runCalloutAction, setCalloutActionHandler } from "@/lib/callout-actions";

/** AI 解释结果：词典原形（卡片正面）+ 音标/注音 + 词性 + 释义 + 词组 + 例句。 */
type ExplainResult = {
  baseForm: string;
  phonetic: string;
  partOfSpeech: string;
  meaning: string;
  collocations: string;
  example: string;
};

/** 装饰插件 key：注册 / 注销都用它定位。 */
const collectedWordKey = new PluginKey("collectedWordDecorations");

/** 精读「已解释且收录」标记：本次阅读里点过「解释」并「收录到闪卡」的词，
 *  在原文对应文本上加一条淡下划线。纯装饰（Decoration），不改动笔记 JSON。 */
function collectedWordDecorations(doc: PMNode, words: Set<string>): DecorationSet {
  const terms = Array.from(words)
    .filter((w) => w.length > 0)
    .sort((a, b) => b.length - a.length); // 长词优先，避免被短词抢先截断
  if (terms.length === 0) return DecorationSet.empty;
  const decos: Decoration[] = [];
  doc.descendants((node, pos) => {
    if (!node.isText) return;
    const text = node.text ?? "";
    for (const term of terms) {
      let idx = text.indexOf(term);
      while (idx !== -1) {
        decos.push(
          Decoration.inline(pos + idx, pos + idx + term.length, {
            class: "collected-word",
          })
        );
        idx = text.indexOf(term, idx + term.length);
      }
    }
  });
  return DecorationSet.create(doc, decos);
}

function ToolButton({
  onClick,
  active,
  disabled,
  title,
  children,
}: {
  onClick: () => void;
  active?: boolean;
  disabled?: boolean;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onMouseDown={(e) => e.preventDefault()}
      onTouchStart={(e) => e.preventDefault()}
      onTouchEnd={(e) => {
        e.preventDefault();
        onClick();
      }}
      onClick={onClick}
      disabled={disabled}
      title={title}
      className={`rounded-lg px-2 py-1.5 transition-colors ${
        active
          ? "bg-teal-100 text-teal-700"
          : "text-zinc-600 hover:bg-zinc-100 hover:text-zinc-900"
      } ${disabled ? "cursor-not-allowed opacity-40 hover:bg-transparent" : ""}`}
    >
      {children}
    </button>
  );
}

/**
 * TipTap 富文本编辑器本体（备忘录式：工具栏在顶部，正文铺满下方）。
 * 只在客户端渲染（由 note-editor 用 next/dynamic ssr:false 加载），
 * 通过 onChange 把最新的 JSON + 纯文本回传给父组件。
 * 纯文本用 docToText 序列化，让表格保留成 TSV，转成闪卡时能正确识别。
 */
export function RichTextEditor({
  initialContent,
  onChange,
  noteId,
}: {
  initialContent?: unknown;
  onChange?: (json: JSONContent | null, text: string) => void;
  noteId: string;
}) {
  // 本次会话「点过解释并收录」的原文文本集合（精确匹配文档里的字串），纯装饰标记用。
  const collectedTextsRef = useRef<Set<string>>(new Set());
  // busy 令牌：较长动作（如精读/翻译）完成时只清掉「是自己那次」的忙碌气泡，
  // 避免先发起的动作后返回时把另一个（更新的）动作的忙碌状态误清掉。
  const calloutBusyTokenRef = useRef(0);

  // 装饰插件：每次视图更新时按 collectedTextsRef 给命中的字串套 .collected-word。
  // 用 Extension + addProseMirrorPlugins 在编辑器创建时一次性挂上（不写进笔记内容），
  // 不用 useEffect + registerPlugin —— 那在 React 严格模式（开发）下会把同一个 key
  // 的插件实例重复注册，报「Adding different instances of a keyed plugin」。
  const CollectedWords = useMemo(
    () =>
      Extension.create({
        name: "collectedWords",
        addProseMirrorPlugins() {
          return [
            new Plugin({
              key: collectedWordKey,
              props: {
                decorations(state) {
                  const words = collectedTextsRef.current;
                  if (words.size === 0) return DecorationSet.empty;
                  return collectedWordDecorations(state.doc, words);
                },
              },
            }),
          ];
        },
      }),
    []
  );

  const editor = useEditor({
    extensions: [
      ...editorExtensions,
      CollectedWords,
      Placeholder.configure({
        placeholder: "写点什么，或粘贴泰语生词 / 表格…",
      }),
    ],
    immediatelyRender: true,
    content: (initialContent ?? undefined) as JSONContent | undefined,
    editorProps: {
      attributes: {
        class: "tiptap px-4 md:px-8 py-4",
      },
    },
    onUpdate: ({ editor }) => {
      onChange?.(editor.getJSON(), docToText(editor.getJSON()));
    },
  });
  const fileInputRef = useRef<HTMLInputElement>(null);
  const audioFileRef = useRef<HTMLInputElement>(null);
  const ocrFileRef = useRef<HTMLInputElement>(null);
  const [blockType, setBlockType] = useState("paragraph");
  const [mediaOpen, setMediaOpen] = useState(false);
  const [mediaUrl, setMediaUrl] = useState("");
  const [mediaError, setMediaError] = useState<string | null>(null);
  const [audioUploading, setAudioUploading] = useState(false);
  const [audioError, setAudioError] = useState<string | null>(null);
  const [ocrUploading, setOcrUploading] = useState(false);
  const [ocrError, setOcrError] = useState<string | null>(null);
  const [rssLoading, setRssLoading] = useState(false);
  const [rssError, setRssError] = useState<string | null>(null);
  const [rssFeed, setRssFeed] = useState<{
    title: string;
    episodes: { title: string; audio: string }[];
  } | null>(null);
  const [explain, setExplain] = useState<{
    text: string;
    left: number;
    top: number;
    bottom: number;
  } | null>(null);
  const [result, setResult] = useState<ExplainResult | null>(null);
  const [explainBusy, setExplainBusy] = useState(false);
  const [explainError, setExplainError] = useState<string | null>(null);
  const [collected, setCollected] = useState(false);
  const [collecting, setCollecting] = useState(false);
  const [assistantOpen, setAssistantOpen] = useState(false);
  // 「原文」callout 按钮的执行中反馈：记下按钮位置 + 文案，在按钮旁弹一个「…中」小气泡（复刻高亮解释气泡）。
  const [calloutBusy, setCalloutBusy] = useState<{ label: string; rect: DOMRect } | null>(null);

  // 工具栏激活态（加粗/斜体/下划线/高亮/列表/表格）要跟着选区实时刷新：
  // 之前直接在 JSX 里 `editor.isActive(...)`，但组件不会因选区变化重渲染，高亮就「点了不变」。
  // useEditorState 订阅 transaction/update，选中态变化时重新取一遍，保证高亮点击可开可关。
  const toolbarActive = useEditorState({
    editor,
    selector: ({ editor: e }) => ({
      bold: e?.isActive("bold") ?? false,
      italic: e?.isActive("italic") ?? false,
      underline: e?.isActive("underline") ?? false,
      highlight: e?.isActive("highlight") ?? false,
      link: e?.isActive("link") ?? false,
      bulletList: e?.isActive("bulletList") ?? false,
      blockquote: e?.isActive("blockquote") ?? false,
      table: e?.isActive("table") ?? false,
      canUndo: e ? e.can().undo() : false,
      canRedo: e ? e.can().redo() : false,
    }),
  });

  // 标题下拉要实时反映光标所在的块：显式监听 selection/transaction，
  // 否则光标的块变了（点标题、移动光标）下拉不一定重渲染，会「停在同一个」上。
  useEffect(() => {
    if (!editor) return;
    const update = () => {
      setBlockType(
        editor.isActive("codeBlock")
          ? "codeBlock"
          : editor.isActive("heading", { level: 1 })
            ? "h1"
            : editor.isActive("heading", { level: 2 })
              ? "h2"
              : editor.isActive("heading", { level: 3 })
                ? "h3"
                : "paragraph"
      );
    };
    editor.on("selectionUpdate", update);
    editor.on("transaction", update);
    update();
    return () => {
      editor.off("selectionUpdate", update);
      editor.off("transaction", update);
    };
  }, [editor]);

  // 「原文」callout 标签里的精读/翻译/加假名按钮（callout-actions 插件注入）：
  // 点击回调经模块级 setter 接到这里，拿到 editor 实例执行异步动作；执行中在按钮旁弹「…中」反馈。
  useEffect(() => {
    if (!editor) return;
    setCalloutActionHandler((action, pos, rect) => {
      // 「加/去假名」是本地即时的标注开关，不弹「…中」气泡；只有翻译 / 精读笔记（长 AI 请求）才给反馈。
      if (action === "toggleFurigana") {
        void runCalloutAction(editor, action, pos);
        return;
      }
      const label = action === "translate" ? "翻译中…" : "精读中…";
      const token = ++calloutBusyTokenRef.current;
      setCalloutBusy({ label, rect });
      void runCalloutAction(editor, action, pos).finally(() => {
        // 只有当这次动作仍是最新一次时才清掉忙碌气泡（防止旧动作收尾误清新动作）。
        if (token === calloutBusyTokenRef.current) setCalloutBusy(null);
      });
    });
    return () => setCalloutActionHandler(null);
  }, [editor]);

  // 「高亮即解释」：有文字选中时，在选区上方浮出「✨ 解释」气泡；
  // 选区消失或变化就清掉气泡和上一次的解释结果。
  useEffect(() => {
    if (!editor) return;
    const update = () => {
      const { from, to } = editor.state.selection;
      if (from === to) {
        setExplain(null);
        setResult(null);
        setExplainError(null);
        setCollected(false);
        return;
      }
      const text = editor.state.doc.textBetween(from, to, " ", " ");
      const trimmed = text.trim();
      if (!trimmed || trimmed.length > 120) {
        setExplain(null);
        setResult(null);
        setExplainError(null);
        setCollected(false);
        return;
      }
      const coords = editor.view.coordsAtPos(from);
      setExplain({
        text: trimmed,
        left: coords.left,
        top: coords.top,
        bottom: coords.bottom,
      });
      setResult(null);
      setExplainError(null);
      setCollected(false);
    };
    editor.on("selectionUpdate", update);
    return () => {
      editor.off("selectionUpdate", update);
    };
  }, [editor]);

  if (!editor) {
    return <div className="flex-1 bg-white" />;
  }

  /** 调 AI 解释选中的词/短语，结果放进 result（释义+词组+例句）。 */
  async function runExplain() {
    if (!explain || explainBusy) return;
    setExplainBusy(true);
    setExplainError(null);
    setResult(null);
    try {
      const res = await fetch("/api/ai/explain", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ text: explain.text }),
        signal: AbortSignal.timeout(60_000),
      });
      const data = await res.json();
      if (!res.ok) {
        setExplainError(data?.error ?? "解释失败");
        return;
      }
      setResult(data as ExplainResult);
    } catch (e) {
      setExplainError(e instanceof Error ? e.message : String(e));
    } finally {
      setExplainBusy(false);
    }
  }

  /** 把解释结果收录成一张生词卡（正面=词典原形，背面=释义+词组+例句）。 */
  async function collect() {
    if (!result || collected || collecting) return;
    setCollecting(true);
    setExplainError(null);
    const supabase = createClient();
    // 同一篇笔记里正面已存在就不重复收录。
    const { data: existing } = await supabase
      .from("cards")
      .select("id")
      .eq("note_id", noteId)
      .eq("front", result.baseForm)
      .limit(1);
    if (existing && existing.length > 0) {
      setCollecting(false);
      setCollected(true);
      setExplainError("这个词已经在闪卡里了。");
      return;
    }
    const meta = [result.partOfSpeech, result.phonetic ? `/${result.phonetic}/` : ""]
      .filter(Boolean)
      .join(" · ");
    const back = [
      meta,
      result.meaning,
      result.collocations ? `【词组】${result.collocations}` : "",
      result.example ? `【例句】${result.example}` : "",
    ]
      .filter(Boolean)
      .join("\n\n");
    const { error } = await supabase.from("cards").insert({
      note_id: noteId,
      front: result.baseForm,
      back,
      kind: "word",
      lang: detectCardLang({ front: result.baseForm, back }),
      position: 0,
    });
    setCollecting(false);
    if (error) {
      setExplainError(error.message);
      return;
    }
    setCollected(true);
    // 把选中的原文标成「已解释且收录」，下划线装饰立即生效。
    if (explain?.text) collectedTextsRef.current.add(explain.text);
    editor.view.dispatch(editor.state.tr);
  }

  function applyBlockType(type: string) {
    if (type === "paragraph") {
      editor.chain().focus().setParagraph().run();
    } else if (type === "codeBlock") {
      editor.chain().focus().toggleCodeBlock().run();
    } else {
      const level = Number(type.slice(1)) as 1 | 2 | 3;
      if (editor.isActive("heading", { level })) return; // 已经是这个标题就不重复切
      editor.chain().focus().toggleHeading({ level }).run();
    }
  }

  /** 链接开关：选中文字里已有链接 → 去掉超链接；否则给选中文字套一个链接（弹框输入地址）。
   *  粘贴来的带链接文字，把光标放进去（或选中）再点一下就取消链接。 */
  function toggleLink() {
    if (!editor) return;
    if (editor.isActive("link")) {
      editor.chain().focus().unsetLink().run();
      return;
    }
    const { from, to } = editor.state.selection;
    if (from === to) {
      alert("先选中要加链接的文字");
      return;
    }
    const url = window.prompt("输入链接地址（https://…）");
    if (url && url.trim()) {
      editor.chain().focus().setLink({ href: url.trim() }).run();
    }
  }

  function insertNormalTable() {
    editor
      .chain()
      .focus()
      .insertTable({ rows: 3, cols: 3, withHeaderRow: false })
      .run();
  }

  /** 生词 / 例句 / 语法 / 原文：插一个带彩色标签的 callout 块，内容「转成闪卡」时按标签自动归类（原文跳过）。 */
  function insertKindCallout(kind: "word" | "example" | "grammar" | "article") {
    editor
      .chain()
      .focus()
      .insertContent({
        type: "callout",
        attrs: { kind },
        content: [{ type: "paragraph" }],
      })
      .run();
  }

  /** 分列：插入一个两列并排块（原文/译文对照），不是表格、没有标题行。 */
  function insertSplitColumns() {
    editor
      .chain()
      .focus()
      .insertContent({
        type: "columns",
        content: [
          { type: "column", content: [{ type: "paragraph" }] },
          { type: "column", content: [{ type: "paragraph" }] },
        ],
      })
      .run();
  }

  function pickImage(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      editor.chain().focus().setImage({ src: reader.result as string }).run();
    };
    reader.readAsDataURL(file);
    e.target.value = "";
  }

  /** 选择本地音频文件 → POST 给 /api/ai/transcribe-file（云 STT，多端共用）→ 把文字稿插到光标处。
   *  只回文字、不持久化音频本身；文字稿以「原文」区块插入，转成闪卡时会自动跳过。 */
  async function pickAudioTranscribe(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    setAudioUploading(true);
    setAudioError(null);
    try {
      const form = new FormData();
      form.append("file", file);
      const res = await fetch("/api/ai/transcribe-file", {
        method: "POST",
        body: form,
        signal: AbortSignal.timeout(180_000),
      });
      const data = await res.json();
      if (!res.ok) {
        setAudioError(data?.error ?? "转录失败");
        return;
      }
      const text = typeof data?.text === "string" ? data.text.trim() : "";
      if (!text) {
        setAudioError("转录结果为空");
        return;
      }
      editor.chain().focus().insertContent(transcriptCallout(text)).run();
      setMediaOpen(false);
    } catch (e) {
      setAudioError(
        e instanceof DOMException && e.name === "TimeoutError"
          ? "转录超时，请用较短的音频重试。"
          : e instanceof Error
            ? e.message
            : String(e)
      );
    } finally {
      setAudioUploading(false);
    }
  }

  /** 选择本地图片 → POST /api/ai/ocr（视觉 OCR，只读文字、不翻译）→ 把识别文字插到光标处。
   *  和「转文字稿」一样只回文字；识别结果按空行切成段落插入。 */
  async function ocrImage(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    setOcrError(null);
    setOcrUploading(true);
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
        setOcrError(data?.error ?? "识别失败");
        return;
      }
      const text = typeof data?.text === "string" ? data.text.trim() : "";
      if (!text) {
        setOcrError("图片里没有识别到文字");
        return;
      }
      // 识别结果切成段落插入光标处（空行作为段落分隔），便于接着编辑。
      const paras: string[] = text
        .split(/\n+/)
        .map((t: string) => t.trim())
        .filter(Boolean);
      editor
        .chain()
        .focus()
        .insertContent(
          paras.map((t: string) => ({
            type: "paragraph",
            content: [{ type: "text", text: t }],
          }))
        )
        .run();
      setMediaOpen(false);
    } catch (e) {
      setOcrError(
        e instanceof DOMException && e.name === "TimeoutError"
          ? "识别超时，请换清晰些的图片重试。"
          : e instanceof Error
            ? e.message
            : String(e)
      );
    } finally {
      setOcrUploading(false);
    }
  }

  /** 媒体：粘贴 YouTube / 音频 / 播客 RSS 链接，识别后插入内嵌节点。 */
  function insertMedia() {
    const url = mediaUrl.trim();
    if (!url) return;
    const parsed = parseMediaUrl(url);
    if (parsed) {
      editor
        .chain()
        .focus()
        .insertContent({
          type: "mediaEmbed",
          attrs: { src: parsed.embedUrl, kind: parsed.kind, title: parsed.title },
        })
        .run();
      setMediaUrl("");
      setMediaOpen(false);
      return;
    }
    // 其余 http(s) 链接交给 /api/rss 解析——它现在能识别 Apple Podcast / Google 播客 /
    // 播客主页（抓页面找 RSS 源）/ 直接 RSS 源，解析出源后再列节目。
    if (/^https?:\/\//i.test(url)) {
      void fetchRss(url);
      return;
    }
    setMediaError(
      "无法识别的链接。支持 YouTube、音频直链（mp3/m4a/…）、播客 RSS 源，以及 Apple Podcasts / Google 播客 链接。"
    );
  }

  /** 抓取 RSS 订阅，列出每一集供用户挑选。 */
  async function fetchRss(url: string) {
    setRssLoading(true);
    setRssError(null);
    setMediaError(null);
    try {
      const res = await fetch("/api/rss", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ url }),
      });
      const data = await res.json();
      if (!res.ok) {
        setRssError(data?.error ?? "抓取订阅失败");
        return;
      }
      setRssFeed(data);
    } catch (e) {
      setRssError(e instanceof Error ? e.message : String(e));
    } finally {
      setRssLoading(false);
    }
  }

  /** 选中某一集，作为音频节点插入编辑器。 */
  function insertEpisode(audio: string, title: string) {
    editor
      .chain()
      .focus()
      .insertContent({
        type: "mediaEmbed",
        attrs: { src: audio, kind: "audio", title },
      })
      .run();
    setMediaUrl("");
    setRssFeed(null);
    setRssError(null);
    setMediaError(null);
    setMediaOpen(false);
  }

  return (
    <div className="flex flex-1 flex-col bg-white">
      {/* 工具栏（清爽一条，不描边）；sticky 常驻顶部，写长笔记时不用滚回顶部就能插标题/表格等。
          按钮多时按屏幕宽度自动换行，不横向滚动（键盘弹起时靠 layout 的 interactiveWidget 保持吸顶不上滑）。 */}
      <div className="sticky top-12 z-20 border-b border-zinc-100 bg-white">
        <div className="flex flex-wrap items-center gap-0.5 px-3 py-1.5 md:px-6">
        {/* 标题级别下拉 */}
        <select
          value={blockType}
          onChange={(e) => applyBlockType(e.target.value)}
          title="块样式"
          className="mr-1 rounded-lg border border-zinc-200 bg-white px-2 py-1 text-sm text-zinc-600 focus:border-teal-500 focus:outline-none"
        >
          <option value="paragraph">正文</option>
          <option value="h1">标题</option>
          <option value="h2">小标题</option>
          <option value="h3">副标题</option>
          <option value="codeBlock">等宽样式</option>
        </select>

        <ToolButton onClick={() => editor.chain().focus().toggleBold().run()} active={toolbarActive?.bold ?? false} title="加粗">
          <Bold className="h-4 w-4" />
        </ToolButton>
        <ToolButton onClick={() => editor.chain().focus().toggleItalic().run()} active={toolbarActive?.italic ?? false} title="斜体">
          <Italic className="h-4 w-4" />
        </ToolButton>
        <ToolButton onClick={() => editor.chain().focus().toggleUnderline().run()} active={toolbarActive?.underline ?? false} title="下划线">
          <Underline className="h-4 w-4" />
        </ToolButton>
        <ToolButton onClick={() => editor.chain().focus().toggleHighlight().run()} active={toolbarActive?.highlight ?? false} title="高亮">
          <Highlighter className="h-4 w-4" />
        </ToolButton>
        <ToolButton onClick={() => editor.chain().focus().toggleBulletList().run()} active={toolbarActive?.bulletList ?? false} title="列表">
          <List className="h-4 w-4" />
        </ToolButton>
        <ToolButton onClick={() => editor.chain().focus().toggleBlockquote().run()} active={toolbarActive?.blockquote ?? false} title="引用">
          <Quote className="h-4 w-4" />
        </ToolButton>
        <ToolButton onClick={toggleLink} active={toolbarActive?.link ?? false} title="超链接（选中文字加链接 / 去掉链接）">
          <Link2 className="h-4 w-4" />
        </ToolButton>

        <span className="mx-1 h-5 w-px bg-zinc-200" />

        {/* 表格 / 分列 / 分割线 */}
        <ToolButton onClick={insertNormalTable} title="插入表格">
          <TableIcon className="h-4 w-4" />
        </ToolButton>
        <ToolButton onClick={insertSplitColumns} title="分列（原文 / 译文对照）">
          <Columns2 className="h-4 w-4" />
        </ToolButton>
        <ToolButton
          onClick={() => editor.chain().focus().setHorizontalRule().run()}
          title="分割线（分割区块，转成闪卡只取分割线到标题之间）"
        >
          <Minus className="h-4 w-4" />
        </ToolButton>

        {/* 图片 / 媒体 */}
        <ToolButton onClick={() => fileInputRef.current?.click()} title="上传图片">
          <ImageIcon className="h-4 w-4" />
        </ToolButton>
        <ToolButton onClick={() => setMediaOpen((v) => !v)} title="插入媒体（视频 / 音频）">
          <Video className="h-4 w-4" />
        </ToolButton>
        <input
          ref={fileInputRef}
          type="file"
          accept="image/*"
          className="hidden"
          onChange={pickImage}
        />
        <input
          ref={audioFileRef}
          type="file"
          accept="audio/*,application/octet-stream"
          className="hidden"
          onChange={pickAudioTranscribe}
        />
        <input
          ref={ocrFileRef}
          type="file"
          accept="image/*"
          className="hidden"
          onChange={ocrImage}
        />

        {/* 生词 / 例句 / 语法：3 个纯图标按钮（文字只显示在 callout 卡片上），放在图片/媒体后面，各自淡色系 */}
        <button
          type="button"
          onMouseDown={(e) => e.preventDefault()}
          onTouchStart={(e) => e.preventDefault()}
          onTouchEnd={(e) => {
            e.preventDefault();
            insertKindCallout("word");
          }}
          onClick={() => insertKindCallout("word")}
          title="插入生词区块"
          aria-label="插入生词区块"
          className="ml-1 rounded-lg bg-[#fef8e4] p-2 text-[#9a7328] transition-colors hover:bg-[#f2dfae]"
        >
          <Sprout className="h-4 w-4" />
        </button>
        <button
          type="button"
          onMouseDown={(e) => e.preventDefault()}
          onTouchStart={(e) => e.preventDefault()}
          onTouchEnd={(e) => {
            e.preventDefault();
            insertKindCallout("example");
          }}
          onClick={() => insertKindCallout("example")}
          title="插入例句区块"
          aria-label="插入例句区块"
          className="rounded-lg bg-[#f0f6ec] p-2 text-[#2b795c] transition-colors hover:bg-[#d8e7d2]"
        >
          <MessageSquare className="h-4 w-4" />
        </button>
        <button
          type="button"
          onMouseDown={(e) => e.preventDefault()}
          onTouchStart={(e) => e.preventDefault()}
          onTouchEnd={(e) => {
            e.preventDefault();
            insertKindCallout("grammar");
          }}
          onClick={() => insertKindCallout("grammar")}
          title="插入语法区块"
          aria-label="插入语法区块"
          className="rounded-lg bg-[#dfdefe] p-2 text-[#5a4ac0] transition-colors hover:bg-[#ccc8f2]"
        >
          <Puzzle className="h-4 w-4" />
        </button>
        <button
          type="button"
          onMouseDown={(e) => e.preventDefault()}
          onTouchStart={(e) => e.preventDefault()}
          onTouchEnd={(e) => {
            e.preventDefault();
            insertKindCallout("article");
          }}
          onClick={() => insertKindCallout("article")}
          title="插入原文区块（只读，转成闪卡时跳过）"
          aria-label="插入原文区块"
          className="rounded-lg bg-zinc-100 p-2 text-zinc-500 transition-colors hover:bg-zinc-200"
        >
          <ScrollText className="h-4 w-4" />
        </button>

        <span className="mx-1 h-5 w-px bg-zinc-200" />

        {/* 撤销 / 重做 / AI 学伴：包成一个小组，换行时整体走，不散开 */}
        <div className="flex shrink-0 items-center gap-0.5">
          <ToolButton onClick={() => editor.chain().focus().undo().run()} disabled={!toolbarActive?.canUndo} title="撤销">
            <Undo2 className="h-4 w-4" />
          </ToolButton>
          <ToolButton onClick={() => editor.chain().focus().redo().run()} disabled={!toolbarActive?.canRedo} title="重做">
            <Redo2 className="h-4 w-4" />
          </ToolButton>

          {/* AI 学伴入口：图标用主题色（teal），仍是无底色的图标按钮，融入工具栏又不失辨识度 */}
          <button
            type="button"
            onMouseDown={(e) => e.preventDefault()}
            onTouchStart={(e) => e.preventDefault()}
            onTouchEnd={(e) => {
              e.preventDefault();
              setAssistantOpen(true);
            }}
            onClick={() => setAssistantOpen(true)}
            title="AI 学伴"
            aria-label="AI 学伴"
            className="rounded-lg px-2 py-1.5 text-teal-600 transition-colors hover:bg-teal-50 hover:text-teal-700"
          >
            <Sparkles className="h-4 w-4" />
          </button>
        </div>
        </div>

        {/* 媒体弹窗 */}
        {mediaOpen && (
          <>
            <div className="fixed inset-0 z-10" onClick={() => setMediaOpen(false)} />
            <div className="absolute right-0 top-full z-20 mt-1 w-80 rounded-xl border border-zinc-200 bg-white p-3 shadow-lg md:right-6">
              {rssFeed ? (
                /* RSS 节目列表：挑一集插入 */
                <div>
                  <div className="mb-2 flex items-center justify-between gap-2">
                    <p className="flex min-w-0 items-center gap-1.5 text-xs font-medium text-zinc-500">
                      <Rss className="h-3.5 w-3.5 shrink-0 text-teal-500" />
                      <span className="truncate">选择一集 · {rssFeed.title}</span>
                    </p>
                    <button
                      onClick={() => {
                        setRssFeed(null);
                        setRssError(null);
                      }}
                      className="shrink-0 text-xs text-teal-600 hover:text-teal-700"
                    >
                      ← 换链接
                    </button>
                  </div>
                  <ul className="max-h-64 space-y-0.5 overflow-y-auto">
                    {rssFeed.episodes.map((ep, i) => (
                      <li key={i}>
                        <button
                          onClick={() => insertEpisode(ep.audio, ep.title)}
                          className="flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left text-sm text-zinc-700 transition-colors hover:bg-teal-50"
                        >
                          <AudioLines className="h-3.5 w-3.5 shrink-0 text-teal-500" />
                          <span className="min-w-0 flex-1 truncate">{ep.title}</span>
                        </button>
                      </li>
                    ))}
                  </ul>
                </div>
              ) : (
                /* 输入链接 */
                <div>
                  <p className="mb-2 text-xs font-medium text-zinc-500">
                    粘贴视频（YouTube）、音频直链（mp3/m4a/…）、或播客链接（Apple Podcasts / Google 播客 / RSS 源）
                  </p>
                  <input
                    value={mediaUrl}
                    onChange={(e) => {
                      setMediaUrl(e.target.value);
                      setMediaError(null);
                      setRssError(null);
                    }}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") insertMedia();
                    }}
                    placeholder="https://…"
                    autoFocus
                    className="w-full rounded-lg border border-zinc-200 px-3 py-2 text-sm text-zinc-800 focus:border-teal-500 focus:outline-none"
                  />
                  {mediaError && <p className="mt-1.5 text-xs text-red-600">{mediaError}</p>}
                  {rssError && <p className="mt-1.5 text-xs text-red-600">{rssError}</p>}
                  {/* 本地图片 → 识别文字（视觉 OCR，只读文字），插到光标处 */}
                  <div className="mt-3 border-t border-zinc-100 pt-2.5">
                    <button
                      onClick={() => ocrFileRef.current?.click()}
                      disabled={ocrUploading}
                      className="flex w-full items-center justify-center gap-1.5 rounded-lg border border-zinc-200 py-1.5 text-sm text-zinc-600 transition-colors hover:bg-zinc-50 disabled:opacity-50"
                    >
                      <ScanText className="h-3.5 w-3.5" />
                      {ocrUploading ? "识别中…" : "上传图片 → 识别文字（OCR）"}
                    </button>
                    {ocrError && (
                      <p className="mt-1.5 text-xs text-red-600">{ocrError}</p>
                    )}
                  </div>
                  {/* 本地音频文件 → 直接转成文字稿（多端共用 /api/ai/transcribe-file，云 STT） */}
                  <div className="mt-3 border-t border-zinc-100 pt-2.5">
                    <button
                      onClick={() => audioFileRef.current?.click()}
                      disabled={audioUploading}
                      className="flex w-full items-center justify-center gap-1.5 rounded-lg border border-zinc-200 py-1.5 text-sm text-zinc-600 transition-colors hover:bg-zinc-50 disabled:opacity-50"
                    >
                      <Upload className="h-3.5 w-3.5" />
                      {audioUploading ? "转录中…" : "上传本地音频 → 转文字稿"}
                    </button>
                    {audioError && (
                      <p className="mt-1.5 text-xs text-red-600">{audioError}</p>
                    )}
                  </div>
                  <div className="mt-2 flex justify-end gap-2">
                    <button
                      onClick={() => setMediaOpen(false)}
                      className="rounded-lg px-3 py-1.5 text-sm text-zinc-500 hover:bg-zinc-50"
                    >
                      取消
                    </button>
                    <button
                      onClick={insertMedia}
                      disabled={!mediaUrl.trim() || rssLoading}
                      className="rounded-lg bg-teal-600 px-3 py-1.5 text-sm font-semibold text-white hover:bg-teal-700 disabled:opacity-50"
                    >
                      {rssLoading ? "解析中…" : "嵌入"}
                    </button>
                  </div>
                </div>
              )}
            </div>
          </>
        )}
      {/* 光标在表格里时：横向一条表格操作工具栏（插/删行列、标题行、删表）——嵌在 sticky 容器内跟随吸顶、可横滑，删表始终可达 */}
      {(toolbarActive?.table ?? false) && (
        <div className="no-scrollbar flex items-center gap-0.5 overflow-x-auto border-t border-teal-100 bg-teal-50/70 px-3 py-1 md:px-6">
          <span className="mr-1 text-xs font-medium text-zinc-500">行</span>
          <ToolButton onClick={() => editor.chain().focus().addRowBefore().run()} title="在上方插入一行">
            ＋上
          </ToolButton>
          <ToolButton onClick={() => editor.chain().focus().addRowAfter().run()} title="在下方插入一行">
            ＋下
          </ToolButton>
          <ToolButton onClick={() => editor.chain().focus().deleteRow().run()} title="删除选中的行">
            －行
          </ToolButton>

          <span className="mx-1 h-4 w-px bg-zinc-300" />

          <span className="mr-1 text-xs font-medium text-zinc-500">列</span>
          <ToolButton onClick={() => editor.chain().focus().addColumnBefore().run()} title="在左侧插入一列">
            ＋左
          </ToolButton>
          <ToolButton onClick={() => editor.chain().focus().addColumnAfter().run()} title="在右侧插入一列">
            ＋右
          </ToolButton>
          <ToolButton onClick={() => editor.chain().focus().deleteColumn().run()} title="删除选中的列">
            －列
          </ToolButton>

          <span className="mx-1 h-4 w-px bg-zinc-300" />

          <ToolButton onClick={() => editor.chain().focus().toggleHeaderRow().run()} title="切换标题行">
            标题行
          </ToolButton>
          <ToolButton onClick={() => editor.chain().focus().deleteTable().run()} title="删除整个表格">
            删表
          </ToolButton>
        </div>
      )}
      </div>

      {/* 高亮即解释：选区上方浮出「✨ 解释」气泡；点后换成 释义+词组+例句 + 收录 */}
      {explain &&
        createPortal(
          result ? (
            <div
              style={{
                left: Math.min(Math.max(explain.left, 8), window.innerWidth - 376),
                top: Math.max(8, Math.min(explain.bottom + 8, window.innerHeight - 360)),
              }}
              className="fixed z-50 w-[360px] max-w-[calc(100vw-2rem)] overflow-hidden rounded-xl border border-zinc-200 bg-white shadow-2xl"
            >
              <div className="flex items-start justify-between gap-2 border-b border-zinc-100 px-3 py-2">
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <span className="truncate text-sm font-bold text-zinc-900">
                      {result.baseForm}
                    </span>
                    {result.partOfSpeech && (
                      <span className="shrink-0 rounded-full bg-teal-50 px-2 py-0.5 text-[11px] font-medium text-teal-600">
                        {result.partOfSpeech}
                      </span>
                    )}
                  </div>
                  {result.phonetic && (
                    <p className="mt-0.5 text-xs text-zinc-400">/{result.phonetic}/</p>
                  )}
                </div>
                <button
                  type="button"
                  onClick={() => {
                    setResult(null);
                    setExplain(null);
                  }}
                  className="rounded-md p-1 text-zinc-400 hover:bg-zinc-100 hover:text-zinc-700"
                  aria-label="关闭"
                >
                  <X className="h-4 w-4" />
                </button>
              </div>
              <div className="max-h-[60vh] space-y-2 overflow-y-auto px-3 py-3 text-sm">
                <p className="text-zinc-700">
                  <span className="mr-1 text-xs font-medium text-zinc-400">释义</span>
                  {result.meaning}
                </p>
                {result.collocations && (
                  <p className="whitespace-pre-line text-zinc-600">
                    <span className="mr-1 text-xs font-medium text-zinc-400">词组</span>
                    {result.collocations}
                  </p>
                )}
                {result.example && (
                  <p className="whitespace-pre-line text-zinc-600">
                    <span className="mr-1 text-xs font-medium text-zinc-400">例句</span>
                    {result.example}
                  </p>
                )}
                {explainError && <p className="text-xs text-red-600">{explainError}</p>}
              </div>
              <div className="border-t border-zinc-100 px-3 py-2">
                <button
                  type="button"
                  onClick={collect}
                  disabled={collecting || collected}
                  className="w-full rounded-lg bg-teal-600 py-2 text-sm font-semibold text-white transition-colors hover:bg-teal-700 disabled:opacity-60"
                >
                  {collecting ? "收录中…" : collected ? "已收录 ✓" : "收录到闪卡"}
                </button>
              </div>
            </div>
          ) : explainError ? (
            <div
              style={{
                left: Math.min(Math.max(explain.left, 8), window.innerWidth - 320),
                top: Math.max(8, Math.min(explain.bottom + 8, window.innerHeight - 120)),
              }}
              className="fixed z-50 flex items-center gap-2 rounded-xl border border-red-200 bg-white px-3 py-2 shadow-2xl"
            >
              <p className="text-xs text-red-600">{explainError}</p>
              <button
                type="button"
                onClick={() => {
                  setExplainError(null);
                  setExplain(null);
                }}
                className="rounded-md p-1 text-zinc-400 hover:bg-zinc-100 hover:text-zinc-700"
                aria-label="关闭"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
          ) : (
            <button
              type="button"
              onMouseDown={(e) => e.preventDefault()}
              onClick={runExplain}
              disabled={explainBusy}
              style={{
                left: Math.min(Math.max(explain.left, 8), window.innerWidth - 160),
                top: explain.top - 8,
                transform: "translateY(-100%)",
              }}
              className="fixed z-50 inline-flex items-center gap-1 rounded-full bg-zinc-900 px-3 py-1.5 text-xs font-medium text-white shadow-lg transition-colors hover:bg-zinc-700 disabled:opacity-60"
            >
              <Sparkles className="h-3.5 w-3.5" />
              {explainBusy ? "解释中…" : "解释"}
            </button>
          ),
          document.body
        )}

      {/* 「原文」callout 按钮执行中的小气泡：钉在刚才点的按钮下方，靠点击瞬间抓到的 rect 定位 */}
      {calloutBusy &&
        createPortal(
          <div
            style={{
              left: Math.min(Math.max(calloutBusy.rect.left, 60), window.innerWidth - 60),
              top: calloutBusy.rect.top + calloutBusy.rect.height + 6,
              transform: "translateX(-50%)",
            }}
            className="fixed z-50 flex items-center gap-1.5 rounded-full bg-zinc-900 px-3 py-1.5 text-xs font-medium text-white shadow-lg"
          >
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
            {calloutBusy.label}
          </div>,
          document.body
        )}

      <EditorContent editor={editor} className="flex-1" />

      {assistantOpen && (
        <AiAssistantPanel
          editor={editor}
          noteId={noteId}
          onClose={() => setAssistantOpen(false)}
        />
      )}
    </div>
  );
}
