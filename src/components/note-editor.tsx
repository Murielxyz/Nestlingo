"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import dynamic from "next/dynamic";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ExternalLink, BookOpen, Pencil, Columns2, Rows2, Highlighter } from "lucide-react";
import { generateHTML } from "@tiptap/core";
import { editorExtensions } from "@/lib/editor-extensions";
import { createClient, detachMaterialsFromNote } from "@/lib/supabase/client";
import { ConvertToCards } from "./convert-to-cards";
import { ShareModal } from "./share-modal";
import { CardSidebar } from "./card-sidebar";
import { BackButton } from "./back-button";
import { FolderPickerSheet } from "./folder-picker-sheet";
import type { Folder as FolderType, Note, SourceMaterial } from "@/lib/types";
import type { JSONContent } from "@tiptap/core";
import type { HighlightApi } from "./rich-text-editor";

// 富文本编辑器只在客户端渲染，避免 SSR 水合问题。
const RichTextEditor = dynamic(
  () => import("./rich-text-editor").then((m) => m.RichTextEditor),
  {
    ssr: false,
    loading: () => <div className="flex-1 bg-white" />,
  }
);

/**
 * 笔记编辑页 —— 备忘录式全屏布局：
 * 顶部一条「返回 + 菜单(⋯) + 完成」，下面是大标题 + 富文本正文铺满整页。
 * 正文最新内容经 onChange 存进 contentRef，保存时读取，避免每次按键触发父组件重渲染。
 */
export function NoteEditor({
  note,
  folders,
  backHref,
  cardCount,
  sourceMaterials,
}: {
  note: Note;
  folders: FolderType[];
  backHref: string;
  cardCount: number;
  sourceMaterials: SourceMaterial[];
}) {
  const router = useRouter();
  const [title, setTitle] = useState(note.title);
  const [folderId, setFolderId] = useState(note.folder_id ?? "");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [convertOpen, setConvertOpen] = useState(false);
  const [shareOpen, setShareOpen] = useState(false);
  const [folderPickerOpen, setFolderPickerOpen] = useState(false);
  const [showCards, setShowCards] = useState(false);
  // 分屏（参考 Obsidian）：左/上 = 本笔记的只读对照屏，右/下 = 正常编辑器，两屏各自独立滚动
  // （左屏停在原文，右屏可以下滑到笔记区做笔记）。用静态渲染而非第二个编辑器实例——不增开销，
  // 也不会有两个编辑器往同一条记录写的并发保存冲突。手机端不放（宽度不够）。
  const [split, setSplit] = useState<null | "row" | "col">(null);
  const [previewHtml, setPreviewHtml] = useState("");
  // 只读屏里拖选一段文字后浮出的「高亮」气泡：只读屏是静态 HTML，只报出「哪一块 + 选中什么 + 大致偏移」，
  // 真正写入交给编辑器实例（唯一写者）——高亮是正文的一部分，随自动保存落库、导出 PDF / 分享图里都在。
  const [mirrorBubble, setMirrorBubble] = useState<{
    blockPos: number;
    text: string;
    approxOffset: number;
    has: boolean;
    left: number;
    top: number;
    /** 选区太靠上时气泡改放下方（上方会被滚动容器裁掉） */
    below: boolean;
  } | null>(null);
  // 阅读 / 编辑模式：阅读态内容只读（点下划线词弹卡查义、滚动正常、无软键盘），编辑态正常编辑。
  const [readOnly, setReadOnly] = useState(false);
  // 标题里按回车 → 焦点移到正文编辑器（而不是在标题里换行）。
  const [focusBodySignal, setFocusBodySignal] = useState(0);

  // 实时保存用：保存时读 ref 的最新值，避免 debounce 闭包拿到旧 title/folderId。
  const titleRef = useRef(note.title);
  const folderIdRef = useRef(note.folder_id ?? "");
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const dirtyRef = useRef(false);
  // 标题改成可自动增高的 textarea（长标题换行，不再被单行 input 裁掉后半截）。
  const titleInputRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    folderIdRef.current = folderId;
  }, [folderId]);

  // 标题随内容自动增高：先复位再取 scrollHeight，长标题能完整铺开、可换行。
  useEffect(() => {
    const el = titleInputRef.current;
    if (!el) return;
    const grow = () => {
      el.style.height = "auto";
      el.style.height = `${el.scrollHeight}px`;
    };
    grow();
    // 中文/泰语等异体字在字体载入完成后行高会变，重测一次避免量矮被剪；
    // 转屏 / 侧栏开合也会改换行数，一并重测。卸载时清理监听。
    let cancelled = false;
    const remeasure = () => {
      if (!cancelled) grow();
    };
    window.addEventListener("resize", remeasure);
    try {
      document.fonts?.ready?.then(() => {
        if (!cancelled) grow();
      });
    } catch {}
    return () => {
      cancelled = true;
      window.removeEventListener("resize", remeasure);
    };
  }, [title]);

  const contentRef = useRef<{ json: JSONContent | null; text: string }>({
    json: (note.content ?? null) as JSONContent | null,
    text: note.content_text ?? "",
  });

  // 分屏左屏是静态渲染的只读副本：用与编辑器 / 分享图同一套扩展转 HTML，样式与正文一致。
  const splitTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const splitRef = useRef<null | "row" | "col">(null);
  // 只读屏容器（盖 data-pos + 监听选区）与外层定位框（气泡按它算坐标）
  const mirrorRef = useRef<HTMLDivElement>(null);
  const mirrorWrapRef = useRef<HTMLDivElement>(null);
  const highlightApiRef = useRef<HighlightApi | null>(null);

  const refreshPreview = useCallback((json: JSONContent | null) => {
    try {
      setPreviewHtml(json ? generateHTML(json, editorExtensions) : "");
    } catch {
      setPreviewHtml("");
    }
  }, []);

  // 开关分屏时立刻出一版；之后打字按 0.8s 防抖刷新，不逐键重渲染整篇。
  useEffect(() => {
    splitRef.current = split;
    if (split) refreshPreview(contentRef.current.json);
  }, [split, refreshPreview]);

  // 只读屏每个顶层块盖上它在文档里的位置（渲染顺序与顶层节点一一对应），「高亮」定位要用。
  // 用编辑器给的实时位置（不是渲染时那版 JSON），保证和定位时查的文档是同一份。
  useEffect(() => {
    const el = mirrorRef.current;
    if (!el) return;
    const offsets = highlightApiRef.current?.blockOffsets() ?? [];
    Array.from(el.children).forEach((child, i) => {
      const pos = offsets[i];
      if (pos == null) (child as HTMLElement).removeAttribute("data-pos");
      else (child as HTMLElement).setAttribute("data-pos", String(pos));
    });
  }, [previewHtml, split]);

  // 分屏是全屏专注视图，Esc 直接退出（只靠 ⋯ 菜单退出太隐蔽）。
  useEffect(() => {
    if (!split) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setSplit(null);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [split]);

  const handleChange = useCallback((json: JSONContent | null, text: string) => {
    contentRef.current = { json, text };
    scheduleAutoSave();
    if (splitRef.current) {
      if (splitTimerRef.current) clearTimeout(splitTimerRef.current);
      splitTimerRef.current = setTimeout(() => refreshPreview(json), 800);
    }
  }, [refreshPreview]);

  /** 静默写入数据库（自动保存用，不闪「保存中/已保存」提示）。 */
  function persist() {
    const { json, text } = contentRef.current;
    const supabase = createClient();
    return supabase
      .from("notes")
      .update({
        title: titleRef.current.trim() || "无标题",
        folder_id: folderIdRef.current || null,
        content: json,
        content_text: text,
      })
      .eq("id", note.id);
  }

  /** 备忘录式实时保存：内容/标题变化后停顿约 1 秒就自动保存。 */
  function scheduleAutoSave() {
    dirtyRef.current = true;
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    saveTimerRef.current = setTimeout(async () => {
      const { error } = await persist();
      if (error) {
        setError(error.message);
      } else {
        dirtyRef.current = false;
        router.refresh();
      }
    }, 1000);
  }

  /** 翻译笔记标题：把标题文字译成简体中文（译文与原标题不同才替换，避免白改）。 */
  async function translateTitle() {
    const t = titleRef.current.trim();
    if (!t) return;
    try {
      const res = await fetch("/api/ai/translate", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ paragraphs: [t] }),
        signal: AbortSignal.timeout(120_000),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error ?? "翻译标题失败");
      const tr =
        Array.isArray(data?.translations) && typeof data.translations[0] === "string"
          ? data.translations[0].trim()
          : "";
      if (!tr || tr === t) return;
      setTitle(tr);
      titleRef.current = tr;
      scheduleAutoSave();
    } catch (e) {
      alert(e instanceof Error ? e.message : String(e));
    }
  }

  // 离开页面前若还有未保存的改动，尽力落一次库（不阻塞导航）。
  useEffect(() => {
    return () => {
      if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
      if (splitTimerRef.current) clearTimeout(splitTimerRef.current);
      if (!dirtyRef.current) return;
      const { json, text } = contentRef.current;
      void createClient()
        .from("notes")
        .update({
          title: titleRef.current.trim() || "无标题",
          folder_id: folderIdRef.current || null,
          content: json,
          content_text: text,
        })
        .eq("id", note.id);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /**
   * 悬浮「闪卡」按钮：先保存当前内容（避免丢改动、也让转卡拿到最新文本），
   * 再看这篇笔记有没有闪卡——没有就打开「转成闪卡」，有就展示（电脑端分栏、手机端跳卡片页）。
   */
  async function handleFlashcards() {
    if (saving) return;
    await save();

    if (cardCount === 0) {
      setConvertOpen(true);
    } else if (window.matchMedia("(min-width: 768px)").matches) {
      setSplit(null); // 闪卡侧栏与分屏互斥，避免挤成三栏
      setShowCards((v) => !v);
    } else {
      router.push(`/notes/${note.id}/cards`);
    }
  }

  /**
   * 导出 PDF：走浏览器原生打印（用户在打印框里选「存储为 PDF」）。
   * 不引 jsPDF/html2canvas——中/泰文渲染差、体积还大；打印方式文字可选中、矢量清晰、零依赖。
   * 打印前先把分屏收掉、并把没落库的改动存一次，保证导出的是完整的一整篇。
   */
  function exportPdf() {
    setMenuOpen(false);
    setSplit(null);
    setShowCards(false);

    // 浏览器自带的页眉标题、以及「存储为 PDF」的默认文件名，取的都是 document.title。
    // 打印期间换成笔记标题：文件直接叫笔记名，页眉也不再是站点名。打印完还原。
    const prevTitle = document.title;
    const restoreTitle = () => {
      document.title = prevTitle;
      window.removeEventListener("afterprint", restoreTitle);
    };
    window.addEventListener("afterprint", restoreTitle);

    void save().finally(() => {
      // 等一帧布局重排（分屏/侧栏收起）再唤起打印框。
      setTimeout(() => {
        document.title = titleRef.current.trim() || note.title || "笔记";
        window.print();
      }, 300);
    });
  }

  /** 切换分屏方向；再点同方向即退出。开分屏时顺手关掉闪卡侧栏（两者互斥）。 */
  function toggleSplit(mode: "row" | "col") {
    setMenuOpen(false);
    setShowCards(false);
    setSplit((s) => (s === mode ? null : mode));
  }

  /**
   * 只读屏里选完文字：把「哪一块 + 选中什么 + 大致偏移」算出来，问编辑器这段现在是不是已高亮，
   * 然后在该位置浮一个「高亮 / 取消高亮」气泡。跨块选择不支持（高亮得落在一个顶层节点里才稳）。
   */
  function handleMirrorSelect() {
    const container = mirrorRef.current;
    const wrap = mirrorWrapRef.current;
    const sel = window.getSelection();
    if (!container || !wrap || !sel || sel.isCollapsed || sel.rangeCount === 0) {
      setMirrorBubble(null);
      return;
    }
    const range = sel.getRangeAt(0);
    if (!container.contains(range.commonAncestorContainer)) {
      setMirrorBubble(null);
      return;
    }
    const blockElAt = (n: Node) =>
      (n.nodeType === 3 ? n.parentElement : (n as HTMLElement))?.closest("[data-pos]") ?? null;
    const blockEl = blockElAt(range.startContainer);
    if (!blockEl || blockEl !== blockElAt(range.endContainer)) {
      setMirrorBubble(null);
      return;
    }
    const blockPos = Number(blockEl.getAttribute("data-pos"));
    const text = sel.toString();
    if (!Number.isFinite(blockPos) || !text.trim()) {
      setMirrorBubble(null);
      return;
    }
    // 块内大致字符偏移：同一段文字在块里出现多次时，用它挑最近的那次
    const pre = range.cloneRange();
    pre.selectNodeContents(blockEl);
    pre.setEnd(range.startContainer, range.startOffset);
    const approxOffset = pre.toString().length;

    const st = highlightApiRef.current?.state(blockPos, text, approxOffset) ?? null;
    if (st === null) {
      setMirrorBubble(null);
      return;
    }
    const r = range.getBoundingClientRect();
    const w = wrap.getBoundingClientRect();
    // 选区离滚动容器顶部太近时，气泡放上方会被裁掉（overflow 会裁），改放选区下方。
    const below = r.top - w.top < 40;
    setMirrorBubble({
      blockPos,
      text,
      approxOffset,
      has: st === "on",
      left: r.left - w.left + r.width / 2,
      top: below ? r.bottom - w.top + 8 : r.top - w.top - 8,
      below,
    });
  }

  /** 点气泡：由编辑器给这段加 / 取消高亮，并立刻重渲染只读屏（不等 0.8s 防抖）。 */
  function applyMirrorHighlight() {
    const b = mirrorBubble;
    setMirrorBubble(null);
    if (!b) return;
    const json = highlightApiRef.current?.toggle(b.blockPos, b.text, b.approxOffset) ?? null;
    if (json) refreshPreview(json);
    window.getSelection()?.removeAllRanges();
  }

  /** 保存。folderOverride 用于「收录到文件夹」时直接指定新文件夹。 */
  async function save(folderOverride?: string | null): Promise<boolean> {
    setSaving(true);
    setError(null);
    setSaved(false);

    const targetFolder = folderOverride !== undefined ? folderOverride : folderIdRef.current;
    const { json, text } = contentRef.current;
    const supabase = createClient();
    const { error } = await supabase
      .from("notes")
      .update({
        title: titleRef.current.trim() || "无标题",
        folder_id: targetFolder || null,
        content: json,
        content_text: text,
      })
      .eq("id", note.id);

    setSaving(false);
    if (error) {
      setError(error.message);
      return false;
    }
    dirtyRef.current = false;
    setSaved(true);
    router.refresh();
    return true;
  }

  /** 「完成」：先把没触发的自动保存立即落一次，然后留在本页（不跳离笔记）。 */
  async function finishEdit() {
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    await save();
  }

  /** 把笔记收录到某个文件夹（null = 无文件夹）。 */
  async function moveToFolder(id: string | null) {
    setFolderId(id ?? "");
    setMenuOpen(false);
    setFolderPickerOpen(false);
    await save(id);
  }

  /** 从底部弹层「新建文件夹」：建完直接把笔记收进去。 */
  async function createFolderAndMove(name: string) {
    if (!name.trim()) return;
    const supabase = createClient();
    const { data, error } = await supabase
      .from("folders")
      .insert({ name: name.trim() })
      .select("id")
      .single();
    if (error || !data) {
      setError(error?.message ?? "创建文件夹失败。");
      return;
    }
    await moveToFolder(data.id);
  }

  /** 删除整篇笔记（里面的闪卡也会一起删除）。 */
  async function deleteNote() {
    if (
      !window.confirm(
        `删除笔记「${title.trim() || note.title}」？里面的闪卡也会一起删除。`
      )
    ) {
      return;
    }
    // 把挂起的自动保存清掉：删除后不该再对这条已删笔记做保存/刷新，
    // 否则 autosave 的 router.refresh() 会在 /notes/{id} 上重拉已删笔记 → getNote null → notFound → 404。
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    dirtyRef.current = false;
    setError(null);
    const supabase = createClient();
    const { error: detachError } = await detachMaterialsFromNote(note.id);
    if (detachError) {
      setError(detachError.message);
      return;
    }
    const { error } = await supabase.from("notes").delete().eq("id", note.id);
    if (error) {
      setError(error.message);
      return;
    }
    router.replace("/notes");
  }

  const editorPane = (
    <>
      <div className="bg-white px-4 pt-2 md:px-8">
        {sourceMaterials.length > 0 && (
          <div className="mb-3 flex flex-wrap items-center gap-2">
            {sourceMaterials.map((sm) => (
              <Link
                key={sm.id}
                href={`/materials/${sm.id}`}
                className="inline-flex items-center gap-1 rounded-full bg-teal-50 px-2.5 py-1 text-xs font-medium text-teal-700 transition-colors hover:bg-teal-100"
                title={sm.title || "素材库"}
              >
                来自素材：{sm.title || "素材库"}
                <ExternalLink className="h-3 w-3" />
              </Link>
            ))}
          </div>
        )}
        <textarea
          ref={titleInputRef}
          value={title}
          onChange={(e) => {
            setTitle(e.target.value);
            titleRef.current = e.target.value;
            scheduleAutoSave();
          }}
          placeholder="标题"
          rows={1}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              setFocusBodySignal((s) => s + 1);
            }
          }}
          onInput={(e) => {
            const el = e.currentTarget;
            el.style.height = "auto";
            el.style.height = `${el.scrollHeight}px`;
          }}
          // 打印时解开 40vh 高度上限，长标题不会被截断成一小条
          className="note-title-input max-h-[40vh] min-h-[1.5em] w-full resize-none overflow-y-auto border-none bg-transparent text-3xl font-bold leading-tight text-zinc-900 placeholder-zinc-300 focus:outline-none print:max-h-none print:overflow-visible"
        />
      </div>
      <RichTextEditor
        initialContent={note.content}
        onChange={handleChange}
        noteId={note.id}
        readOnly={readOnly}
        focusBodySignal={focusBodySignal}
        onTranslateTitle={translateTitle}
        // 分屏时编辑区是局部滚动容器，工具栏吸在它自己的顶部（0）而不是让开页头，避免上面漏一条缝
        toolbarStickyTop={split ? "0px" : undefined}
        // 只读屏的「高亮」走这里回到编辑器写（唯一写者，不会两屏并发覆盖）
        highlightApiRef={highlightApiRef}
        onFocusTitle={() => {
          const el = titleInputRef.current;
          if (!el) return;
          el.focus();
          try {
            const len = el.value.length;
            el.setSelectionRange(len, len);
          } catch {
            /* 忽略 setSelectionRange 在非文本输入上的报错 */
          }
        }}
      />

      {/* 打印落款：浏览器自带页脚是网页地址（网页改不了），关掉打印框里的「页眉和页脚」后，
          用这一行在文末标出这是哪篇笔记。屏幕上不显示。 */}
      <div className="hidden border-t border-zinc-200 pt-2 text-right text-[9pt] text-zinc-400 print:mx-8 print:mb-4 print:mt-8 print:block">
        {title.trim() || note.title}
      </div>
    </>
  );

  // 分屏 / 闪卡侧栏都要求「整屏固定高度 + 各栏自己滚」，所以共用 immersive 这一档布局。
  // 打印时要把这档约束解开（h-screen / overflow-hidden 会把内容裁掉）。
  const immersive = Boolean(split) || showCards;

  return (
    <div
      className={
        split
          ? // 分屏 = 全屏专注：铺满整个窗口，把导航栏 / 文件夹栏 / 笔记列表栏都盖住，
            // 屏幕上只剩左右（或上下）两屏，不再叠成四五栏。
            "fixed inset-0 z-50 flex flex-col bg-white print:static print:h-auto print:overflow-visible"
          : immersive
            ? "flex h-screen flex-col overflow-hidden print:h-auto print:overflow-visible"
            : "flex min-h-[100dvh] flex-col overflow-x-clip"
      }
    >
      {/* ===== 顶部：返回 + 菜单 + 完成（同一行，控件统一 h-9 到舒适可点区） ===== */}
      <header className="sticky top-0 z-30 flex items-center gap-2 border-b border-zinc-200 bg-white px-3 pb-3 pt-[calc(env(safe-area-inset-top)+1rem)] md:px-4 print:hidden">
        {/* 返回：手机端必备（底部导航在笔记页被隐藏，返回是唯一出口）；
            电脑端左侧常驻「全部笔记栏 + 导航栏」，返回冗余，隐掉更干净。 */}
        <BackButton
          fallback={backHref}
          forceFallback
          className="icon-btn text-xl md:hidden"
        />

        {/* 保存状态（居中，安静地显示） */}
        <span className="flex-1 truncate text-center text-xs text-zinc-400">
          {saving ? "保存中…" : saved ? "已保存 ✓" : error ? error : ""}
        </span>

        {/* 分享生成图片（独立按钮，放在菜单旁） */}
        <button
          onClick={() => setShareOpen(true)}
          className="icon-btn text-zinc-600"
          aria-label="分享生成图片"
          title="分享生成图片"
        >
          <svg
            width="17"
            height="17"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <path d="M4 12v7a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-7" />
            <polyline points="16 6 12 2 8 6" />
            <line x1="12" y1="2" x2="12" y2="15" />
          </svg>
        </button>

        {/* 阅读 / 编辑切换 */}
        <button
          onClick={() => setReadOnly((v) => !v)}
          className={`icon-btn ${readOnly ? "text-teal-600" : "text-zinc-600"}`}
          aria-label={readOnly ? "切换到编辑" : "切换到阅读"}
          title={readOnly ? "切换到编辑" : "切换到阅读"}
        >
          {readOnly ? <Pencil className="h-[18px] w-[18px]" /> : <BookOpen className="h-[18px] w-[18px]" />}
        </button>

        {/* 分屏是全屏专注视图，给一个显眼出口（等同 ⋯ 菜单里的「退出分屏」）。 */}
        {split && (
          <button
            onClick={() => setSplit(null)}
            className="icon-btn text-teal-600"
            aria-label="退出分屏"
            title="退出分屏"
          >
            {split === "row" ? (
              <Columns2 className="h-[18px] w-[18px]" />
            ) : (
              <Rows2 className="h-[18px] w-[18px]" />
            )}
          </button>
        )}

        {/* 菜单按钮 */}
        <div className="relative">
          <button
            onClick={() => setMenuOpen((v) => !v)}
            className="icon-btn text-zinc-600"
            aria-label="更多操作"
          >
            ⋯
          </button>

          {menuOpen && (
            <>
              {/* 点击空白处关闭 */}
              <div
                className="fixed inset-0 z-30"
                onClick={() => setMenuOpen(false)}
              />
              <div className="absolute right-0 z-40 mt-2 w-60 rounded-xl border border-zinc-200 bg-white p-1.5 shadow-lg">
                {/* 收录到文件夹：不再把文件夹单塞进 ⋯ 菜单（多了会拉得很长），点开走底部弹层。 */}
                <button
                  onClick={() => {
                    setMenuOpen(false);
                    setFolderPickerOpen(true);
                  }}
                  className="flex w-full items-center justify-between gap-2 rounded-lg px-2.5 py-2 text-left text-sm text-zinc-700 transition-colors hover:bg-zinc-100"
                >
                  <span className="min-w-0 truncate">
                    收录到文件夹
                    <span className="ml-1 text-xs text-zinc-400">
                      {folderId
                        ? (folders.find((f) => f.id === folderId)?.name ?? "无文件夹")
                        : "无文件夹"}
                    </span>
                  </span>
                  <span className="shrink-0 text-xs text-zinc-400">→</span>
                </button>

                <div className="my-1 h-px bg-zinc-100" />

                <button
                  onClick={() => {
                    setMenuOpen(false);
                    setConvertOpen(true);
                  }}
                  className="flex w-full items-center rounded-lg px-2.5 py-2 text-left text-sm text-zinc-700 transition-colors hover:bg-zinc-100"
                >
                  转成闪卡
                </button>

                <button
                  onClick={() => {
                    setMenuOpen(false);
                    handleFlashcards();
                  }}
                  className="flex w-full items-center rounded-lg px-2.5 py-2 text-left text-sm text-zinc-700 transition-colors hover:bg-zinc-100"
                >
                  查看闪卡
                </button>

                <div className="my-1 h-px bg-zinc-100" />

                {/* 分屏（参考 Obsidian）：左/上只读对照原文，右/下照常编辑。仅电脑端。 */}
                <button
                  onClick={() => toggleSplit("row")}
                  className="hidden w-full items-center gap-2 rounded-lg px-2.5 py-2 text-left text-sm text-zinc-700 transition-colors hover:bg-zinc-100 md:flex"
                >
                  <Columns2 className="h-4 w-4 shrink-0 text-zinc-400" />
                  {split === "row" ? "退出左右分屏" : "左右分屏"}
                </button>

                <button
                  onClick={() => toggleSplit("col")}
                  className="hidden w-full items-center gap-2 rounded-lg px-2.5 py-2 text-left text-sm text-zinc-700 transition-colors hover:bg-zinc-100 md:flex"
                >
                  <Rows2 className="h-4 w-4 shrink-0 text-zinc-400" />
                  {split === "col" ? "退出上下分屏" : "上下分屏"}
                </button>

                <button
                  onClick={exportPdf}
                  className="flex w-full items-center rounded-lg px-2.5 py-2 text-left text-sm text-zinc-700 transition-colors hover:bg-zinc-100"
                >
                  导出 PDF
                </button>

                <div className="my-1 h-px bg-zinc-100" />

                <button
                  onClick={() => {
                    setMenuOpen(false);
                    deleteNote();
                  }}
                  className="flex w-full items-center rounded-lg px-2.5 py-2 text-left text-sm text-red-600 transition-colors hover:bg-red-50"
                >
                  删除
                </button>
              </div>
            </>
          )}
        </div>

        {/* 保存：清掉挂起的自动保存，立即落一次库（自动保存之外给一个「确保已存」入口） */}
        <button
          onClick={finishEdit}
          disabled={saving}
          className="inline-flex h-9 shrink-0 items-center justify-center rounded-lg bg-teal-600 px-4 text-sm font-semibold text-white transition-colors hover:bg-teal-700 disabled:opacity-60"
        >
          保存
        </button>
      </header>

      {/* ===== 大标题 + 正文 ===== */}
      {/* 外层铺白：内容列居中收缩（max-w-5xl）时，两侧留给白色而不是 body 的页面渐变底，
          避免宽屏下露出绿色、显得不干净（与加载态的 bg-white 一致）。 */}
      <div
        className={
          immersive
            ? `flex min-h-0 flex-1 overflow-hidden bg-white print:overflow-visible ${
                split === "col" ? "flex-col" : ""
              }`
            : "flex flex-1 bg-white"
        }
      >
        {/* 分屏对照屏（左 / 上）：静态只读渲染的同一篇笔记，自己独立滚动——
            左屏停在原文不动，右屏可以下滑到笔记区做笔记。打印时不打这屏（打可编辑那屏）。 */}
        {split && (
          <div
            className={
              split === "row"
                ? "min-w-0 flex-1 overflow-y-auto border-r border-zinc-200 print:hidden"
                : "min-h-0 flex-1 overflow-y-auto border-b border-zinc-200 print:hidden"
            }
            onScroll={() => setMirrorBubble(null)}
          >
            <div
              ref={mirrorWrapRef}
              className="relative mx-auto flex w-full max-w-3xl flex-col md:max-w-4xl xl:max-w-5xl"
            >
              <div className="px-4 pt-2 md:px-8">
                <h1 className="note-title-input mb-1 text-3xl font-bold leading-tight text-zinc-900">
                  {title || "无标题"}
                </h1>
              </div>
              <div
                ref={mirrorRef}
                className="tiptap px-4 py-4 md:px-8"
                onMouseUp={handleMirrorSelect}
                onKeyUp={handleMirrorSelect}
                dangerouslySetInnerHTML={{ __html: previewHtml }}
              />
              {/* 选中文字后浮出的「高亮」气泡：加了就进正文（编辑器唯一写者），永久保留、导出也有 */}
              {mirrorBubble && (
                <button
                  type="button"
                  onClick={applyMirrorHighlight}
                  style={{ left: mirrorBubble.left, top: mirrorBubble.top }}
                  className={`absolute z-20 inline-flex -translate-x-1/2 items-center gap-1 rounded-full bg-zinc-900 px-2.5 py-1 text-xs font-medium text-white shadow-lg transition-colors hover:bg-zinc-700 ${
                    mirrorBubble.below ? "" : "-translate-y-full"
                  }`}
                >
                  <Highlighter className="h-3.5 w-3.5" />
                  {mirrorBubble.has ? "取消高亮" : "高亮"}
                </button>
              )}
            </div>
          </div>
        )}

        {/* 编辑器始终挂在同一个容器里，不因分栏开关而重挂（否则会丢未保存内容） */}
        <div
          className={
            immersive
              ? "min-w-0 flex-1 overflow-y-auto print:overflow-visible"
              : "flex min-w-0 flex-1 justify-center overflow-x-clip print:overflow-visible"
          }
        >
          <div className="mx-auto flex w-full max-w-3xl flex-col md:max-w-4xl xl:max-w-5xl print:max-w-none">
            {editorPane}
          </div>
        </div>

        {/* 右：闪卡侧栏（仅分栏时；与分屏互斥） */}
        {showCards && !split && (
          <CardSidebar noteId={note.id} onClose={() => setShowCards(false)} />
        )}
      </div>

      {/* 右下角悬浮按钮：没有闪卡→转成闪卡；有闪卡→电脑端分栏 / 手机端跳卡片页 */}
      {!showCards && (
        <button
          onClick={handleFlashcards}
          className="fixed bottom-[calc(1rem+env(safe-area-inset-bottom))] right-4 z-30 flex items-center gap-1.5 rounded-full bg-teal-600 px-4 py-3 text-sm font-semibold text-white shadow-lg transition-colors hover:bg-teal-700 md:bottom-8 md:right-8 print:hidden"
        >
          {cardCount > 0 ? "闪卡" : "转成闪卡"}
        </button>
      )}

      {convertOpen && (
        <ConvertToCards
          noteId={note.id}
          text={contentRef.current.text}
          onClose={() => setConvertOpen(false)}
        />
      )}

      {shareOpen && (
        <ShareModal
          title={title}
          content={contentRef.current.json}
          onClose={() => setShareOpen(false)}
        />
      )}

      {/* 收录到文件夹：底部弹出文件夹单（多了也能滚，参考苹果备忘录） */}
      <FolderPickerSheet
        open={folderPickerOpen}
        onClose={() => setFolderPickerOpen(false)}
        folders={folders}
        title="收录到文件夹"
        currentFolderId={folderId || null}
        onPick={moveToFolder}
        onCreateFolder={createFolderAndMove}
      />
    </div>
  );
}
