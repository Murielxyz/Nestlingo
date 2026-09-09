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
  Strikethrough,
  Highlighter,
  List,
  Quote,
  AlignLeft,
  AlignCenter,
  AlignRight,
  Table as TableIcon,
  Image as ImageIcon,
  Video,
  Undo2,
  Redo2,
  AudioLines,
  Rss,
  Sparkles,
  ScanText,
  Loader2,
  Link2,
  X,
  ChevronDown,
  Type,
  Sprout,
  MessageSquare,
  Puzzle,
  ScrollText,
  StickyNote,
  type LucideIcon,
} from "lucide-react";
import { editorExtensions } from "@/lib/editor-extensions";
import { docToText } from "@/lib/doc-to-text";
import { parseMediaUrl } from "@/lib/media";
import { Extension } from "@tiptap/core";
import type { Editor, JSONContent } from "@tiptap/core";
import { createPortal } from "react-dom";
import { createClient } from "@/lib/supabase/client";
import { detectCardLang } from "@/lib/lang-detect";
import { normalizeFront } from "@/lib/normalize-front";
import { AiAssistantPanel } from "./ai-assistant-panel";
import { runCalloutAction, setCalloutActionHandler } from "@/lib/callout-actions";
import type { ExplainResult } from "@/app/api/ai/explain/route";
import { getCachedExplain, setCachedExplain } from "@/lib/explain-cache";
import { WORD_TITLES } from "@/lib/parse-sections";
import type { Card } from "@/lib/types";
import { CardFront } from "./card-front";
import { CardBack } from "./card-back";

/** 触屏设备：系统选中文字会弹出原生「拷贝/翻译」菜单（在选区上方）。
 *  我们的「✨ 解释」气泡若也放选区上方，会和原生的叠在一起。
 *  粗指针（手机/平板）用「放选区下方」避开；鼠标仍放上方贴近光标。 */
const COARSE_POINTER =
  typeof window !== "undefined" &&
  typeof window.matchMedia === "function" &&
  window.matchMedia("(pointer: coarse)").matches;

/** 装饰插件 key：注册 / 注销都用它定位。 */
const collectedWordKey = new PluginKey("collectedWordDecorations");

/** 搭配归一化：把模型偶尔用 `+`、`／`、换行挤在一起的多个词组折成顿号，避免出现「…+…」或换行拆成两张卡。 */
function normalizeColloc(s: string): string {
  return (s ?? "")
    .replace(/[+／]/g, "、")
    .replace(/\s*\n+\s*/g, "、")
    .replace(/、+/g, "、")
    .replace(/^、+|、+$/g, "")
    .trim();
}

/** 点开看闪卡 / 下划线标识所需的卡片子集（front/back/kind/lang/reading 足够展示）。 */
type CollectedCard = Pick<Card, "front" | "back" | "kind" | "lang" | "reading">;

/** 判断文档位置 pos 是否落在「原文（article）callout」内。
 *  「进闪卡」下划线只标在原文 callout 里（阅读文章时点词查义），生词区/正文不标。 */
function inArticleCallout(doc: PMNode, pos: number): boolean {
  const $pos = doc.resolve(pos);
  for (let d = $pos.depth; d > 0; d--) {
    const node = $pos.node(d);
    if (node.type.name === "callout" && node.attrs.kind === "article") return true;
  }
  return false;
}

/** 「进闪卡」下划线装饰：只在原文 callout 内，把 words 里命中的字串（长词优先）套上 className。
 *  纯装饰（Decoration），不改动笔记 JSON。 */
function wordDecorations(doc: PMNode, words: Set<string>, className: string): DecorationSet {
  const terms = Array.from(words)
    .filter((w) => w.length > 0)
    .sort((a, b) => b.length - a.length);
  if (terms.length === 0) return DecorationSet.empty;
  const decos: Decoration[] = [];
  doc.descendants((node, pos) => {
    if (!node.isText) return;
    if (!inArticleCallout(doc, pos)) return;
    const text = node.text ?? "";
    for (const term of terms) {
      let idx = text.indexOf(term);
      while (idx !== -1) {
        decos.push(
          Decoration.inline(pos + idx, pos + idx + term.length, { class: className })
        );
        idx = text.indexOf(term, idx + term.length);
      }
    }
  });
  return DecorationSet.create(doc, decos);
}

/** 反查 pos 落在哪个 front 的区间内（供「点下划线词弹卡详情」用）。
 *  与 wordDecorations 同一套「只认原文 callout」+ indexOf 匹配逻辑，命中返回该 front 字串。 */
function frontAtPos(doc: PMNode, fronts: Set<string>, pos: number): string | null {
  let hit: string | null = null;
  doc.descendants((node, npos) => {
    if (hit || !node.isText) return;
    if (!inArticleCallout(doc, npos)) return;
    const len = node.text?.length ?? 0;
    if (pos < npos || pos >= npos + len) return;
    const text = node.text ?? "";
    for (const front of fronts) {
      if (!front) continue;
      let idx = text.indexOf(front);
      while (idx !== -1) {
        const from = npos + idx;
        if (pos >= from && pos < from + front.length) {
          hit = front;
          return;
        }
        idx = text.indexOf(front, idx + front.length);
      }
    }
  });
  return hit;
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
      onClick={onClick}
      disabled={disabled}
      title={title}
      className={`shrink-0 whitespace-nowrap rounded-lg px-2 py-1.5 transition-colors ${
        active
          ? "bg-teal-100 text-teal-700"
          : "text-zinc-600 hover:bg-zinc-100 hover:text-zinc-900"
      } ${disabled ? "cursor-not-allowed opacity-40 hover:bg-transparent" : ""}`}
    >
      {children}
    </button>
  );
}

/** 选区文字里是否含超链接。整段选中「链接+空格/其它文字」时 editor.isActive("link") 会为 false
 *  （因为它要求整段都处于链接里），这里扫一遍选区范围内的文本节点兜底，开关按钮靠它识别「这段有链接」。 */
function selectionContainsLink(editor: Editor): boolean {
  const { from, to } = editor.state.selection;
  let found = false;
  editor.state.doc.nodesBetween(from, to, (node) => {
    if (!found && node.isText && node.marks?.some((m) => m.type.name === "link")) {
      found = true;
    }
  });
  return found;
}

export function RichTextEditor({
  initialContent,
  onChange,
  noteId,
  readOnly,
  onFocusTitle,
  focusBodySignal,
  onTranslateTitle,
}: {
  initialContent?: unknown;
  onChange?: (json: JSONContent | null, text: string) => void;
  noteId: string;
  /** 阅读模式：内容只读（点下划线词弹卡查义、无软键盘），不显示编辑工具栏。 */
  readOnly?: boolean;
  onFocusTitle?: () => void;
  /** 标题里按回车时 +1，编辑器收到变化后把焦点移回正文开头。 */
  focusBodySignal?: number;
  /** 「原文」callout 翻译成功后顺带翻译笔记标题（由父组件提供）。 */
  onTranslateTitle?: () => Promise<void>;
}) {
  // 本笔记「已收录进闪卡」的词 → 卡片映射（持久：挂载时从闪卡拉，收录/记录成功后追加）。
  // 两处用途：① 原文 callout 里给这些词加下划线装饰（collectedFrontsRef 原始 front 精确匹配）；
  // ② 点下划线词时反查对应卡片弹详情（collectedCardsRef 按 normalizeFront 索引）。
  const collectedCardsRef = useRef<Map<string, CollectedCard>>(new Map());
  const collectedFrontsRef = useRef<Set<string>>(new Set());
  // 阅读模式存 ref：handleClick 闭包只挂一次（useEditor deps 稳定），用 ref 读最新 readOnly。
  const readOnlyRef = useRef(!!readOnly);
  // busy 令牌：较长动作（如精读/翻译）完成时只清掉「是自己那次」的忙碌气泡，
  // 避免先发起的动作后返回时把另一个（更新的）动作的忙碌状态误清掉。
  const calloutBusyTokenRef = useRef(0);
  // onTranslateTitle 存进 ref：callout 点击处理器只挂一次（deps=[editor]），
  // 用 ref 读最新回调，避免父组件每次重渲染都重新注册处理器。
  const onTranslateTitleRef = useRef(onTranslateTitle);
  useEffect(() => {
    onTranslateTitleRef.current = onTranslateTitle;
  }, [onTranslateTitle]);

  // 装饰插件：每次视图更新时按 collectedFrontsRef 给命中的字串套 .collected-word（下划线，仅原文 callout）。
  // 用 Extension + addProseMirrorPlugins 在编辑器创建时一次性挂上（不写进笔记内容），
  // 不用 useEffect + registerPlugin —— 那在 React 严格模式（开发）下会把同一个 key
  // 的插件实例重复注册，报「Adding different instances of a keyed plugin」。
  const WordDecorations = useMemo(
    () =>
      Extension.create({
        name: "wordDecorations",
        addProseMirrorPlugins() {
          return [
            new Plugin({
              key: collectedWordKey,
              props: {
                decorations(state) {
                  const words = collectedFrontsRef.current;
                  if (words.size === 0) return DecorationSet.empty;
                  return wordDecorations(state.doc, words, "collected-word");
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
      WordDecorations,
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
      // 首行空段（下面跟着 callout 等）按 Backspace 无法删除：仿 Notion，
      // 光标在文档第一块（空段落）开头时按 Backspace → 删掉空段并把焦点交回笔记标题。
      handleKeyDown: (view, event) => {
        // ⌘K / Ctrl-K：链接（复用工具栏「超链接」按钮同一套 prompt 流程）。
        // metaKey=macOS ⌘，ctrlKey=Windows/Linux Ctrl，两边都覆盖。
        if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
          toggleLink();
          return true;
        }
        if (event.key !== "Backspace" || !onFocusTitle) return false;
        const { state } = view;
        const { selection } = state;
        if (!selection.empty) return false;
        const first = state.doc.firstChild;
        if (!first || first.type.name !== "paragraph" || first.childCount !== 0) return false;
        if (selection.from > 1) return false;
        view.dispatch(state.tr.delete(0, first.nodeSize));
        onFocusTitle();
        return true;
      },
      // 单击（非拖选）落在已收录词的下划线上 → 弹出该词闪卡详情。
      // 拖选仍走现有「记录 / 解释 / 复制」气泡，不抢。
      handleClick: (view, _pos, event) => {
        if (!readOnlyRef.current) return false;
        if (!view.state.selection.empty) return false;
        const pos = view.posAtCoords({ left: event.clientX, top: event.clientY })?.pos;
        if (pos == null) return false;
        const front = frontAtPos(view.state.doc, collectedFrontsRef.current, pos);
        if (!front) return false;
        const card = collectedCardsRef.current.get(normalizeFront(front));
        if (!card) return false;
        setCardDetail(card);
        return true;
      },
    },
    onUpdate: ({ editor }) => {
      onChange?.(editor.getJSON(), docToText(editor.getJSON()));
    },
  });

  // 阅读 / 编辑模式：readOnly 变化时同步 setEditable；存 ref 供 handleClick 读最新值。
  useEffect(() => {
    readOnlyRef.current = !!readOnly;
    editor?.setEditable(!readOnly);
  }, [readOnly, editor]);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const ocrFileRef = useRef<HTMLInputElement>(null);
  const toolbarScrollAtRef = useRef(0);
  const [blockType, setBlockType] = useState("paragraph");
  const [mediaOpen, setMediaOpen] = useState(false);
  const [mediaUrl, setMediaUrl] = useState("");
  const [mediaError, setMediaError] = useState<string | null>(null);
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
    from: number;
    to: number;
    left: number;
    top: number;
    bottom: number;
  } | null>(null);
  const [result, setResult] = useState<ExplainResult | null>(null);
  const [explainBusy, setExplainBusy] = useState(false);
  const [explainError, setExplainError] = useState<string | null>(null);
  const [collected, setCollected] = useState(false);
  const [collecting, setCollecting] = useState(false);
  const [importedToNote, setImportedToNote] = useState(false);
  const [importingToNote, setImportingToNote] = useState(false);
  // 「记录」：选中后轻量收录，直接建一张闪卡（不依赖解释 AI）。
  const [recordMode, setRecordMode] = useState(false);
  const [recordKind, setRecordKind] = useState<"word" | "example" | "grammar">("word");
  const [recordFront, setRecordFront] = useState("");
  const [recordBack, setRecordBack] = useState("");
  const [recording, setRecording] = useState(false);
  const [recorded, setRecorded] = useState(false);
  // 去重命中：不自动收起、提示改淡灰、按钮「已存在 ✓」，用户手动 ✕ 关闭。
  const [recordDup, setRecordDup] = useState(false);
  const [recordError, setRecordError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  // 点下划线词弹出的「该词闪卡」详情（独立状态，不挂在 explain/recordMode 上，避免被 selectionUpdate 清掉）。
  const [cardDetail, setCardDetail] = useState<CollectedCard | null>(null);
  // 记录成功后短暂闪一下「已存入 ✓」再自动收起表单，免去手动取消。
  const recordCloseTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [assistantOpen, setAssistantOpen] = useState(false);
  // 「格式 / 插入」格网面板当前展开哪一个：格式（块样式 + 字母格式格网）/ 插入（表格/图片/媒体），null = 收起。
  const [openPanel, setOpenPanel] = useState<"format" | "insert" | null>(null);
  // 「原文」callout 按钮的执行中反馈：记下按钮位置 + 文案，在按钮旁弹一个「…中」小气泡（复刻高亮解释气泡）。
  const [calloutBusy, setCalloutBusy] = useState<{ label: string; rect: DOMRect } | null>(null);

  // 工具栏激活态（加粗/斜体/下划线/高亮/列表/表格）要跟着选区实时刷新：
  // 之前直接在 JSX 里 `editor.isActive(...)`，但组件不会因选区变化重渲染，高亮就「点了不变」。
  // useEditorState 订阅 transaction/update，选中态变化时重新取一遍，保证高亮点击可开可关。
  const toolbarActive = useEditorState({
    editor,
    selector: ({ editor: e }) => {
      if (!e) return { bold: false, italic: false, underline: false, strike: false, highlight: false, link: false, bulletList: false, blockquote: false, table: false, align: null, canUndo: false, canRedo: false };
      if (e.isDestroyed) {
        // 编辑器已销毁（commandManager 被置空），此时 e.can() 会读 null.can 崩溃。
        // 返回安全默认值，直到下一次重建的编辑器就绪。
        return { bold: false, italic: false, underline: false, strike: false, highlight: false, link: false, bulletList: false, blockquote: false, table: false, align: null, canUndo: false, canRedo: false };
      }
      return {
        bold: e.isActive("bold"),
        italic: e.isActive("italic"),
        underline: e.isActive("underline"),
        strike: e.isActive("strike"),
        highlight: e.isActive("highlight"),
        link: e.isActive("link") || selectionContainsLink(e),
        bulletList: e.isActive("bulletList"),
        blockquote: e.isActive("blockquote"),
        table: e.isActive("table"),
        align: e.isActive({ textAlign: "left" })
          ? "left"
          : e.isActive({ textAlign: "center" })
            ? "center"
            : e.isActive({ textAlign: "right" })
              ? "right"
              : null,
        canUndo: e.can().undo(),
        canRedo: e.can().redo(),
      };
    },
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

  // 挂载时从闪卡拉本笔记全部卡片，建立「front → 卡」映射，驱动下划线装饰（持久：刷新后仍标识）。
  useEffect(() => {
    if (!editor) return;
    let cancelled = false;
    (async () => {
      const supabase = createClient();
      const { data: cards, error } = await supabase
        .from("cards")
        .select("*")
        .eq("note_id", noteId)
        .order("position", { ascending: true })
        .order("created_at", { ascending: true });
      if (cancelled) return;
      if (error) return;
      const byFront = new Map<string, CollectedCard>();
      const fronts = new Set<string>();
      for (const c of (cards ?? []) as Card[]) {
        const front = c.front.trim();
        if (!front) continue;
        fronts.add(front);
        byFront.set(normalizeFront(front), c);
      }
      collectedCardsRef.current = byFront;
      collectedFrontsRef.current = fronts;
      editor.view.dispatch(editor.state.tr);
    })();
    return () => {
      cancelled = true;
    };
  }, [editor, noteId]);

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
      void runCalloutAction(
        editor,
        action,
        pos,
        action === "translate"
          ? { onTranslated: async () => { await onTranslateTitleRef.current?.(); } }
          : undefined
      ).finally(() => {
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
    const resetRecord = () => {
      setRecordMode(false);
      setRecorded(false);
      setRecordDup(false);
      setRecordError(null);
      setCopied(false);
    };
    const update = () => {
      const { from, to } = editor.state.selection;
      resetRecord();
      if (from === to) {
        setExplain(null);
        setResult(null);
        setExplainError(null);
        setCollected(false);
        setImportedToNote(false);
        setImportingToNote(false);
        return;
      }
      const text = editor.state.doc.textBetween(from, to, " ", " ");
      const trimmed = text.trim();
      if (!trimmed || trimmed.length > 120) {
        setExplain(null);
        setResult(null);
        setExplainError(null);
        setCollected(false);
        setImportedToNote(false);
        setImportingToNote(false);
        return;
      }
      const coords = editor.view.coordsAtPos(from);
      setOpenPanel(null); // 选中词要弹「✨ 解释」气泡时，先关掉格式面板，避免互相遮挡
      setExplain({
        text: trimmed,
        from,
        to,
        left: coords.left,
        top: coords.top,
        bottom: coords.bottom,
      });
      setResult(null);
      setExplainError(null);
      setCollected(false);
      setImportedToNote(false);
      setImportingToNote(false);
    };
    editor.on("selectionUpdate", update);
    return () => {
      editor.off("selectionUpdate", update);
    };
  }, [editor]);

  // 卸载时清掉记录表单的自动收起定时器。
  useEffect(() => {
    return () => {
      if (recordCloseTimerRef.current) clearTimeout(recordCloseTimerRef.current);
    };
  }, []);

  // 标题里按回车 → 焦点移回正文开头（配合 note-editor 的 focusBodySignal）。
  useEffect(() => {
    if (!focusBodySignal || !editor) return;
    editor.chain().focus("start").run();
  }, [focusBodySignal, editor]);

  if (!editor) {
    return <div className="flex-1 bg-white" />;
  }

  /** 调 AI 解释选中的词/短语，结果放进 result（释义+词组+例句）。 */
  async function runExplain() {
    if (!explain || explainBusy) return;
    setExplainBusy(true);
    setExplainError(null);
    setResult(null);
    // 同一个词解释过一次 → 直接命中本地缓存，不再重复烧 token。
    const cached = getCachedExplain(explain.text);
    if (cached) {
      setResult(cached);
      setExplainBusy(false);
      return;
    }
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
      setCachedExplain(explain.text, data as ExplainResult);
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
    // 同词不重复：正面归一化（去括号读音/压空白）比对，与「记录到闪卡」一致（同转卡逻辑）。
    const { data: existRows } = await supabase
      .from("cards")
      .select("front")
      .eq("note_id", noteId);
    const normFronts = new Set(
      ((existRows ?? []) as { front: string }[]).map((c) => normalizeFront(c.front))
    );
    if (normFronts.has(normalizeFront(result.baseForm))) {
      setCollecting(false);
      setCollected(true);
      setExplainError("这个词已经在闪卡里了。");
      return;
    }
    const meaning = result.partOfSpeech
      ? `[${result.partOfSpeech}] ${result.meaning}`
      : result.meaning;
    const colloc = normalizeColloc(result.collocations);
    const example = result.example.replace(/\s*\n+\s*/g, " ");
    const back = [
      meaning,
      result.phonetic ? `读音：${result.phonetic}` : "",
      colloc ? `搭配：${colloc}` : "",
      example ? `例句：${example}` : "",
    ]
      .filter(Boolean)
      .join("\n");
    // 排到合集末尾（position 递增），与「记录」一致——避免收录的词插到最前。
    const { data: posRes } = await supabase
      .from("cards")
      .select("position")
      .eq("note_id", noteId)
      .order("position", { ascending: false })
      .limit(1);
    const position = (posRes?.[0]?.position ?? -1) + 1;
    const { error } = await supabase.from("cards").insert({
      note_id: noteId,
      front: result.baseForm,
      back,
      kind: "word",
      lang: detectCardLang({ front: result.baseForm, back }),
      position,
    });
    setCollecting(false);
    if (error) {
      setExplainError(error.message);
      return;
    }
    setCollected(true);
    // 把新卡加进「已收录」映射，下划线装饰立即生效（front=词典原形）。
    collectedFrontsRef.current.add(result.baseForm);
    collectedCardsRef.current.set(normalizeFront(result.baseForm), {
      front: result.baseForm,
      back,
      kind: "word",
      lang: detectCardLang({ front: result.baseForm, back }),
      reading: result.phonetic,
    });
    editor.view.dispatch(editor.state.tr);
    // 通知右侧闪卡侧栏立即刷新。
    window.dispatchEvent(new CustomEvent("ln-cards-changed"));
  }

  /** 把解释结果「导入到笔记」：拼成一条「词：释义  搭配…  例句…」普通段落。
   *  覆盖优先——选中词所在行是词条（word callout 内 / 「生词」标题下 / 或裸段落里词在行首）→ 覆盖这一行；
   *  否则（句子里选词）追加到生词区：有生词 callout → 进 callout 末尾；有「生词」标题 → 插标题区末尾；
   *  都没有 → 新建生词 callout。 */
  function importToNote() {
    if (!result || importedToNote || importingToNote) return;
    setImportingToNote(true);
    setExplainError(null);

    // 读音统一放背面（与「收录到闪卡」「AI 补全」一致），正面只留原词。
    const front = result.baseForm;
    const back = [
      result.partOfSpeech ? `[${result.partOfSpeech}] ${result.meaning}` : result.meaning,
      result.phonetic ? `读音：${result.phonetic}` : "",
    ]
      .filter(Boolean)
      .join("\n");
    const extra = [
      `搭配：${normalizeColloc(result.collocations)}`,
      `例句：${result.example.replace(/\s*\n+\s*/g, " ")}`,
    ]
      .filter((s) => s !== "搭配：" && s !== "例句：")
      .join("  ");
    // 落笔记用普通段落（不用列表，贴合用户记笔记习惯）；与 item() 同款拼行，\n 折成双空格，
    // 转成闪卡时 parseCards 再把双空格拆回换行（docToText 对段落与列表输出的纯文本一致，识别不受影响）。
    // 正面生词用 bold mark 写进 JSON（持久、只影响本次导入的行，手写词条不受影响）；docToText 忽略 mark，转卡/搜索不受影响。
    const b = back.replace(/\n/g, "  ");
    const e = extra.replace(/\n/g, "  ");
    const rest = [front && b ? `：${b}` : b, e].filter(Boolean).join("  ");
    const paraNode: JSONContent = {
      type: "paragraph",
      content: [
        ...(front ? [{ type: "text", text: front, marks: [{ type: "bold" }] }] : []),
        ...(rest ? [{ type: "text", text: rest }] : []),
      ],
    };

    // 若选中的词本身就在「生词区域」（word callout 内，或「生词」标题下），
    // 说明是在重解释已有的一个生词行 —— 直接覆盖那一行，而不是追加新行。
    function resolveWordBlock(): { from: number; to: number } | null {
      if (!explain) return null;
      const $p = editor.state.doc.resolve(explain.from);
      // 向上定位选中词所在的文本块（paragraph / heading）。
      let depth = $p.depth;
      while (depth > 0 && !$p.node(depth).isTextblock) depth--;
      if (depth <= 0) return null;
      // 原文（article）callout 内的词 → 不覆盖，走「追加到生词区」，把词从原文抽出来。
      for (let d = depth; d > 0; d--) {
        if ($p.node(d).type.name === "callout" && $p.node(d).attrs.kind === "article") {
          return null;
        }
      }
      // 覆盖的唯一条件：这一行是「生词词条」——选中词在行首，且词后是「空 / 释义分隔符
      // （：:—–-）/ 双空格分隔的释义」。句子的第一个词（词后单空格或直接跟字，如韩语
      // 연락은 / 英语 Contact is / 中文 联系很）不覆盖，走「追加到生词区」，避免覆盖整句。
      const start = $p.start(depth);
      const text = $p.node(depth).textContent;
      const before = text.slice(0, explain.from - start);
      const after = text.slice(explain.to - start);
      const isEntryLine =
        before.trim() === "" &&
        (after.trim() === "" ||
          /^[：:—–\-]/.test(after.trimStart()) ||
          /^\s{2,}/.test(after));
      if (!isEntryLine) return null;
      return { from: $p.before(depth), to: $p.after(depth) };
    }
    const block = resolveWordBlock();
    if (block) {
      editor
        .chain()
        .deleteRange({ from: block.from, to: block.to })
        .insertContentAt(block.from, paraNode)
        .run();
      setImportingToNote(false);
      setImportedToNote(true);
      return;
    }

    const doc = editor.getJSON();
    const content = (doc.content ?? []) as JSONContent[];

    // 1) 已有生词 callout → 追加一段普通段落到其末尾。
    const wordCallout = content.find(
      (n) => n.type === "callout" && n.attrs?.kind === "word"
    );
    if (wordCallout) {
      wordCallout.content = [...((wordCallout.content ?? []) as JSONContent[]), paraNode];
      editor.commands.setContent({ type: "doc", content });
      setImportingToNote(false);
      setImportedToNote(true);
      return;
    }

    // 2) 顶层含「生词」标题 → 追加到该 word 区域**末尾**（跳过已有段落/列表，插到下一个 heading / callout 前）。
    const headingIdx = content.findIndex((n) => {
      if (n.type !== "heading") return false;
      const t = docToText({ type: "doc", content: [n] })
        .trim()
        .replace(/^#+\s*/, "")
        .toLowerCase();
      return WORD_TITLES.has(t);
    });
    if (headingIdx >= 0) {
      let insertAt = headingIdx + 1;
      for (let i = headingIdx + 1; i < content.length; i++) {
        const n = content[i];
        if (n.type === "heading" || n.type === "callout") break;
        insertAt = i + 1;
      }
      content.splice(insertAt, 0, paraNode);
      editor.commands.setContent({ type: "doc", content });
      setImportingToNote(false);
      setImportedToNote(true);
      return;
    }

    // 3) 都没有 → 新建生词 callout（句子里选词：把这个词抽取成独立生词条目，归入生词区）。
    editor
      .chain()
      .focus("end")
      .insertContent({
        type: "callout",
        attrs: { kind: "word" },
        content: [paraNode],
      })
      .run();
    setImportingToNote(false);
    setImportedToNote(true);
  }

  /** 记录成功后让「已存入 ✓」闪一下（约 0.5s）再自动收起表单，免去手动取消。 */
  function closeRecordSoon() {
    if (recordCloseTimerRef.current) clearTimeout(recordCloseTimerRef.current);
    recordCloseTimerRef.current = setTimeout(() => setRecordMode(false), 500);
  }

  /** 「记录」：把选中文本直接存成一张闪卡——不走解释 AI，原文在卡上也能改（有些不是原形）。
   *  与「收录到闪卡」一样按 note_id 归到本笔记合集，并去重（同转卡逻辑：正面去掉括号注释后比对）。 */
  async function recordInto() {
    const front = recordFront.trim();
    if (!front || recording) return;
    setRecording(true);
    setRecordError(null);
    setRecorded(false);
    setRecordDup(false);
    const supabase = createClient();
    // 去重：本笔记合集里正面已存在（忽略括号读音/空白差异）就不再插。
    const { data: existing } = await supabase
      .from("cards")
      .select("front")
      .eq("note_id", noteId);
    const fronts = new Set(
      ((existing ?? []) as { front: string }[]).map((c) => normalizeFront(c.front))
    );
    if (fronts.has(normalizeFront(front))) {
      setRecording(false);
      setRecorded(true);
      setRecordDup(true);
      setRecordError("这个词已经在闪卡里了。");
      return; // 去重命中不自动收起，用户手动 ✕ 关
    }
    // 排到本笔记卡片末尾（position 递增），避免新卡插到最前。
    const { data: posRes } = await supabase
      .from("cards")
      .select("position")
      .eq("note_id", noteId)
      .order("position", { ascending: false })
      .limit(1);
    const position = (posRes?.[0]?.position ?? -1) + 1;
    const back = recordBack.trim() || null; // 背面留空则只存正面
    const { error } = await supabase.from("cards").insert({
      note_id: noteId,
      front,
      back, // ← 之前误写成 null，背面的含义没存进去
      kind: recordKind,
      lang: detectCardLang({ front }),
      position,
    });
    setRecording(false);
    if (error) {
      setRecordError(error.message);
      return;
    }
    setRecorded(true);
    setRecordDup(false);
    // 「记录」也把新词标进原文下划线（与「收录到闪卡」同源），点它可弹该词闪卡。
    collectedFrontsRef.current.add(front);
    collectedCardsRef.current.set(normalizeFront(front), {
      front,
      back: back ?? "",
      kind: recordKind,
      lang: detectCardLang({ front }),
      reading: null,
    });
    editor.view.dispatch(editor.state.tr);
    // 通知右侧闪卡侧栏立即刷新（它监听 `ln-cards-changed`）。
    window.dispatchEvent(new CustomEvent("ln-cards-changed"));
    closeRecordSoon();
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

  /** 链接开关：选中文字里已有链接（含「链接+空格」这类混选）→ 去掉超链接；
   *  否则给选中的纯文字套一个链接（弹框输入地址）。 */
  function toggleLink() {
    if (!editor) return;
    if (editor.isActive("link") || selectionContainsLink(editor)) {
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

  /** 生词 / 例句 / 语法 / 文章 / 备注：插一个 callout 块，内容「转成闪卡」时按标签自动归类（文章 / 备注跳过）。 */
  function insertKindCallout(kind: "word" | "example" | "grammar" | "article" | "note") {
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
          attrs: { src: parsed.embedUrl, kind: parsed.kind, title: parsed.title, cover: parsed.thumbnail ?? null },
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

  // —— 工具栏复用片段：桌面顶栏 / 移动底栏调用同一批命令，避免两份 JSX 各写一遍 ——
  const calloutsInline = ([
    { kind: "article", label: "文章", Icon: ScrollText, color: "#a1a1aa" },
    { kind: "word", label: "生词", Icon: Sprout, color: "#8a6b3a" },
    { kind: "example", label: "例句", Icon: MessageSquare, color: "#4a7a5d" },
    { kind: "grammar", label: "语法", Icon: Puzzle, color: "#6a5fc0" },
    { kind: "note", label: "备注", Icon: StickyNote, color: "#9ca3af" },
  ] as { kind: "word" | "example" | "grammar" | "article" | "note"; label: string; Icon: LucideIcon; color: string }[]).map(({ kind, label, Icon, color }) => (
    <button
      key={kind}
      type="button"
      onMouseDown={(e) => e.preventDefault()}
      onClick={() => insertKindCallout(kind)}
      title={label}
      className="flex shrink-0 items-center gap-1 rounded-lg px-1.5 py-1 text-[13px] transition-colors hover:bg-zinc-100"
    >
      <Icon className="h-4 w-4" style={{ color }} />
    </button>
  ));

  // 字母格式（加粗/斜体/下划线/删除线/高亮/列表/引用/链接/缩进）——桌面行内平铺；移动端放进「格式」格网
  const formatButtons = (
    <>
      <ToolButton onClick={() => editor.chain().focus().toggleBold().run()} active={toolbarActive?.bold ?? false} title="加粗"><Bold className="h-4 w-4" /></ToolButton>
      <ToolButton onClick={() => editor.chain().focus().toggleItalic().run()} active={toolbarActive?.italic ?? false} title="斜体"><Italic className="h-4 w-4" /></ToolButton>
      <ToolButton onClick={() => editor.chain().focus().toggleUnderline().run()} active={toolbarActive?.underline ?? false} title="下划线"><Underline className="h-4 w-4" /></ToolButton>
      <ToolButton onClick={() => editor.chain().focus().toggleStrike().run()} active={toolbarActive?.strike ?? false} title="删除线"><Strikethrough className="h-4 w-4" /></ToolButton>
      <ToolButton onClick={() => editor.chain().focus().toggleHighlight().run()} active={toolbarActive?.highlight ?? false} title="高亮"><Highlighter className="h-4 w-4" /></ToolButton>
      <ToolButton onClick={() => editor.chain().focus().toggleBulletList().run()} active={toolbarActive?.bulletList ?? false} title="列表"><List className="h-4 w-4" /></ToolButton>
      <ToolButton onClick={() => editor.chain().focus().toggleBlockquote().run()} active={toolbarActive?.blockquote ?? false} title="引用"><Quote className="h-4 w-4" /></ToolButton>
      <ToolButton onClick={toggleLink} active={toolbarActive?.link ?? false} title="超链接（选中文字加链接 / 去掉链接）"><Link2 className="h-4 w-4" /></ToolButton>
      <ToolButton onClick={() => editor.chain().focus().setTextAlign("left").run()} active={toolbarActive?.align === "left"} title="左对齐"><AlignLeft className="h-4 w-4" /></ToolButton>
      <ToolButton onClick={() => editor.chain().focus().setTextAlign("center").run()} active={toolbarActive?.align === "center"} title="居中"><AlignCenter className="h-4 w-4" /></ToolButton>
      <ToolButton onClick={() => editor.chain().focus().setTextAlign("right").run()} active={toolbarActive?.align === "right"} title="右对齐"><AlignRight className="h-4 w-4" /></ToolButton>
    </>
  );

  // 块样式（正文/标题/小标题/副标题/等宽样式）——移动端「格式」面板顶部一行
  const blockStyleButtons = ([
    { v: "paragraph", label: "正文" },
    { v: "h1", label: "标题" },
    { v: "h2", label: "小标题" },
    { v: "h3", label: "副标题" },
    { v: "codeBlock", label: "等宽样式" },
  ] as { v: string; label: string }[]).map(({ v, label }) => (
    <button
      key={v}
      type="button"
      onMouseDown={(e) => e.preventDefault()}
      onClick={() => applyBlockType(v)}
      className={`shrink-0 rounded-lg px-2.5 py-1 text-[13px] transition-colors ${blockType === v ? "bg-zinc-900 text-white" : "text-zinc-600 hover:bg-zinc-100"}`}
    >
      {label}
    </button>
  ));

  // 插入三键（表格 / 图片 / 媒体）——桌面行内平铺；移动端放滑动区（就三个，不作独立面板）
  const insertButtons = (
    <>
      <ToolButton onClick={() => { insertNormalTable(); }} active={toolbarActive?.table ?? false} title="表格"><TableIcon className="h-4 w-4" /></ToolButton>
      <ToolButton onClick={() => fileInputRef.current?.click()} title="上传图片"><ImageIcon className="h-4 w-4" /></ToolButton>
      <ToolButton onClick={() => setMediaOpen((v) => !v)} title="插入媒体（视频 / 音频）"><Video className="h-4 w-4" /></ToolButton>
    </>
  );

  const aiButton = (
    <button
      type="button"
      onMouseDown={(e) => e.preventDefault()}
      onClick={() => setAssistantOpen(true)}
      title="AI 语伴"
      aria-label="AI 语伴"
      className="shrink-0 rounded-lg px-2 py-1.5 text-teal-600 transition-colors hover:bg-teal-50 hover:text-teal-700"
    >
      <Sparkles className="h-4 w-4" />
    </button>
  );

  // 光标在表格里时：一条表格操作工具栏（插/删行列、标题行、删表），桌面吸在顶栏下方、移动端吸在底栏上方
  const tableBar = (toolbarActive?.table ?? false) ? (
    <div className="no-scrollbar flex items-center gap-0.5 overflow-x-auto border-t border-teal-100 bg-teal-50/70 px-4 py-1 md:px-8">
      <span className="mr-1 shrink-0 text-xs font-medium text-zinc-500">行</span>
      <ToolButton onClick={() => editor.chain().focus().addRowBefore().run()} title="在上方插入一行">＋上</ToolButton>
      <ToolButton onClick={() => editor.chain().focus().addRowAfter().run()} title="在下方插入一行">＋下</ToolButton>
      <ToolButton onClick={() => editor.chain().focus().deleteRow().run()} title="删除选中的行">－行</ToolButton>
      <span className="mx-1 h-4 w-px shrink-0 bg-zinc-300" />
      <span className="mr-1 shrink-0 text-xs font-medium text-zinc-500">列</span>
      <ToolButton onClick={() => editor.chain().focus().addColumnBefore().run()} title="在左侧插入一列">＋左</ToolButton>
      <ToolButton onClick={() => editor.chain().focus().addColumnAfter().run()} title="在右侧插入一列">＋右</ToolButton>
      <ToolButton onClick={() => editor.chain().focus().deleteColumn().run()} title="删除选中的列">－列</ToolButton>
      <span className="mx-1 h-4 w-px shrink-0 bg-zinc-300" />
      <ToolButton onClick={() => editor.chain().focus().toggleHeaderRow().run()} title="切换标题行">标题行</ToolButton>
      <ToolButton onClick={() => editor.chain().focus().deleteTable().run()} title="删除整个表格">删表</ToolButton>
    </div>
  ) : null;


  return (
    <div className="flex min-w-0 flex-1 flex-col bg-white">
      {/* ===== 桌面端（md+）：全部按钮一行露出，缩窄自动换行（撤销/重做/AI 不固定，照旧随行）；callout 只显图标 ===== */}
      {!readOnly && (
      <div className="sticky top-[calc(env(safe-area-inset-top)+4rem)] z-20 hidden border-b border-zinc-100 bg-white md:block">
        <div className="flex items-center gap-0.5 px-4 py-1.5 md:px-8">
          <div
            className="no-scrollbar flex min-w-0 flex-1 items-center gap-0.5 overflow-x-auto"
            onScroll={() => {
              toolbarScrollAtRef.current = Date.now();
            }}
            onClickCapture={(e) => {
              // 手指滑动（滚动）结束后停在某按钮上会误触发 click：滚动刚结束时吞掉这次 click，防误触。
              if (Date.now() - toolbarScrollAtRef.current < 200) {
                e.preventDefault();
                e.stopPropagation();
              }
            }}
          >
          <select
            value={blockType}
            onChange={(e) => applyBlockType(e.target.value)}
            title="块样式"
            className="shrink-0 rounded-lg border border-zinc-200 bg-white px-2 py-1 text-sm text-zinc-600 focus:border-teal-500 focus:outline-none"
          >
            <option value="paragraph">正文</option>
            <option value="h1">标题</option>
            <option value="h2">小标题</option>
            <option value="h3">副标题</option>
            <option value="codeBlock">等宽样式</option>
          </select>
          {formatButtons}
          <span className="mx-1 h-5 w-px shrink-0 bg-zinc-200" />
          {calloutsInline}
          <span className="mx-1 h-5 w-px shrink-0 bg-zinc-200" />
          {insertButtons}
          </div>
          <span className="mx-1 h-5 w-px shrink-0 bg-zinc-200" />
          <span className="flex shrink-0 items-center gap-0.5">
          <ToolButton onClick={() => editor.chain().focus().undo().run()} disabled={!toolbarActive?.canUndo} title="撤销"><Undo2 className="h-4 w-4" /></ToolButton>
          <ToolButton onClick={() => editor.chain().focus().redo().run()} disabled={!toolbarActive?.canRedo} title="重做"><Redo2 className="h-4 w-4" /></ToolButton>
          {aiButton}
          </span>
        </div>
        {tableBar}
      </div>
      )}

      {/* ===== 移动端（<md）：顶部紧凑一条——左边可横滑，右侧固定 撤销/重做/AI；点 Aa 向下弹「格式」面板 ===== */}
      {!readOnly && (
      <div className="sticky top-[calc(env(safe-area-inset-top)+4rem)] z-20 border-b border-zinc-100 bg-white md:hidden">
        {/* 格式面板：块样式行 + 字母格式格网（吸在工具栏下方） */}
        {openPanel === "format" && (
          <>
            <div className="fixed inset-0 z-20" onClick={() => setOpenPanel(null)} />
            <div className="absolute left-0 right-0 top-full z-30 border-b border-zinc-200 bg-white px-3 pb-3 pt-2 shadow-lg">
              <div className="mb-2 flex flex-wrap gap-1">{blockStyleButtons}</div>
              <div className="grid grid-cols-5 gap-1">{formatButtons}</div>
            </div>
          </>
        )}
        <div className="flex items-center gap-0.5 px-4 py-2">
          {/* 滑动区（无滚动条）：Aa 格式 + callout 图标 + 插入三键 */}
          <div
            className="no-scrollbar flex min-w-0 flex-1 items-center gap-0.5 overflow-x-auto"
            onScroll={() => {
              toolbarScrollAtRef.current = Date.now();
            }}
            onClickCapture={(e) => {
              // 手指滑动（滚动）结束后停在某按钮上会误触发 click：滚动刚结束时吞掉这次 click，防误触。
              if (Date.now() - toolbarScrollAtRef.current < 200) {
                e.preventDefault();
                e.stopPropagation();
              }
            }}
          >
            <button
              type="button"
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => {
                const willOpen = openPanel !== "format";
                if (willOpen) {
                  // 打开格式面板时，先关掉选中词的「✨ 解释」气泡，避免互相遮挡
                  setExplain(null);
                  setResult(null);
                  setExplainError(null);
                  setCollected(false);
                }
                setOpenPanel(willOpen ? "format" : null);
              }}
              title="格式"
              className={`flex shrink-0 items-center gap-0.5 rounded-lg px-2.5 py-1.5 text-[13px] transition-colors ${openPanel === "format" ? "bg-zinc-100 text-zinc-900" : "text-zinc-600 hover:bg-zinc-100 hover:text-zinc-900"}`}
            >
              <Type className="h-4 w-4" />
              <ChevronDown className={`h-3 w-3 text-zinc-400 transition-transform ${openPanel === "format" ? "rotate-180" : ""}`} />
            </button>
            {calloutsInline}
            <span className="mx-1 h-5 w-px shrink-0 bg-zinc-200" />
            {insertButtons}
          </div>
          <span className="mx-1 h-5 w-px shrink-0 bg-zinc-200" />
          {/* 固定区（不滑动）：撤销 / 重做 / AI */}
          <span className="shrink-0">
            <ToolButton onClick={() => editor.chain().focus().undo().run()} disabled={!toolbarActive?.canUndo} title="撤销"><Undo2 className="h-4 w-4" /></ToolButton>
          </span>
          <span className="shrink-0">
            <ToolButton onClick={() => editor.chain().focus().redo().run()} disabled={!toolbarActive?.canRedo} title="重做"><Redo2 className="h-4 w-4" /></ToolButton>
          </span>
          {aiButton}
        </div>
        {tableBar}
      </div>
      )}

      {/* 媒体弹窗：居中弹层（桌 / 移动通用；fixed 定位，不受滚动容器影响） */}
      {mediaOpen && (
        <>
          <div className="fixed inset-0 z-40 bg-black/30" onClick={() => setMediaOpen(false)} />
          <div className="fixed inset-0 z-40 m-auto h-fit w-[360px] max-w-[calc(100vw-2rem)] rounded-xl border border-zinc-200 bg-white p-3 shadow-2xl">
            {rssFeed ? (
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
                  className="w-full rounded-lg border border-zinc-200 px-3 py-2 text-sm text-zinc-800 focus:border-teal-500 focus:outline-none placeholder:text-sm"
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
                    <span className="mr-1 text-xs font-medium text-zinc-400">搭配</span>
                    {result.collocations.replace(/[+／]\s*/g, "\n")}
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
              <div className="space-y-2 border-t border-zinc-100 px-3 py-2">
                <button
                  type="button"
                  onClick={importToNote}
                  disabled={importingToNote || importedToNote}
                  className="w-full rounded-lg border border-teal-200 py-2 text-sm font-semibold text-teal-700 transition-colors hover:bg-teal-50 disabled:opacity-60"
                >
                  {importingToNote ? "导入中…" : importedToNote ? "已导入 ✓" : "导入到笔记"}
                </button>
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
          ) : recordMode ? (
            <div
              style={{
                left: Math.min(Math.max(explain.left, 8), Math.max(8, window.innerWidth - 376)),
                top: Math.max(8, Math.min(explain.bottom + 8, window.innerHeight - 320)),
              }}
              className="fixed z-50 w-[360px] max-w-[calc(100vw-2rem)] rounded-xl border border-zinc-200 bg-white p-3 shadow-2xl"
            >
              <div className="mb-2 flex items-center justify-between">
                <span className="text-xs font-semibold text-zinc-500">记录到闪卡</span>
                <button
                  type="button"
                  onClick={() => setRecordMode(false)}
                  className="rounded-md p-1 text-zinc-400 hover:bg-zinc-100 hover:text-zinc-700"
                  aria-label="关闭"
                >
                  <X className="h-4 w-4" />
                </button>
              </div>
              <div className="mb-2 flex gap-1">
                {(["word", "example", "grammar"] as const).map((k) => (
                  <button
                    key={k}
                    type="button"
                    onClick={() => setRecordKind(k)}
                    className={
                      recordKind === k
                        ? "rounded-md bg-teal-50 px-2.5 py-1 text-xs font-medium text-teal-700"
                        : "rounded-md px-2.5 py-1 text-xs text-zinc-500 hover:bg-zinc-50"
                    }
                  >
                    {k === "word" ? "生词" : k === "example" ? "例句" : "语法"}
                  </button>
                ))}
              </div>
              <div className="space-y-2">
                <div>
                  <label className="mb-1 block text-xs font-medium text-zinc-400">正面</label>
                  <input
                    value={recordFront}
                    onChange={(e) => setRecordFront(e.target.value)}
                    className="w-full rounded-lg border border-zinc-200 px-2.5 py-1.5 text-sm text-zinc-800 focus:border-teal-500 focus:outline-none"
                  />
                </div>
                <div>
                  <label className="mb-1 block text-xs font-medium text-zinc-400">
                    背面（可选，留空则只存正面，可换行写多行释义/搭配）
                  </label>
                  <textarea
                    value={recordBack}
                    onChange={(e) => setRecordBack(e.target.value)}
                    placeholder={"释义\n搭配：…\n例句：…"}
                    rows={3}
                    className="w-full resize-none rounded-lg border border-zinc-200 px-2.5 py-1.5 text-sm text-zinc-800 focus:border-teal-500 focus:outline-none"
                  />
                </div>
                {recordDup ? (
                  <p className="text-xs text-zinc-400">这个词已经在闪卡里了。</p>
                ) : recordError ? (
                  <p className="text-xs text-red-600">{recordError}</p>
                ) : null}
                <div className="flex justify-end pt-1">
                  <button
                    type="button"
                    onClick={recordInto}
                    disabled={recording || !recordFront.trim()}
                    className="rounded-lg bg-teal-600 px-3 py-1.5 text-sm font-semibold text-white hover:bg-teal-700 disabled:opacity-50"
                  >
                    {recording ? "存入中…" : recorded ? (recordDup ? "已存在 ✓" : "已存入 ✓") : "存入闪卡"}
                  </button>
                </div>
              </div>
            </div>
          ) : (
            <div
              onMouseDown={(e) => e.preventDefault()}
              style={
                COARSE_POINTER
                  ? {
                      // 触屏：原生选中菜单在选区上方，气泡放选区下方，两者不叠。
                      left: Math.min(Math.max(explain.left, 8), Math.max(8, window.innerWidth - 230)),
                      top: Math.min(explain.bottom + 8, window.innerHeight - 44),
                    }
                  : {
                      left: Math.min(Math.max(explain.left, 8), Math.max(8, window.innerWidth - 230)),
                      top: explain.top - 8,
                      transform: "translateY(-100%)",
                    }
              }
              className="fixed z-50 flex items-center rounded-full bg-zinc-900 p-1 shadow-lg"
            >
              <button
                type="button"
                disabled={explainBusy}
                onClick={() => {
                  setRecordMode(true);
                  setRecordFront(explain.text);
                  setRecordBack("");
                  setRecordError(null);
                  setRecorded(false);
                  setRecordDup(false);
                }}
                className="rounded-full px-2.5 py-1.5 text-xs font-medium text-white transition-colors hover:bg-zinc-700 disabled:opacity-60"
              >
                记录
              </button>
              <button
                type="button"
                disabled={explainBusy}
                onClick={runExplain}
                className="inline-flex items-center gap-1 rounded-full px-2.5 py-1.5 text-xs font-medium text-white transition-colors hover:bg-zinc-700 disabled:opacity-60"
              >
                <Sparkles className="h-3 w-3" />
                {explainBusy ? "解释中…" : "解释"}
              </button>
              <button
                type="button"
                disabled={explainBusy}
                onClick={() => {
                  void navigator.clipboard?.writeText(explain.text);
                  setCopied(true);
                  setTimeout(() => setCopied(false), 1200);
                }}
                className="rounded-full px-2.5 py-1.5 text-xs font-medium text-white transition-colors hover:bg-zinc-700 disabled:opacity-60"
              >
                {copied ? "已复制 ✓" : "复制"}
              </button>
            </div>
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

      <EditorContent editor={editor} className="flex-1 pb-24 md:pb-0" />

      {assistantOpen && (
        <AiAssistantPanel
          editor={editor}
          noteId={noteId}
          onClose={() => setAssistantOpen(false)}
        />
      )}

      {/* 点下划线词弹出的「该词闪卡」详情：正面 + 背面，点遮罩或 ✕ 关闭 */}
      {cardDetail &&
        createPortal(
          <div
            className="fixed inset-0 z-[60] flex items-center justify-center bg-black/30 p-4"
            onClick={() => setCardDetail(null)}
          >
            <div
              className="w-[360px] max-w-[calc(100vw-2rem)] overflow-hidden rounded-xl border border-zinc-200 bg-white shadow-2xl"
              onClick={(e) => e.stopPropagation()}
            >
              <div className="flex items-center justify-between border-b border-zinc-100 px-3 py-2">
                <span className="text-xs font-medium text-zinc-400">闪卡</span>
                <button
                  type="button"
                  onClick={() => setCardDetail(null)}
                  className="rounded-md p-1 text-zinc-400 hover:bg-zinc-100 hover:text-zinc-700"
                  aria-label="关闭"
                >
                  <X className="h-4 w-4" />
                </button>
              </div>
              <div className="space-y-3 px-3 py-4">
                <CardFront text={cardDetail.front} reading={cardDetail.reading} />
                <CardBack back={cardDetail.back ?? ""} front={cardDetail.front} reading={cardDetail.reading} />
              </div>
            </div>
          </div>,
          document.body
        )}

      {/* 隐藏文件输入：图片 / OCR 识图（点工具栏/弹窗按钮后程序触发 click） */}
      <input ref={fileInputRef} type="file" accept="image/*" onChange={pickImage} className="hidden" />
      <input ref={ocrFileRef} type="file" accept="image/*" onChange={ocrImage} className="hidden" />
    </div>
  );
}
