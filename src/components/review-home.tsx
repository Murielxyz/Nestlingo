"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  Play,
  FlaskConical,
  Sparkles,
  BookX,
  FolderOpen,
  RefreshCw,
  BookMarked,
  Layers,
} from "lucide-react";
import type { ReviewStats, CollectionSummary, ReviewState, Card } from "@/lib/types";
import type { ReviewItem } from "@/lib/supabase/queries";
import { createClient } from "@/lib/supabase/client";
import { SpeakButton } from "./speak-button";
import { cardLang } from "@/lib/lang-detect";
import { PageHeader } from "./page-header";
import { CardFront } from "./card-front";

/**
 * 复习主页（聚合+练习中心）：
 * 1. 统计卡片组（今日已复习 / 到期待复习 / 已掌握 / 待加强）；
 * 2. 「继续背」大卡：当前合集 + 下一张待复习卡正面，聚合 背 / 测试(含完形) / 故事 / 复习；
 * 3. 闪卡合集：最近在背的轻列表（点击即切换当前合集），「查看更多」→ 闪卡页；
 * 4. 错题集（预览 + 入口）。
 */

/** 一个合集 = 一篇笔记（含全部 kind，背诵按整篇）；未被笔记收纳的卡归「独立闪卡」。 */
type NoteCollection = {
  key: string;
  noteId: string | null;
  title: string;
  total: number;
  due: number;
  lastReviewedAt: number | null;
};

/** 把「note+kind」的合集聚合到「note」级（三种 kind 融合成一篇，背诵不细分）。 */
function mergeByNote(collections: CollectionSummary[]): NoteCollection[] {
  const map = new Map<string, NoteCollection>();
  for (const c of collections) {
    const noteId = c.noteId ?? null;
    const id = noteId ?? "orphans";
    const label = noteId ? c.title : "独立闪卡";
    const ex = map.get(id);
    if (ex) {
      ex.total += c.total;
      ex.due += c.due;
      ex.lastReviewedAt = Math.max(ex.lastReviewedAt ?? 0, c.lastReviewedAt ?? 0);
    } else {
      map.set(id, {
        key: `${id}::`,
        noteId,
        title: label,
        total: c.total,
        due: c.due,
        lastReviewedAt: c.lastReviewedAt,
      });
    }
  }
  return [...map.values()];
}

/** 读取上次在背的合集（背了几张就由 review-session 写入 localStorage 的进度）。 */
function findStoredActiveCollection(cols: NoteCollection[]): NoteCollection | null {
  try {
    const raw = localStorage.getItem("ln_active_collection");
    if (!raw) return null;
    const stored = JSON.parse(raw) as { key?: string } | null;
    if (!stored?.key) return null;
    // 旧 key 形如 `noteId::kind`；按 note 级合起来只需取其 noteId 段匹配。
    const noteId = stored.key.split("::")[0];
    return cols.find((c) => (c.noteId ?? "orphans") === noteId) ?? null;
  } catch {
    return null;
  }
}

/** 兜底合集：最近复习过 > 到期最多 > 第一个（确定性，避免 SSR 与客户端不一致）。 */
function defaultCollection(cols: NoteCollection[]): NoteCollection | null {
  const reviewed = cols
    .filter((c) => c.lastReviewedAt != null)
    .sort((a, b) => (b.lastReviewedAt ?? 0) - (a.lastReviewedAt ?? 0))[0];
  if (reviewed) return reviewed;
  return cols.find((c) => c.due > 0) ?? cols[0] ?? null;
}

/** 下一张待复习卡（没复习过的也算到期），取第一张做露卡面。 */
async function fetchNextCard(noteId: string | null): Promise<ReviewItem | null> {
  const supabase = createClient();
  let q = supabase
    .from("cards")
    .select("*")
    .order("position", { ascending: true })
    .order("created_at", { ascending: true });
  if (noteId) q = q.eq("note_id", noteId);
  else q = q.is("note_id", null);
  const { data: cards, error } = await q;
  if (error || !cards?.length) return null;
  const ids = cards.map((c) => c.id);
  const { data: states } = await supabase.from("review_state").select("*").in("card_id", ids);
  const stateMap = new Map<string, ReviewState>((states ?? []).map((s) => [s.card_id, s]));
  const now = Date.now();
  const next = (cards as Card[]).find((c) => {
    const s = stateMap.get(c.id);
    return !s || new Date(s.due_at).getTime() <= now;
  });
  return next ? { card: next, state: stateMap.get(next.id) ?? null } : null;
}

function collectionHref(c: NoteCollection, mode?: string): string {
  const base = `/review?note=${c.noteId ?? "orphans"}`;
  const m = mode ? `&mode=${mode}` : "";
  return base + m;
}

/** 该合集的闪卡页（查看合集里有哪些卡 / 增删改）。独立闪卡没有笔记，落回 /cards。 */
function flashcardHref(c: NoteCollection): string {
  return c.noteId ? `/notes/${c.noteId}/cards` : "/cards";
}

export function ReviewHome({
  stats,
  collections,
  weakCards,
  errorCards = [],
}: {
  stats: ReviewStats;
  collections: CollectionSummary[];
  weakCards: ReviewItem[];
  errorCards?: ReviewItem[];
}) {
  const merged = useMemo(() => mergeByNote(collections), [collections]);
  const [current, setCurrent] = useState<NoteCollection | null>(() =>
    defaultCollection(mergeByNote(collections))
  );
  const [currentCard, setCurrentCard] = useState<ReviewItem | null>(null);
  const [pickerOpen, setPickerOpen] = useState(false);
  const router = useRouter();

  // 复习页可能被客户端路由缓存（在闪卡页删合集后返回，这里仍显示旧列表）——挂载时刷新一次拿到最新合集。
  useEffect(() => {
    router.refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  // 有上次进度就切过去；否则保持默认（确定性兜底）。
  useEffect(() => {
    const stored = findStoredActiveCollection(merged);
    if (stored) setCurrent(stored);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  // 合集列表变化（如在闪卡页删掉某合集）后，若「当前」已不在列表里，回退到默认。
  useEffect(() => {
    if (current && !merged.some((c) => c.key === current.key)) {
      setCurrent(findStoredActiveCollection(merged) ?? defaultCollection(merged));
    }
  }, [merged, current]);

  // 当前合集变了 → 拉下一张待复习卡做露卡面。
  useEffect(() => {
    let cancelled = false;
    if (!current) {
      setCurrentCard(null);
      return;
    }
    fetchNextCard(current.noteId).then((card) => {
      if (!cancelled) setCurrentCard(card);
    });
    return () => {
      cancelled = true;
    };
  }, [current]);

  // 闪卡合集列表：最近在背/刚转成/新建（按复习时间倒序，再看到期数），默认取前 5。
  const recent = useMemo(
    () =>
      [...merged]
        .sort(
          (a, b) =>
            (b.lastReviewedAt ?? 0) - (a.lastReviewedAt ?? 0) ||
            (b.due ?? 0) - (a.due ?? 0)
        )
        .slice(0, 5),
    [merged]
  );

  // 点「背」直接把该合集切为「当前在背」并落 localStorage（复习主页据此显示「正在背」），再进背诵页。
  function startCollection(c: NoteCollection) {
    setCurrent(c);
    try {
      localStorage.setItem(
        "ln_active_collection",
        JSON.stringify({
          key: `${c.noteId ?? "orphans"}::`,
          noteId: c.noteId ?? null,
          kind: null,
          at: Date.now(),
        })
      );
    } catch {
      // localStorage 不可用就忽略，不影响背诵。
    }
    router.push(collectionHref(c));
  }

  const statCards = [
    { label: "今日已学", value: stats.todayReviewed },
    { label: "到期待学", value: current?.due ?? 0 },
    { label: "已掌握", value: stats.mastered },
    { label: "待复习", value: stats.weak },
  ];

  return (
    <div>
      <PageHeader title="闪卡" />

      {/* 统计卡片组（保留作参考） */}
      <div className="mb-6 grid grid-cols-2 gap-3 sm:grid-cols-4">
        {statCards.map((s) => (
          <div key={s.label} className="card-soft px-4 py-3">
            <p className="text-2xl font-bold text-zinc-900">{s.value}</p>
            <p className="mt-0.5 text-xs text-zinc-500">{s.label}</p>
          </div>
        ))}
      </div>

      {/* ===== 继续背大卡：当前合集 + 露卡面 + 练习方式 ===== */}
      {current ? (
        <section className="mb-8">
          <div className="card-soft p-4 sm:p-5">
            {/* 标题行 */}
            <div className="flex items-center justify-between gap-2">
              <div className="min-w-0">
                <p className="truncate text-base font-semibold text-zinc-900">
                  {current.title}
                </p>
                <p className="mt-0.5 text-xs text-zinc-500">
                  共 {current.total} 张 · 待学 {current.due} 张
                </p>
              </div>
              <button
                onClick={() => setPickerOpen(true)}
                className="shrink-0 inline-flex items-center gap-1 rounded-lg border border-zinc-200 px-2.5 py-2 text-xs font-medium text-zinc-600 transition-colors hover:bg-zinc-50"
              >
                <FolderOpen className="h-3.5 w-3.5" />
                切换合集
              </button>
            </div>

            {/* 露卡面：下一张待复习卡（正面） */}
            {currentCard ? (
              <div className="mt-4 flex items-center justify-center rounded-2xl border border-zinc-100 bg-zinc-50/50 px-4 py-8 text-center">
                <div className="w-full leading-relaxed text-zinc-900 text-2xl font-semibold">
                  <CardFront text={currentCard.card.front} reading={currentCard.card.reading} />
                </div>
              </div>
            ) : current.total > 0 ? (
              <p className="mt-4 rounded-2xl border border-zinc-100 bg-zinc-50/50 px-4 py-8 text-center text-sm text-zinc-400">
                这个合集都学完了，明天再来。
              </p>
            ) : (
              <p className="mt-4 rounded-2xl border border-zinc-100 bg-zinc-50/50 px-4 py-8 text-center text-sm text-zinc-400">
                这个合集还没有闪卡，去闪卡页添加。
              </p>
            )}

            {/* 练习方式：两行——继续背/复习 一行，故事/测试 一行 */}
            <div className="mt-4 grid grid-cols-2 gap-2">
              <Link
                href={collectionHref(current)}
                className="btn-brand flex items-center justify-center gap-1"
              >
                <Play className="h-4 w-4" />
                继续背
              </Link>
              <Link
                href="/review?scope=weak"
                className="flex items-center justify-center gap-1 rounded-xl border border-zinc-200 px-4 py-2.5 text-sm font-medium text-zinc-600 transition-colors hover:bg-zinc-50"
              >
                <RefreshCw className="h-4 w-4" />
                待复习
              </Link>
              <Link
                href={collectionHref(current, "story")}
                className="flex items-center justify-center gap-1 rounded-xl border border-zinc-200 px-4 py-2.5 text-sm font-medium text-zinc-600 transition-colors hover:bg-zinc-50"
              >
                <Sparkles className="h-4 w-4" />
                故事模式
              </Link>
              <Link
                href={collectionHref(current, "test-pick")}
                className="flex items-center justify-center gap-1 rounded-xl border border-teal-200 px-4 py-2.5 text-sm font-semibold text-teal-600 transition-colors hover:bg-teal-50"
              >
                <FlaskConical className="h-4 w-4" />
                测试练习
              </Link>
            </div>
          </div>
        </section>
      ) : (
        <section className="mb-8 rounded-2xl border border-dashed border-zinc-300 px-5 py-8 text-center">
          <p className="text-sm text-zinc-500">
            还没有闪卡合集。先去笔记里「⋯ → 转成闪卡」，或去闪卡页导入。
          </p>
        </section>
      )}

      {/* ===== 闪卡合集：最近在背的轻列表（点击切换当前合集） ===== */}
      {merged.length > 0 && (
        <section className="mb-8">
          <div className="mb-3 flex items-center justify-between">
            <h2 className="text-base font-semibold text-zinc-800">闪卡合集</h2>
            <Link href="/cards" className="text-sm text-teal-600 hover:text-teal-700">
              查看更多 →
            </Link>
          </div>
          <ul className="space-y-2">
            {recent.map((c) => {
              const isCurrent = current?.key === c.key;
              return (
                <li key={c.key}>
                  <div
                    className={`card-soft flex items-center gap-3 px-4 py-3 transition-colors ${
                      isCurrent ? "border-teal-300 bg-teal-50" : "hover:border-teal-200"
                    }`}
                  >
                    {/* 点整行进该合集的闪卡页看内容（独立闪卡回 /cards） */}
                    <Link
                      href={flashcardHref(c)}
                      className="flex min-w-0 flex-1 items-center gap-3 text-left"
                      title="查看合集内容"
                    >
                      <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-teal-50">
                        {c.noteId == null ? (
                          <Layers className="h-4 w-4 text-teal-600" />
                        ) : (
                          <BookMarked className="h-4 w-4 text-teal-600" />
                        )}
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-sm font-medium text-zinc-900">
                          {c.title}
                        </span>
                        <span className="block truncate text-xs text-zinc-500">
                          共 {c.total} 张{c.due > 0 ? ` · 待学 ${c.due}` : ""}
                        </span>
                      </span>
                    </Link>
                    {isCurrent ? (
                      /* 正在背的合集：背按钮灰化不可点（提示已是当前），整行仍可点进看内容 */
                      <span className="shrink-0 rounded-lg bg-zinc-100 px-3 py-1.5 text-sm font-medium text-zinc-400">
                        正在背
                      </span>
                    ) : (
                      <button
                        onClick={() => startCollection(c)}
                        className="shrink-0 rounded-lg bg-teal-600 px-3 py-1.5 text-sm font-semibold text-white transition-colors hover:bg-teal-700"
                      >
                        背
                      </button>
                    )}
                  </div>
                </li>
              );
            })}
          </ul>
        </section>
      )}

      {/* ===== 错题集：预览 + 入口 ===== */}
      <section className="mb-8">
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-base font-semibold text-zinc-800">错题集</h2>
          <Link href="/review?scope=errors" className="text-sm text-teal-600 hover:text-teal-700">
            查看更多 →
          </Link>
        </div>
        {errorCards.length > 0 ? (
          <ul className="space-y-2">
            {errorCards.slice(0, 2).map((e) => (
              <li key={e.card.id} className="card-soft flex items-center gap-3 px-4 py-2.5">
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium text-zinc-900">
                    <CardFront text={e.card.front} reading={e.card.reading} />
                  </p>
                  <p className="truncate text-xs text-zinc-500">{e.card.back || ""}</p>
                </div>
                <SpeakButton text={e.card.front} lang={cardLang(e.card)} />
              </li>
            ))}
          </ul>
        ) : (
          <div className="card-soft flex items-center gap-2 px-4 py-4 text-sm text-zinc-500">
            <BookX className="h-4 w-4 text-zinc-400" />
            还没有错题，测试里选错的卡会出现在这里。
          </div>
        )}
      </section>

      {/* 切换合集弹窗：点某合集即切换「当前」，也可直接背/测 */}
      {pickerOpen && (
        <div
          className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 sm:items-center sm:p-4"
          onClick={() => setPickerOpen(false)}
        >
          <div
            className="flex max-h-[80vh] w-full flex-col rounded-t-3xl bg-white shadow-xl sm:max-w-lg sm:rounded-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            <header className="flex items-center justify-between border-b border-zinc-100 px-4 py-3">
              <h2 className="text-base font-semibold text-zinc-900">切换合集</h2>
              <button
                onClick={() => setPickerOpen(false)}
                className="rounded-lg px-2 py-1.5 text-zinc-400 hover:bg-zinc-100 hover:text-zinc-700"
                aria-label="关闭"
              >
                ✕
              </button>
            </header>
            <div className="flex-1 overflow-y-auto px-4 py-3">
              {merged.length === 0 ? (
                <p className="py-8 text-center text-sm text-zinc-500">
                  还没有闪卡合集。先去笔记里「⋯ → 转成闪卡」，或去闪卡页添加。
                </p>
              ) : (
                <ul className="space-y-2">
                  {merged.map((c) => {
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
                            共 {c.total} 张{c.due > 0 ? ` · 待学 ${c.due}` : ""}
                          </span>
                        </button>
                        {active && (
                          <span className="shrink-0 rounded-full bg-teal-100 px-2 py-0.5 text-xs font-medium text-teal-700">
                            正在背
                          </span>
                        )}
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
