"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import dynamic from "next/dynamic";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ExternalLink, BookOpen, Pencil } from "lucide-react";
import { createClient, detachMaterialsFromNote } from "@/lib/supabase/client";
import { ConvertToCards } from "./convert-to-cards";
import { ShareModal } from "./share-modal";
import { CardSidebar } from "./card-sidebar";
import { BackButton } from "./back-button";
import { FolderPickerSheet } from "./folder-picker-sheet";
import type { Folder as FolderType, Note, SourceMaterial } from "@/lib/types";
import type { JSONContent } from "@tiptap/core";

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

  const handleChange = useCallback((json: JSONContent | null, text: string) => {
    contentRef.current = { json, text };
    scheduleAutoSave();
  }, []);

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
      setShowCards((v) => !v);
    } else {
      router.push(`/notes/${note.id}/cards`);
    }
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
          className="note-title-input max-h-[40vh] min-h-[1.5em] w-full resize-none overflow-y-auto border-none bg-transparent text-3xl font-bold leading-tight text-zinc-900 placeholder-zinc-300 focus:outline-none"
        />
      </div>
      <RichTextEditor
        initialContent={note.content}
        onChange={handleChange}
        noteId={note.id}
        readOnly={readOnly}
        focusBodySignal={focusBodySignal}
        onTranslateTitle={translateTitle}
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
    </>
  );

  return (
    <div
      className={
        showCards
          ? "flex h-screen flex-col overflow-hidden"
          : "flex min-h-[100dvh] flex-col overflow-x-clip"
      }
    >
      {/* ===== 顶部：返回 + 菜单 + 完成（同一行，控件统一 h-9 到舒适可点区） ===== */}
      <header className="sticky top-0 z-30 flex items-center gap-2 border-b border-zinc-200 bg-white px-3 pb-3 pt-[calc(env(safe-area-inset-top)+1rem)] md:px-4">
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
          showCards ? "flex min-h-0 flex-1 overflow-hidden bg-white" : "flex flex-1 bg-white"
        }
      >
        {/* 编辑器始终挂在同一个容器里，不因分栏开关而重挂（否则会丢未保存内容） */}
        <div
          className={
            showCards ? "min-w-0 flex-1 overflow-y-auto" : "flex min-w-0 flex-1 justify-center overflow-x-clip"
          }
        >
          <div className="mx-auto flex w-full max-w-3xl flex-col md:max-w-4xl xl:max-w-5xl">
            {editorPane}
          </div>
        </div>

        {/* 右：闪卡侧栏（仅分栏时） */}
        {showCards && (
          <CardSidebar noteId={note.id} onClose={() => setShowCards(false)} />
        )}
      </div>

      {/* 右下角悬浮按钮：没有闪卡→转成闪卡；有闪卡→电脑端分栏 / 手机端跳卡片页 */}
      {!showCards && (
        <button
          onClick={handleFlashcards}
          className="fixed bottom-[calc(1rem+env(safe-area-inset-bottom))] right-4 z-30 flex items-center gap-1.5 rounded-full bg-teal-600 px-4 py-3 text-sm font-semibold text-white shadow-lg transition-colors hover:bg-teal-700 md:bottom-8 md:right-8"
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
