"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import dynamic from "next/dynamic";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { ConvertToCards } from "./convert-to-cards";
import { ShareModal } from "./share-modal";
import { CardSidebar } from "./card-sidebar";
import type { Folder, Note } from "@/lib/types";
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
}: {
  note: Note;
  folders: Folder[];
  backHref: string;
  cardCount: number;
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
  const [newFolderOpen, setNewFolderOpen] = useState(false);
  const [newFolderName, setNewFolderName] = useState("");
  const [showCards, setShowCards] = useState(false);

  // 实时保存用：保存时读 ref 的最新值，避免 debounce 闭包拿到旧 title/folderId。
  const titleRef = useRef(note.title);
  const folderIdRef = useRef(note.folder_id ?? "");
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const dirtyRef = useRef(false);

  useEffect(() => {
    folderIdRef.current = folderId;
  }, [folderId]);

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

  /** 「完成」：先把没触发的自动保存立即落一次，再回到笔记列表。 */
  async function finishEdit() {
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    await save();
    router.push(backHref);
  }

  /** 把笔记收录到某个文件夹。 */
  async function moveToFolder(id: string) {
    setFolderId(id);
    setMenuOpen(false);
    await save(id);
  }

  /** 新建一个文件夹，并把笔记直接收进去。 */
  async function createFolderAndMove() {
    const name = newFolderName.trim();
    if (!name) return;
    const supabase = createClient();
    const { data, error } = await supabase
      .from("folders")
      .insert({ name })
      .select("id")
      .single();
    if (error || !data) {
      setError(error?.message ?? "创建文件夹失败。");
      return;
    }
    setNewFolderName("");
    setNewFolderOpen(false);
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
    setError(null);
    const supabase = createClient();
    const { error } = await supabase.from("notes").delete().eq("id", note.id);
    if (error) {
      setError(error.message);
      return;
    }
    router.replace("/notes");
  }

  const editorPane = (
    <>
      <div className="px-4 pt-5 md:px-8">
        <input
          value={title}
          onChange={(e) => {
            setTitle(e.target.value);
            titleRef.current = e.target.value;
            scheduleAutoSave();
          }}
          placeholder="标题"
          className="w-full border-none bg-transparent text-2xl font-bold text-zinc-900 placeholder-zinc-300 focus:outline-none md:text-3xl"
        />
      </div>
      <RichTextEditor initialContent={note.content} onChange={handleChange} />
    </>
  );

  return (
    <div
      className={
        showCards
          ? "flex h-screen flex-col overflow-hidden bg-white"
          : "flex min-h-screen flex-col bg-white"
      }
    >
      {/* ===== 顶部：返回 + 菜单 + 完成 ===== */}
      <header className="sticky top-0 z-30 flex items-center gap-2 border-b border-zinc-200 bg-white/95 px-3 py-2 backdrop-blur md:px-4">
        <Link
          href={backHref}
          className="rounded-lg p-1.5 text-zinc-500 transition-colors hover:bg-zinc-100 hover:text-zinc-900"
          aria-label="返回"
        >
          ←
        </Link>

        {/* 保存状态（居中，安静地显示） */}
        <span className="flex-1 truncate text-center text-xs text-zinc-400">
          {saving ? "保存中…" : saved ? "已保存 ✓" : error ? error : ""}
        </span>

        {/* 分享生成图片（独立按钮，放在菜单旁） */}
        <button
          onClick={() => setShareOpen(true)}
          className="rounded-lg px-2 py-1.5 text-zinc-600 transition-colors hover:bg-zinc-100 hover:text-zinc-900"
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

        {/* 菜单按钮 */}
        <div className="relative">
          <button
            onClick={() => setMenuOpen((v) => !v)}
            className="rounded-lg px-2 py-1.5 text-zinc-600 transition-colors hover:bg-zinc-100 hover:text-zinc-900"
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
                <p className="px-2.5 py-1.5 text-xs font-medium text-zinc-400">
                  收录到文件夹
                </p>

                {folders.map((f) => (
                  <button
                    key={f.id}
                    onClick={() => moveToFolder(f.id)}
                    className={`flex w-full items-center justify-between rounded-lg px-2.5 py-2 text-left text-sm transition-colors ${
                      folderId === f.id
                        ? "bg-teal-50 text-teal-700"
                        : "text-zinc-700 hover:bg-zinc-100"
                    }`}
                  >
                    <span className="truncate">📁 {f.name}</span>
                    {folderId === f.id && <span>✓</span>}
                  </button>
                ))}

                {newFolderOpen ? (
                  <div className="flex items-center gap-1.5 px-1 py-1">
                    <input
                      value={newFolderName}
                      onChange={(e) => setNewFolderName(e.target.value)}
                      placeholder="新文件夹名"
                      autoFocus
                      onKeyDown={(e) => {
                        if (e.key === "Enter") createFolderAndMove();
                        if (e.key === "Escape") setNewFolderOpen(false);
                      }}
                      className="min-w-0 flex-1 rounded-lg border border-zinc-300 px-2 py-1 text-sm focus:border-teal-500 focus:outline-none"
                    />
                    <button
                      onClick={createFolderAndMove}
                      className="text-sm font-medium text-teal-600 hover:text-teal-700"
                    >
                      创建
                    </button>
                  </div>
                ) : (
                  <button
                    onClick={() => setNewFolderOpen(true)}
                    className="flex w-full items-center rounded-lg px-2.5 py-2 text-left text-sm text-zinc-700 transition-colors hover:bg-zinc-100"
                  >
                    <span>＋ 新建文件夹</span>
                  </button>
                )}

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

                <Link
                  href={`/notes/${note.id}/cards`}
                  onClick={() => setMenuOpen(false)}
                  className="flex w-full items-center rounded-lg px-2.5 py-2 text-left text-sm text-zinc-700 transition-colors hover:bg-zinc-100"
                >
                  查看闪卡
                </Link>

                <div className="my-1 h-px bg-zinc-100" />

                <button
                  onClick={() => {
                    setMenuOpen(false);
                    save();
                  }}
                  className="flex w-full items-center rounded-lg px-2.5 py-2 text-left text-sm text-zinc-700 transition-colors hover:bg-zinc-100"
                >
                  保存
                </button>

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

        {/* 完成：保存并返回笔记列表（内容本来就会自动保存） */}
        <button
          onClick={finishEdit}
          disabled={saving}
          className="rounded-lg bg-teal-600 px-3.5 py-1.5 text-sm font-semibold text-white transition-colors hover:bg-teal-700 disabled:opacity-60"
        >
          完成
        </button>
      </header>

      {/* ===== 大标题 + 正文 ===== */}
      <div
        className={
          showCards ? "flex min-h-0 flex-1 overflow-hidden" : "flex flex-1"
        }
      >
        {/* 编辑器始终挂在同一个容器里，不因分栏开关而重挂（否则会丢未保存内容） */}
        <div
          className={
            showCards ? "min-w-0 flex-1 overflow-y-auto" : "flex flex-1 justify-center"
          }
        >
          <div className="mx-auto flex w-full max-w-3xl flex-col">
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
          className="fixed bottom-20 right-4 z-30 flex items-center gap-1.5 rounded-full bg-teal-600 px-4 py-3 text-sm font-semibold text-white shadow-lg transition-colors hover:bg-teal-700 md:bottom-8 md:right-8"
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
    </div>
  );
}
