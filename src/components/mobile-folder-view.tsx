"use client";

import { useMemo } from "react";
import { NoteList, ViewToggleButton } from "./notes-browser";
import { NewNoteButton } from "./new-note-button";
import { BackButton } from "./back-button";
import { descendantFolderIds } from "@/lib/folders";
import { useNotesView } from "@/lib/notes-view";
import type { Folder as FolderType, Note } from "@/lib/types";

/**
 * 手机端文件夹详情页（次级页）：只展示这个文件夹子树下「所有」笔记（含次级文件夹里的笔记），
 * 像苹果备忘录那样，子文件夹留在文件夹列表里用 toggle 箭头管理层级，不在这里单独分一栏。
 * 导航条 = 返回 ‹ + 标题 + 居中「· N 篇笔记」+ 右侧视图切换 + 新建，单行窄吸顶，左右协调。
 */
export function MobileFolderView({
  folder,
  notes,
  folders,
}: {
  folder: FolderType;
  notes: Note[];
  folders: FolderType[];
}) {
  // 「全部笔记」专用 scope：收纳整个库（含未归档的），不做任何过滤。
  const isAll = folder.id === "all";
  // 本文件夹 + 全部后代文件夹的 id 集合，用于挑出「属于这个子树」的所有笔记；「unfiled」为 null 表示「只看无文件夹的」。
  const subtreeIds = useMemo(
    () => (folder.id === "unfiled" ? null : descendantFolderIds(folders, folder.id)),
    [folder.id, folders]
  );

  // 列表 / 网格视图（受控，切换按钮由本页头部承担，NoteList 不再自渲染）；跨页面记住选择。
  const [view, changeView] = useNotesView();

  const folderNotes = useMemo(() => {
    if (isAll) return notes;
    if (!subtreeIds) return notes.filter((n) => !n.folder_id);
    return notes.filter((n) => n.folder_id && subtreeIds.has(n.folder_id));
  }, [notes, subtreeIds, isAll]);

  const backHref = folder.parent_id ? `/notes/folder/${folder.parent_id}` : "/notes";
  const newFolderId = folder.id === "unfiled" || folder.id === "all" ? null : folder.id;

  return (
    <div
      className="flex flex-col"
      style={{ height: "calc(100dvh - 5rem - env(safe-area-inset-bottom))" }}
    >
      {/* 次级页导航条：返回 ‹ + 标题 + 居中「· N 篇笔记」+ 右侧视图切换 + 新建，单行窄吸顶。 */}
      <header className="shrink-0 border-b border-black/5 px-4 pb-3 pt-[calc(env(safe-area-inset-top)+1rem)]">
        <div className="relative flex items-center gap-2">
          <BackButton
            fallback={backHref}
            className="icon-btn text-xl"
          />
          {/* 标题 + 篇数上下两行：篇数不再绝对居中压在标题上，多长的文件夹名都不会重合。 */}
          <div className="min-w-0 flex-1">
            <h1 className="truncate text-lg font-bold leading-tight text-zinc-900">
              {folder.name}
            </h1>
            <p className="mt-0.5 truncate text-xs text-zinc-400">
              {folderNotes.length} 篇笔记
            </p>
          </div>
          <ViewToggleButton
            view={view}
            onChange={changeView}
            className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-zinc-200 text-zinc-600 transition-colors hover:bg-zinc-50"
          />
          <NewNoteButton folderId={newFolderId} />
        </div>
      </header>

      <div className="min-h-0 flex-1 overflow-y-auto px-4 py-4">
        {folderNotes.length === 0 ? (
          <p className="py-8 text-center text-sm text-zinc-400">
            这个文件夹还是空的，去建一篇笔记收录进来吧。
          </p>
        ) : (
          <NoteList
            notes={folderNotes}
            query=""
            folders={folders}
            showCount={false}
            view={view}
            onViewChange={changeView}
          />
        )}
      </div>
    </div>
  );
}
