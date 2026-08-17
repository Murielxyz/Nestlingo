"use client";

import { useState } from "react";
import { NoteCards } from "./note-cards";
import type { Card } from "@/lib/types";

const KINDS: { key: string; label: string }[] = [
  { key: "word", label: "生词" },
  { key: "example", label: "例句" },
  { key: "grammar", label: "语法" },
];

/**
 * 一篇笔记的闪卡页主体：标题 + 「全部/生词/例句/语法」标签页 + 过滤后的卡片列表。
 * 有分类卡时才显示标签页；选中某类时标题自动加「- 生词 / - 例句 / - 语法」后缀。
 */
export function NoteCardsTabs({
  title,
  cards,
  noteId,
}: {
  title: string;
  cards: Card[];
  noteId: string;
}) {
  const [filter, setFilter] = useState<string>("all");

  const counts = new Map<string, number>();
  for (const c of cards) {
    if (c.kind) counts.set(c.kind, (counts.get(c.kind) ?? 0) + 1);
  }
  const presentKinds = KINDS.filter((k) => (counts.get(k.key) ?? 0) > 0);
  const hasKinds = presentKinds.length > 0;

  // 删光某一类后，若还停在那一类，就退回「全部」，避免出现空列表。
  const effectiveFilter =
    filter !== "all" && (counts.get(filter) ?? 0) === 0 ? "all" : filter;

  const visible =
    effectiveFilter === "all"
      ? cards
      : cards.filter((c) => c.kind === effectiveFilter);

  const suffix =
    effectiveFilter === "all"
      ? ""
      : ` - ${KINDS.find((k) => k.key === effectiveFilter)?.label ?? ""}`;

  return (
    <div>
      <header className="mb-4">
        <h1 className="text-2xl font-bold text-zinc-900">
          {title}
          {suffix}
        </h1>
      </header>

      {hasKinds && (
        <div className="mb-4 flex flex-wrap gap-1.5">
          <button
            onClick={() => setFilter("all")}
            className={`rounded-full px-3.5 py-1.5 text-sm transition-colors ${
              effectiveFilter === "all"
                ? "bg-teal-600 font-semibold text-white"
                : "border border-zinc-200 text-zinc-600 hover:bg-zinc-50"
            }`}
          >
            全部 {cards.length}
          </button>
          {presentKinds.map((k) => (
            <button
              key={k.key}
              onClick={() => setFilter(k.key)}
              className={`rounded-full px-3.5 py-1.5 text-sm transition-colors ${
                effectiveFilter === k.key
                  ? "bg-teal-600 font-semibold text-white"
                  : "border border-zinc-200 text-zinc-600 hover:bg-zinc-50"
              }`}
            >
              {k.label} {counts.get(k.key)}
            </button>
          ))}
        </div>
      )}

      <NoteCards cards={visible} noteId={noteId} />
    </div>
  );
}
