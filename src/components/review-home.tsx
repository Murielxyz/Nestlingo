"use client";

import Link from "next/link";
import { FlaskConical, Play } from "lucide-react";
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
 * 2. 统计卡片组（今日已复习 / 到期待复习 / 已掌握 / 待加强）；
 * 3. 「正在背的合集」→ 继续背；
 * 4. 选择合集列表（背/测）；
 * 5. 待加强的卡。
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

  const statCards = [
    { label: "今日已复习", value: stats.todayReviewed },
    { label: "到期待复习", value: stats.due },
    { label: "已掌握", value: stats.mastered },
    { label: "待加强", value: stats.weak },
  ];

  return (
    <div>
      <header className="mb-5 flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-bold text-zinc-900">复习</h1>
        <Link
          href="/review?mode=test"
          className="btn-brand"
        >
          <FlaskConical className="h-4 w-4" />
          综合测试
        </Link>
      </header>

      {/* 统计卡片组（顶部） */}
      <div className="mb-6 grid grid-cols-2 gap-3 sm:grid-cols-4">
        {statCards.map((s) => (
          <div key={s.label} className="card-soft px-4 py-3">
            <p className="text-2xl font-bold text-zinc-900">{s.value}</p>
            <p className="mt-0.5 text-xs text-zinc-500">{s.label}</p>
          </div>
        ))}
      </div>

      {/* 主板块：正在背的合集 */}
      {current ? (
        <section className="mb-6">
          <p className="mb-2 text-xs font-medium text-zinc-400">正在背的合集</p>
          <div className="card-soft p-5">
            <div className="flex items-center justify-between gap-3">
              <div className="min-w-0">
                <p className="truncate text-base font-semibold text-zinc-900">
                  {current.title}
                </p>
                <p className="mt-0.5 text-xs text-zinc-500">
                  待复习 {current.due} · 共 {current.total}
                </p>
              </div>
            </div>
            <div className="mt-4">
              <Link
                href={collectionHref(current)}
                className="btn-brand w-full"
              >
                <Play className="h-4 w-4" />
                继续背
              </Link>
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
      <section className="mb-8">
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
                className="card-soft flex items-center gap-3 px-4 py-3"
              >
                <span className="min-w-0 flex-1 truncate text-sm font-medium text-zinc-800">
                  {c.title}
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
                className="card-soft flex items-center gap-3 px-4 py-2.5"
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
    </div>
  );
}
