"use client";

import Link from "next/link";
import { Folder } from "lucide-react";
import { NoteList } from "./notes-browser";
import type { Folder as FolderType, Note } from "@/lib/types";

/**
 * 手机端文件夹详情页：显示一个文件夹里的笔记列表。
 * 从笔记主页点文件夹进入这里，再点某篇笔记进入正文。
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
  return (
    <div className="px-4 py-6">
      <Link
        href="/notes"
        className="inline-flex items-center gap-1 rounded-lg px-2 py-1 -ml-2 text-sm text-zinc-500 transition-colors hover:bg-zinc-100 hover:text-zinc-900"
      >
        ← 返回笔记
      </Link>

      <header className="mb-4 mt-4">
        <h1 className="flex items-center gap-2 text-2xl font-bold text-zinc-900">
          <Folder className="h-6 w-6 text-zinc-400" />
          {folder.name}
        </h1>
        <p className="mt-1 text-sm text-zinc-400">{notes.length} 篇笔记</p>
      </header>

      {notes.length === 0 ? (
        <p className="py-8 text-center text-sm text-zinc-400">
          这个文件夹还是空的，去建一篇笔记收录进来吧。
        </p>
      ) : (
        <NoteList notes={notes} query="" folders={folders} />
      )}
    </div>
  );
}
