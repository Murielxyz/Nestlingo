"use client";

import { useEffect, useState } from "react";
import { PartyPopper } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { scheduleReview, dueAtFrom, DEFAULT_SCHEDULE, type Rating } from "@/lib/srs";
import type { ReviewItem } from "@/lib/supabase/queries";
import { SpeakButton } from "./speak-button";

// 淡色系评分按钮：浅底 + 深色文字，不再用饱和的实心色块
const RATINGS: { value: Rating; label: string; cls: string }[] = [
  { value: 1, label: "忘记", cls: "bg-red-100 text-red-700 hover:bg-red-200" },
  { value: 2, label: "困难", cls: "bg-orange-100 text-orange-700 hover:bg-orange-200" },
  { value: 3, label: "一般", cls: "bg-emerald-100 text-emerald-700 hover:bg-emerald-200" },
  { value: 4, label: "简单", cls: "bg-teal-100 text-teal-700 hover:bg-teal-200" },
];

/** 把间隔天数翻译成人话：0 = 稍后立刻再看（隔 1 分钟），其它 = N 天后。 */
function intervalText(days: number): string {
  if (days <= 0) return "隔 1 分钟";
  return `${days} 天后`;
}

/**
 * 背诵会话：一次一张，翻面后评分（忘记/困难/一般/简单）。
 * 评分结果按 SM-2 存进 review_state；「忘记」的卡会排到队尾再背一遍。
 * 底部能展开「待复习 / 已复习」两个列表，看到整轮进度。
 */
export function ReviewSession({
  items,
  dailyGoal = 20,
}: {
  items: ReviewItem[];
  dailyGoal?: number;
}) {
  // 按每日目标截断本轮队列；多出来的留到下次。
  const sessionItems = items.slice(0, dailyGoal);
  const [queue, setQueue] = useState<ReviewItem[]>(sessionItems);
  const [flipped, setFlipped] = useState(false);
  const [reviewed, setReviewed] = useState(0);
  const [reviewedCards, setReviewedCards] = useState<ReviewItem[]>([]);
  const [listOpen, setListOpen] = useState<"due" | "done" | null>(null);
  const [saving, setSaving] = useState(false);

  const current = queue[0];

  // 空格键翻面：输入框/文本域里打字不触发，会话结束后也不触发。
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.code !== "Space" || e.repeat) return;
      const t = e.target as HTMLElement | null;
      if (t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.isContentEditable)) {
        return;
      }
      if (!current) return;
      e.preventDefault(); // 阻止页面滚动，也避免焦点在卡片按钮上时重复触发
      setFlipped((f) => !f);
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [current]);

  // 当前这张卡按某个评分会得到多长的间隔，用于评分按钮上的提示。
  const prev = current?.state
    ? {
        ease: current.state.ease,
        intervalDays: current.state.interval_days,
        reps: current.state.reps,
        lapses: current.state.lapses,
      }
    : DEFAULT_SCHEDULE;

  if (!current) {
    return (
      <div className="rounded-2xl border border-zinc-200 bg-white px-6 py-16 text-center">
        <PartyPopper className="h-10 w-10 text-teal-500" />
        <p className="mt-4 text-lg font-semibold text-zinc-900">本轮复习完成！</p>
        <p className="mt-1 text-sm text-zinc-500">共复习 {reviewed} 张卡片。</p>
      </div>
    );
  }

  async function rate(r: Rating) {
    if (saving) return;
    setSaving(true);

    const sched = scheduleReview(prev, r);

    // 入库（更新已有记录，或新建）
    const supabase = createClient();
    const fields = {
      card_id: current.card.id,
      ease: sched.ease,
      interval_days: sched.intervalDays,
      reps: sched.reps,
      lapses: sched.lapses,
      due_at: dueAtFrom(sched.intervalDays),
      last_rating: r,
    };
    let newId = current.state?.id ?? null;
    if (current.state) {
      await supabase.from("review_state").update(fields).eq("id", current.state.id);
    } else {
      const { data } = await supabase
        .from("review_state")
        .insert(fields)
        .select("id")
        .single();
      newId = data?.id ?? null;
    }

    const updatedItem: ReviewItem = {
      card: current.card,
      state: {
        id: newId ?? "",
        card_id: current.card.id,
        ease: sched.ease,
        interval_days: sched.intervalDays,
        reps: sched.reps,
        lapses: sched.lapses,
        due_at: fields.due_at,
        last_rating: r,
        created_at: "",
        updated_at: "",
      },
    };

    setFlipped(false);
    setReviewed((n) => n + 1);
    setReviewedCards((f) => [...f, updatedItem]);
    // 「忘记」→ 排到队尾再背一遍；其它 → 出队
    setQueue((q) => (r === 1 ? [...q.slice(1), updatedItem] : q.slice(1)));
    setSaving(false);
  }

  // 列表里编辑 / 删除后，同步本地队列与已复习列表（避免要刷新页面才更新）。
  function patchCard(id: string, front: string, back: string) {
    const patch = (i: ReviewItem): ReviewItem =>
      i.card.id === id ? { ...i, card: { ...i.card, front, back } } : i;
    setQueue((q) => q.map(patch));
    setReviewedCards((f) => f.map(patch));
  }
  function removeCard(id: string) {
    setQueue((q) => q.filter((i) => i.card.id !== id));
    setReviewedCards((f) => f.filter((i) => i.card.id !== id));
  }

  return (
    <div className="mx-auto max-w-xl">
      {/* 进度 */}
      <div className="mb-4 flex items-center justify-between text-sm text-zinc-500">
        <span>
          已复习 {reviewed} 张 · 待复习 {queue.length} 张
        </span>
        {items.length > dailyGoal && (
          <span className="text-xs text-zinc-400">
            今日目标 {dailyGoal} 张（共 {items.length} 张，其余下次）
          </span>
        )}
      </div>

      {/* 卡片（右上角发音按钮，读当前这面） */}
      <div className="relative">
        <button
          onClick={() => setFlipped((f) => !f)}
          className="flex min-h-[280px] w-full flex-col items-center justify-center rounded-2xl border border-zinc-200 bg-white p-8 text-center shadow-sm transition-colors hover:border-teal-300"
        >
          <p className="mb-3 text-xs uppercase tracking-wide text-zinc-400">
            {flipped ? "背面 · 答案" : "正面 · 点击翻面"}
          </p>
          <p className="whitespace-pre-wrap text-2xl font-semibold leading-relaxed text-zinc-900">
            {flipped ? current.card.back || "（空）" : current.card.front}
          </p>
        </button>
        <div className="absolute right-3 top-3">
          <SpeakButton
            text={flipped ? current.card.back || current.card.front : current.card.front}
          />
        </div>
      </div>

      {/* 评分按钮：没翻面时提示先翻面 */}
      <div className="mt-5">
        {!flipped ? (
          <p className="text-center text-sm text-zinc-400">
            先点卡片翻面，看看自己是否记得
          </p>
        ) : (
          <div className="grid grid-cols-4 gap-2">
            {RATINGS.map((r) => (
              <button
                key={r.value}
                onClick={() => rate(r.value)}
                disabled={saving}
                className={`flex flex-col items-center rounded-xl px-2 py-3 transition-colors disabled:opacity-60 ${r.cls}`}
              >
                <span className="text-sm font-semibold">{r.label}</span>
                <span className="mt-0.5 text-[11px] opacity-80">
                  {intervalText(scheduleReview(prev, r.value).intervalDays)}
                </span>
              </button>
            ))}
          </div>
        )}
      </div>

      {/* 待复习 / 已复习 列表 */}
      <div className="mt-6">
        <div className="flex gap-2 text-sm">
          <button
            onClick={() => setListOpen(listOpen === "due" ? null : "due")}
            className={`rounded-full px-3 py-1 transition-colors ${
              listOpen === "due"
                ? "bg-teal-100 text-teal-700"
                : "bg-zinc-100 text-zinc-600 hover:bg-zinc-200"
            }`}
          >
            待复习 {queue.length}
          </button>
          <button
            onClick={() => setListOpen(listOpen === "done" ? null : "done")}
            className={`rounded-full px-3 py-1 transition-colors ${
              listOpen === "done"
                ? "bg-teal-100 text-teal-700"
                : "bg-zinc-100 text-zinc-600 hover:bg-zinc-200"
            }`}
          >
            已复习 {reviewedCards.length}
          </button>
        </div>

        {listOpen === "due" && (
          <ul className="mt-2 space-y-2">
            {queue.map((q, i) => (
              <li key={`${q.card.id}-${i}`}>
                <ReviewListCard item={q} onChanged={patchCard} onDeleted={removeCard} />
              </li>
            ))}
          </ul>
        )}
        {listOpen === "done" && (
          <ul className="mt-2 space-y-2">
            {reviewedCards.map((q, i) => (
              <li key={`${q.card.id}-${i}`}>
                <ReviewListCard item={q} onChanged={patchCard} onDeleted={removeCard} />
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

/** 待复习 / 已复习列表里的翻面卡：点一下翻正反面，右上角有编辑 / 删除按钮。 */
function ReviewListCard({
  item,
  onChanged,
  onDeleted,
}: {
  item: ReviewItem;
  onChanged: (id: string, front: string, back: string) => void;
  onDeleted: (id: string) => void;
}) {
  const [flipped, setFlipped] = useState(false);
  const [editing, setEditing] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [front, setFront] = useState(item.card.front);
  const [back, setBack] = useState(item.card.back ?? "");

  async function saveEdit() {
    const supabase = createClient();
    const { error } = await supabase
      .from("cards")
      .update({ front: front.trim(), back: back.trim() })
      .eq("id", item.card.id);
    if (!error) {
      onChanged(item.card.id, front.trim(), back.trim());
      setEditing(false);
    }
  }

  async function deleteCard() {
    if (!window.confirm("删除这张卡片？")) return;
    const supabase = createClient();
    const { error } = await supabase.from("cards").delete().eq("id", item.card.id);
    if (!error) onDeleted(item.card.id);
  }

  if (editing) {
    return (
      <div className="space-y-2 rounded-xl border border-teal-300 bg-white p-3">
        <input
          value={front}
          onChange={(e) => setFront(e.target.value)}
          placeholder="正面"
          autoFocus
          className="w-full rounded-lg border border-zinc-300 px-3 py-1.5 text-sm focus:border-teal-500 focus:outline-none"
        />
        <textarea
          value={back}
          onChange={(e) => setBack(e.target.value)}
          placeholder="背面（可换行加例句）"
          rows={2}
          className="w-full rounded-lg border border-zinc-300 px-3 py-1.5 text-sm focus:border-teal-500 focus:outline-none"
        />
        <div className="flex gap-3 text-sm">
          <button onClick={saveEdit} className="text-teal-600 hover:text-teal-700">
            保存
          </button>
          <button
            onClick={() => {
              setFront(item.card.front);
              setBack(item.card.back ?? "");
              setEditing(false);
            }}
            className="text-zinc-500 hover:text-zinc-700"
          >
            取消
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="relative rounded-xl border border-zinc-200 bg-white">
      <button
        onClick={() => setFlipped((f) => !f)}
        className="block w-full cursor-pointer rounded-xl p-3 pr-14 text-left transition-colors hover:border-teal-300"
      >
        <p className="text-[11px] uppercase tracking-wide text-zinc-400">
          {flipped ? "背面" : "正面"}
        </p>
        <p className="mt-0.5 whitespace-pre-wrap text-sm font-medium text-zinc-900">
          {flipped ? back || "（空）" : front}
        </p>
      </button>
      <div className="absolute right-1.5 top-1.5">
        <button
          onClick={(e) => {
            e.stopPropagation();
            setMenuOpen((v) => !v);
          }}
          className="rounded-md px-1.5 py-0.5 text-sm text-zinc-400 hover:bg-zinc-100 hover:text-zinc-700"
          aria-label="更多操作"
        >
          ⋯
        </button>
        {menuOpen && (
          <>
            <div className="fixed inset-0 z-10" onClick={() => setMenuOpen(false)} />
            <div className="absolute right-0 top-full z-20 mt-1 w-28 overflow-hidden rounded-lg border border-zinc-200 bg-white py-1 text-sm shadow-lg">
              <button
                onClick={() => {
                  setMenuOpen(false);
                  setFront(item.card.front);
                  setBack(item.card.back ?? "");
                  setEditing(true);
                }}
                className="block w-full px-3 py-1.5 text-left text-zinc-700 hover:bg-zinc-50"
              >
                编辑
              </button>
              <button
                onClick={() => {
                  setMenuOpen(false);
                  deleteCard();
                }}
                className="block w-full px-3 py-1.5 text-left text-red-600 hover:bg-red-50"
              >
                删除
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
