"use client";

import { useMemo } from "react";
import Link from "next/link";
import { Folder } from "lucide-react";
import { NoteList } from "./notes-browser";
import { folderTree } from "@/lib/folders";
import type { Folder as FolderType, Note } from "@/lib/types";

/**
 * 手机端文件夹详情页：显示一个文件夹里的子文件夹 + 笔记列表。
 * 从笔记主页点文件夹进入这里；点子文件夹继续下钻，点某篇笔记进入正文。
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
  const subfolders = useMemo(
    () => folderTree(folders).children.get(folder.id) ?? [],
    [folders, folder.id]
  );

  return (
    <div className="px-4 py-6">
      <header className="sticky top-0 z-20 -mx-4 -mt-6 mb-4 border-b border-zinc-100 bg-white px-4 pb-3 pt-[calc(env(safe-area-inset-top)+0.75rem)]">
        <Link
          href={folder.parent_id ? `/notes/folder/${folder.parent_id}` : "/notes"}
          className="inline-flex items-center gap-1 rounded-lg px-2 py-1 -ml-2 text-sm text-zinc-500 transition-colors hover:bg-zinc-100 hover:text-zinc-900"
        >
          ← {folder.parent_id ? "上一级" : "返回笔记"}
        </Link>

        <h1 className="mt-2 flex items-center gap-2 text-2xl font-bold text-zinc-900">
          <Folder className="h-6 w-6 text-zinc-400" />
          {folder.name}
        </h1>
        <p className="mt-1 text-sm text-zinc-400">
          {notes.length} 篇笔记
          {subfolders.length > 0 ? ` · ${subfolders.length} 个子文件夹` : ""}
        </p>
      </header>

      {subfolders.length > 0 && (
        <div className="mb-5">
          <p className="mb-2 text-xs font-medium text-zinc-400">子文件夹</p>
          <ul className="space-y-1.5">
            {subfolders.map((sub) => (
              <li key={sub.id}>
                <Link
                  href={`/notes/folder/${sub.id}`}
                  className="flex items-center gap-2 rounded-lg border border-zinc-200 bg-white px-3 py-2.5 transition-colors hover:border-teal-300"
                >
                  <Folder className="h-4 w-4 shrink-0 text-zinc-400" />
                  <span className="min-w-0 flex-1 truncate text-sm font-semibold text-zinc-800">
                    {sub.name}
                  </span>
                  <span className="text-xs text-zinc-400">→</span>
                </Link>
              </li>
            ))}
          </ul>
        </div>
      )}

      {notes.length === 0 && subfolders.length === 0 ? (
        <p className="py-8 text-center text-sm text-zinc-400">
          这个文件夹还是空的，去建一篇笔记或子文件夹收录进来吧。
        </p>
      ) : notes.length > 0 ? (
        <NoteList notes={notes} query="" folders={folders} />
      ) : null}
    </div>
  );
}
