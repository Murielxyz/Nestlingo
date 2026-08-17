"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { NoteCards } from "./note-cards";
import type { Card, CardFolderGroup } from "@/lib/types";

type Filter = "all" | "standalone" | "note";

const FILTERS: { key: Filter; label: string }[] = [
  { key: "all", label: "全部" },
  { key: "standalone", label: "独立卡片" },
  { key: "note", label: "笔记闪卡" },
];

/** 一个「闪卡合集」：某篇笔记（含卡片文件）下的全部卡，附上它所在的文件夹。 */
type Collection = {
  noteId: string;
  title: string;
  count: number;
  sourceType: string | null;
  folderId: string | null;
  folderName: string | null;
};

/**
 * 卡片页主体：顶部筛选标签（全部 / 独立卡片 / 笔记闪卡），
 * 下面是平铺的「闪卡合集」卡片（不再用文件夹折叠树，来源文件夹用一个小注释标在卡片上）。
 * - 独立卡片 = 卡片文件（source_type='cards'，📇）+ 不挂任何笔记的孤儿卡。
 * - 笔记闪卡 = 普通笔记（source_type=null）转成的卡。
 */
export function CardsView({
  groups,
  orphans,
}: {
  groups: CardFolderGroup[];
  orphans: Card[];
}) {
  const [filter, setFilter] = useState<Filter>("all");

  // 把「文件夹 → 笔记」摊平成一张张合集卡片，文件夹信息作为来源注释带下来。
  const collections = useMemo<Collection[]>(
    () =>
      groups.flatMap((g) =>
        g.notes.map((n) => ({
          noteId: n.noteId,
          title: n.title,
          count: n.count,
          sourceType: n.sourceType,
          folderId: g.folderId,
          folderName: g.folderId ? g.folderName : null,
        }))
      ),
    [groups]
  );

  const visible =
    filter === "all"
      ? collections
      : collections.filter((c) =>
          filter === "standalone" ? c.sourceType === "cards" : c.sourceType !== "cards"
        );

  // 孤儿卡（note_id 为空）属于「独立添加」，不在「笔记闪卡」里出现。
  const showOrphans = filter !== "note";

  const empty = visible.length === 0 && (!showOrphans || orphans.length === 0);

  return (
    <div>
      {/* 顶部筛选标签 */}
      <div className="mb-4 flex flex-wrap gap-1.5">
        {FILTERS.map((f) => (
          <button
            key={f.key}
            onClick={() => setFilter(f.key)}
            className={`rounded-full px-3.5 py-1.5 text-sm transition-colors ${
              filter === f.key
                ? "bg-teal-600 font-semibold text-white"
                : "border border-zinc-200 text-zinc-600 hover:bg-zinc-50"
            }`}
          >
            {f.label}
          </button>
        ))}
      </div>

      {empty ? (
        <div className="rounded-xl border border-dashed border-zinc-300 px-4 py-10 text-center text-sm text-zinc-500">
          {filter === "standalone"
            ? "还没有独立添加的闪卡。点右上角「＋ 添加闪卡」生成。"
            : filter === "note"
              ? "还没有从笔记转成的闪卡。在笔记里点「⋯ → 转成闪卡」。"
              : "还没有闪卡。"}
        </div>
      ) : (
        <div className="space-y-8">
          {/* 闪卡合集（卡片网格） */}
          {visible.length > 0 && (
            <ul className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {visible.map((c) => (
                <li key={c.noteId}>
                  <Link
                    href={`/notes/${c.noteId}/cards`}
                    className="group flex h-full flex-col rounded-2xl border border-zinc-200 bg-white p-4 transition-colors hover:border-teal-300 hover:shadow-sm"
                  >
                    <div className="flex items-start justify-between gap-2">
                      <span className="text-2xl">{c.sourceType === "cards" ? "📇" : "📝"}</span>
                      <span className="shrink-0 rounded-full bg-teal-50 px-2 py-0.5 text-xs font-medium text-teal-600">
                        {c.count} 张
                      </span>
                    </div>
                    <p className="mt-3 line-clamp-2 min-h-[2.5rem] text-sm font-medium leading-snug text-zinc-800">
                      {c.title || "无标题"}
                    </p>
                    {/* 来源文件夹注释 */}
                    <p className="mt-2 flex items-center gap-1 text-xs text-zinc-400">
                      {c.folderName ? (
                        <>
                          <span>📁</span>
                          <span className="truncate">{c.folderName}</span>
                        </>
                      ) : (
                        <span>未分类</span>
                      )}
                    </p>
                  </Link>
                </li>
              ))}
            </ul>
          )}

          {/* 独立（孤儿）卡片 */}
          {showOrphans && orphans.length > 0 && (
            <section>
              <h2 className="mb-3 flex items-center gap-2 text-sm font-semibold text-zinc-500">
                <span>🃏</span>独立卡片
              </h2>
              <NoteCards cards={orphans} />
            </section>
          )}
        </div>
      )}
    </div>
  );
}
