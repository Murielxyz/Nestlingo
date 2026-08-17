"use client";

import Link from "next/link";
import type { ReviewStats, CollectionSummary } from "@/lib/types";
import type { ReviewItem } from "@/lib/supabase/queries";
import { SpeakButton } from "./speak-button";

function kindBadge(kind: string | null) {
  if (kind === "word") return "生词";
  if (kind === "example") return "例句";
  if (kind === "grammar") return "语法";
  return null;
}

/** 一个合集（笔记 + 类别，或独立卡片）的复习入口链接。 */
function collectionHref(c: CollectionSummary, mode?: string): string {
  const base = `/review?note=${c.noteId ?? "orphans"}`;
  const kind = c.kind ? `&kind=${c.kind}` : "";
  const m = mode ? `&mode=${mode}` : "";
  return base + kind + m;
}

/**
 * 复习页主页：
 * 1. 顶部标题 + 综合测试入口；
 * 2. 主板块「正在背的合集」（最近在背的那一个），可「继续背 / 换一个」；
 * 3. 选择合集列表（背/测）；
 * 4. 待加强的卡；
 * 5. 底部一行轻量数据总览（缩小存在感，不占主视觉）。
 */
export function ReviewHome({
  stats,
  collections,
  weakCards,
}: {
  stats: ReviewStats;
  collections: CollectionSummary[];
  weakCards: ReviewItem[];
}) {
  // 「正在背的合集」：优先最近复习过的那一个；都没复习过就取到期最多（或第一个）。
  const current = (() => {
    const reviewed = collections
      .filter((c) => c.lastReviewedAt != null)
      .sort((a, b) => (b.lastReviewedAt ?? 0) - (a.lastReviewedAt ?? 0))[0];
    if (reviewed) return reviewed;
    return collections.find((c) => c.due > 0) ?? collections[0] ?? null;
  })();

  const maxDay = Math.max(1, ...stats.recentDays.map((d) => d.count));

  return (
    <div>
      <header className="mb-6 flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-bold text-zinc-900">复习</h1>
        <Link
          href="/review?mode=test"
          className="rounded-lg bg-teal-600 px-3.5 py-1.5 text-sm font-semibold text-white transition-colors hover:bg-teal-700"
        >
          🧪 综合测试
        </Link>
      </header>

      {/* 主板块：正在背的合集 */}
      {current ? (
        <section className="mb-6">
          <p className="mb-2 text-xs font-medium text-zinc-400">正在背的合集</p>
          <div className="rounded-2xl border border-teal-200 bg-teal-50/60 p-5">
            <div className="flex items-center justify-between gap-3">
              <div className="min-w-0">
                <p className="truncate text-base font-semibold text-zinc-900">
                  📝 {current.title}
                </p>
                <p className="mt-0.5 text-xs text-zinc-500">
                  待复习 {current.due} · 共 {current.total}
                </p>
              </div>
            </div>
            <div className="mt-4 flex gap-2">
              <Link
                href={collectionHref(current)}
                className="flex-1 rounded-xl bg-teal-600 py-2.5 text-center text-sm font-semibold text-white transition-colors hover:bg-teal-700"
              >
                ▶ 继续背
              </Link>
              <a
                href="#collections"
                className="rounded-xl border border-zinc-200 bg-white px-4 py-2.5 text-sm text-zinc-600 transition-colors hover:bg-zinc-50"
              >
                换一个合集
              </a>
            </div>
          </div>
        </section>
      ) : (
        <section className="mb-6 rounded-2xl border border-dashed border-zinc-300 px-5 py-8 text-center">
          <p className="text-sm text-zinc-500">
            还没有闪卡。先去笔记里「⋯ → 转成闪卡」，或去「卡片」页添加。
          </p>
        </section>
      )}

      {/* 选择合集 */}
      <section id="collections" className="mb-8">
        <h2 className="mb-3 text-sm font-semibold text-zinc-700">选择合集</h2>
        {collections.length === 0 ? (
          <div className="rounded-xl border border-dashed border-zinc-300 px-4 py-8 text-center text-sm text-zinc-500">
            还没有闪卡。先去笔记里「⋯ → 转成闪卡」，或去「卡片」页添加。
          </div>
        ) : (
          <ul className="space-y-2">
            {collections.map((c) => (
              <li
                key={c.key}
                className="flex items-center gap-3 rounded-xl border border-zinc-200 bg-white px-4 py-3"
              >
                <span className="min-w-0 flex-1 truncate text-sm font-medium text-zinc-800">
                  📝 {c.title}
                </span>
                <span className="shrink-0 text-xs text-zinc-400">
                  待复习 {c.due} · 共 {c.total}
                </span>
                <Link
                  href={collectionHref(c)}
                  className={`shrink-0 rounded-lg px-3 py-1.5 text-sm font-semibold transition-colors ${
                    c.due > 0
                      ? "bg-teal-600 text-white hover:bg-teal-700"
                      : "bg-zinc-100 text-zinc-400"
                  }`}
                >
                  背
                </Link>
                <Link
                  href={collectionHref(c, "test")}
                  className="shrink-0 rounded-lg border border-teal-200 px-3 py-1.5 text-sm font-semibold text-teal-600 transition-colors hover:bg-teal-50"
                >
                  测
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>

      {/* 待加强的卡 */}
      {weakCards.length > 0 && (
        <section className="mb-8">
          <div className="mb-3 flex items-center justify-between">
            <h2 className="text-sm font-semibold text-zinc-700">待加强的卡</h2>
            <Link href="/review?scope=weak" className="text-sm text-teal-600 hover:text-teal-700">
              加强复习 →
            </Link>
          </div>
          <ul className="space-y-2">
            {weakCards.map((w) => (
              <li
                key={w.card.id}
                className="flex items-center gap-3 rounded-xl border border-zinc-200 bg-white px-4 py-2.5"
              >
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium text-zinc-900">{w.card.front}</p>
                  <p className="truncate text-xs text-zinc-500">{w.card.back || ""}</p>
                </div>
                {kindBadge(w.card.kind) && (
                  <span className="shrink-0 rounded-full bg-teal-50 px-2 py-0.5 text-xs font-medium text-teal-600">
                    {kindBadge(w.card.kind)}
                  </span>
                )}
                <SpeakButton text={w.card.front} />
                <Link
                  href={`/cards/${w.card.id}?from=/review`}
                  className="shrink-0 text-sm text-zinc-400 transition-colors hover:text-zinc-700"
                >
                  详情
                </Link>
              </li>
            ))}
          </ul>
        </section>
      )}

      {/* 底部：数据总览（缩小存在感，放在最后，样式轻量化） */}
      <section className="border-t border-zinc-100 pt-4">
        <div className="grid grid-cols-4 gap-2 text-center">
          <div>
            <p className="text-base font-semibold text-zinc-600">{stats.todayReviewed}</p>
            <p className="mt-0.5 text-[11px] text-zinc-400">今日已复习</p>
          </div>
          <div>
            <p className="text-base font-semibold text-zinc-600">{stats.due}</p>
            <p className="mt-0.5 text-[11px] text-zinc-400">到期待复习</p>
          </div>
          <div>
            <p className="text-base font-semibold text-zinc-600">{stats.mastered}</p>
            <p className="mt-0.5 text-[11px] text-zinc-400">已掌握</p>
          </div>
          <div>
            <p className="text-base font-semibold text-zinc-600">{stats.weak}</p>
            <p className="mt-0.5 text-[11px] text-zinc-400">待加强</p>
          </div>
        </div>

        {/* 最近 7 天迷你条形图 */}
        <div className="mt-4 flex items-end gap-1.5" aria-hidden>
          {stats.recentDays.map((d) => (
            <div key={d.label} className="flex flex-1 flex-col items-center gap-0.5">
              <div
                className="w-full max-w-[28px] rounded-sm bg-teal-100"
                style={{ height: `${Math.max(3, (d.count / maxDay) * 36)}px` }}
              />
              <span className="text-[10px] text-zinc-300">{d.label}</span>
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}
