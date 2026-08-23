"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { FlaskConical, Play, FolderOpen, Sparkles, BookX } from "lucide-react";
import type { ReviewStats, CollectionSummary } from "@/lib/types";
import type { ReviewItem } from "@/lib/supabase/queries";
import { SpeakButton } from "./speak-button";
import { CardFront } from "./card-front";

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

/** 读取上次在背的合集（背了几张就由 review-session 写入 localStorage 的进度）。 */
function findStoredActiveCollection(
  collections: CollectionSummary[]
): CollectionSummary | null {
  try {
    const raw = localStorage.getItem("ln_active_collection");
    if (!raw) return null;
    const stored = JSON.parse(raw) as { key?: string } | null;
    if (!stored?.key) return null;
    return collections.find((c) => c.key === stored.key) ?? null;
  } catch {
    // localStorage 不可用 / 内容损坏都忽略，不影响兜底逻辑。
    return null;
  }
}

/**
 * 复习页主页：
 * 1. 顶部标题 + 错题集入口；
 * 2. 统计卡片组（今日已复习 / 到期待复习 / 已掌握 / 待加强）；
 * 3. 「正在背的合集」→ 继续背 / 测试 / 故事模式（都作用于当前合集）；
 * 4. 待加强的卡；
 * 5. 选择合集弹窗（切换「正在背」，背/测跟随切换）。
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
  // 「正在背的合集」：先按最近复习、到期最多、第一个兜底（确定性，避免 SSR 与客户端不一致）；
  // 挂载后再读上次背过的那个（背了几张就落 localStorage 的进度）切换过去。用户也可在弹窗里切换。
  const [current, setCurrent] = useState<CollectionSummary | null>(() => {
    const reviewed = collections
      .filter((c) => c.lastReviewedAt != null)
      .sort((a, b) => (b.lastReviewedAt ?? 0) - (a.lastReviewedAt ?? 0))[0];
    if (reviewed) return reviewed;
    return collections.find((c) => c.due > 0) ?? collections[0] ?? null;
  });
  useEffect(() => {
    const stored = findStoredActiveCollection(collections);
    if (stored) setCurrent(stored);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const [pickerOpen, setPickerOpen] = useState(false);

  // 「到期待复习」只看「正在背的合集」里的新旧待复习卡（不数全局，避免随新卡越积越多）。
  const statCards = [
    { label: "今日已复习", value: stats.todayReviewed },
    { label: "到期待复习", value: current?.due ?? 0 },
    { label: "已掌握", value: stats.mastered },
    { label: "待加强", value: stats.weak },
  ];

  return (
    <div>
      <header className="sticky top-[max(1rem,env(safe-area-inset-top))] z-20 -mx-4 -mt-6 mb-5 flex items-center justify-between gap-3 border-b border-zinc-100 bg-paper/95 px-4 py-3 backdrop-blur md:static md:mx-0 md:mt-0 md:border-0 md:bg-transparent md:px-0 md:py-0">
        <h1 className="text-2xl font-bold text-zinc-900">复习</h1>
        <Link
          href="/review?scope=errors"
          className="inline-flex items-center gap-1.5 rounded-xl border border-zinc-200 px-4 py-2 text-sm font-semibold text-zinc-600 transition-colors hover:bg-zinc-50"
        >
          <BookX className="h-4 w-4" />
          错题集
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
              <button
                onClick={() => setPickerOpen(true)}
                className="shrink-0 inline-flex items-center gap-1.5 rounded-lg border border-teal-200 px-3 py-1.5 text-sm font-medium text-teal-600 transition-colors hover:bg-teal-50"
              >
                <FolderOpen className="h-4 w-4" />
                选择合集
              </button>
            </div>
            <div className="mt-4 space-y-2">
              <Link href={collectionHref(current)} className="btn-brand w-full">
                <Play className="h-4 w-4" />
                继续背
              </Link>
              <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
                <Link
                  href={collectionHref(current, "test")}
                  className="inline-flex items-center justify-center gap-1.5 rounded-xl border border-teal-200 px-4 py-2 text-sm font-semibold text-teal-600 transition-colors hover:bg-teal-50"
                >
                  <FlaskConical className="h-4 w-4" />
                  测试
                </Link>
                <Link
                  href={collectionHref(current, "cloze")}
                  className="inline-flex items-center justify-center gap-1.5 rounded-xl border border-teal-200 px-4 py-2 text-sm font-semibold text-teal-600 transition-colors hover:bg-teal-50"
                >
                  <Sparkles className="h-4 w-4" />
                  完形填空
                </Link>
                <Link
                  href={collectionHref(current, "story")}
                  className="inline-flex items-center justify-center gap-1.5 rounded-xl border border-teal-200 px-4 py-2 text-sm font-semibold text-teal-600 transition-colors hover:bg-teal-50"
                >
                  <Sparkles className="h-4 w-4" />
                  故事模式
                </Link>
              </div>
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
                  <p className="truncate text-sm font-medium text-zinc-900">
                    <CardFront text={w.card.front} reading={w.card.reading} />
                  </p>
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

      {/* 选择合集弹窗：点某个合集即切换「正在背」，也可直接背/测 */}
      {pickerOpen && (
        <div
          className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 sm:items-center sm:p-4"
          onClick={() => setPickerOpen(false)}
        >
          <div
            className="flex max-h-[80vh] w-full flex-col rounded-t-2xl bg-white shadow-xl sm:max-w-lg sm:rounded-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            <header className="flex items-center justify-between border-b border-zinc-100 px-4 py-3">
              <h2 className="text-base font-semibold text-zinc-900">选择要背的合集</h2>
              <button
                onClick={() => setPickerOpen(false)}
                className="rounded-lg px-2 py-1 text-zinc-400 hover:bg-zinc-100 hover:text-zinc-700"
                aria-label="关闭"
              >
                ✕
              </button>
            </header>
            <div className="flex-1 overflow-y-auto px-4 py-3">
              {collections.length === 0 ? (
                <p className="py-8 text-center text-sm text-zinc-500">
                  还没有闪卡。先去笔记里「⋯ → 转成闪卡」，或去「卡片」页添加。
                </p>
              ) : (
                <ul className="space-y-2">
                  {collections.map((c) => {
                    const active = current?.key === c.key;
                    return (
                      <li
                        key={c.key}
                        className={`flex items-center gap-3 rounded-xl border px-4 py-3 transition-colors ${
                          active
                            ? "border-teal-300 bg-teal-50"
                            : "border-zinc-200 bg-white hover:border-teal-200"
                        }`}
                      >
                        <button
                          onClick={() => {
                            setCurrent(c);
                            setPickerOpen(false);
                          }}
                          className="min-w-0 flex-1 text-left"
                        >
                          <span className="block truncate text-sm font-medium text-zinc-800">
                            {c.title}
                          </span>
                          <span className="mt-0.5 block text-xs text-zinc-400">
                            待复习 {c.due} · 共 {c.total}
                          </span>
                        </button>
                        {active && (
                          <span className="shrink-0 rounded-full bg-teal-100 px-2 py-0.5 text-xs font-medium text-teal-700">
                            正在背
                          </span>
                        )}
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
                    );
                  })}
                </ul>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
