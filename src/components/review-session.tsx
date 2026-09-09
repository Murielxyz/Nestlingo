"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { PartyPopper, List, Shuffle } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { scheduleReview, dueAtFrom, DEFAULT_SCHEDULE, type Rating } from "@/lib/srs";
import type { ReviewItem } from "@/lib/supabase/queries";
import { cardLang, LANG_LABEL, LANG_ORDER, type Lang } from "@/lib/lang-detect";
import { CardBack } from "./card-back";
import { CardFront } from "./card-front";
import { SpeakButton } from "./speak-button";
import { TestSession } from "./test-session";

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

/** Fisher-Yates 洗牌（不修改原数组）。 */
function shuffleArray<T>(arr: T[]): T[] {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

/**
 * 背诵会话：一次一张，翻面后评分（忘记/困难/一般/简单）。
 * 评分结果按 SM-2 存进 review_state；「忘记」的卡会排到队尾再背一遍。
 * 底部能展开「待复习 / 已复习」两个列表，看到整轮进度。
 */
export function ReviewSession({
  items,
  dailyGoal = 20,
  canRememberCollection = true,
  shuffleDefault = false,
}: {
  items: ReviewItem[];
  dailyGoal?: number;
  /** 主题背诵不属于「复习主页合集」语义，不要改写「正在背的合集」进度。 */
  canRememberCollection?: boolean;
  /** 来自设置的「默认随机顺序背诵」：挂载即洗牌，可临时切回顺序。 */
  shuffleDefault?: boolean;
}) {
  // 按每日目标截断本轮队列；多出来的留到下次。
  const sessionItems = items.slice(0, dailyGoal);
  const [queue, setQueue] = useState<ReviewItem[]>(() =>
    shuffleDefault ? shuffleArray(sessionItems) : sessionItems
  );
  // 随机顺序：关闭 = 按合集原顺序（position），开启 = 洗牌当前待学队列。
  const [shuffled, setShuffled] = useState(shuffleDefault);
  // 挂载时的原始顺序快照，切回「顺序」时把还没背的卡按它重排。
  const orderedRef = useRef<ReviewItem[]>(sessionItems);
  const [flipped, setFlipped] = useState(false);
  const [reviewed, setReviewed] = useState(0);
  const [reviewedCards, setReviewedCards] = useState<ReviewItem[]>([]);
  const [listOpen, setListOpen] = useState<"due" | "done">("due");
  const [bankOpen, setBankOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);

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

  // 背完后直接「测试练习」：对刚背过的卡出选择题（选择测试）。
  if (testing) {
    return (
      <div>
        <button
          onClick={() => setTesting(false)}
          className="mb-4 inline-flex items-center gap-1 text-sm text-teal-600 transition-colors hover:text-teal-700"
        >
          ← 返回学习结果
        </button>
        <TestSession
          cards={reviewedCards.map((r) => r.card)}
          title="测试练习"
          backHref="/review"
        />
      </div>
    );
  }

  if (!current) {
    return (
      <div className="rounded-2xl border border-zinc-200 bg-white px-6 py-16 text-center">
        <div className="flex justify-center">
          <PartyPopper className="h-10 w-10 text-teal-500" />
        </div>
        <p className="mt-4 text-lg font-semibold text-zinc-900">本轮学习完成！</p>
        <p className="mt-1 text-sm text-zinc-500">共学 {reviewed} 张闪卡。</p>
        <button
          onClick={() => setTesting(true)}
          disabled={reviewedCards.length === 0}
          className="mt-6 rounded-lg bg-teal-600 px-5 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-teal-700 disabled:opacity-50"
        >
          测试练习
        </button>
      </div>
    );
  }

  async function rate(r: Rating) {
    if (saving) return;
    setSaving(true);

    // 背了这一张就记住「当前在背的合集」，复习主页据此显示「正在背的合集」（背了几张就落这个进度）。
    if (canRememberCollection) {
      try {
        localStorage.setItem(
          "ln_active_collection",
          JSON.stringify({
            key: `${current.card.note_id ?? "orphans"}::${current.card.kind ?? ""}`,
            noteId: current.card.note_id ?? null,
            kind: current.card.kind ?? null,
            at: Date.now(),
          })
        );
      } catch {
        // localStorage 不可用（隐私模式等）就忽略，不影响背诵。
      }
    }

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
  function patchCard(id: string, front: string, back: string, lang: string | null) {
    const patch = (i: ReviewItem): ReviewItem =>
      i.card.id === id ? { ...i, card: { ...i.card, front, back, lang } } : i;
    setQueue((q) => q.map(patch));
    setReviewedCards((f) => f.map(patch));
  }
  function removeCard(id: string) {
    setQueue((q) => q.filter((i) => i.card.id !== id));
    setReviewedCards((f) => f.filter((i) => i.card.id !== id));
  }

  // 切换「随机顺序」：开启洗牌当前待学队列；关闭则把还没背的卡按原始顺序重排。
  function toggleShuffle() {
    setShuffled((v) => {
      if (v) {
        // 随机 → 顺序：当前 queue 里仍在的卡按原始顺序（orderedRef）重排。
        setQueue((q) => {
          const remaining = new Set(q.map((i) => i.card.id));
          return orderedRef.current.filter((i) => remaining.has(i.card.id));
        });
      } else {
        // 顺序 → 随机：洗牌当前 queue。
        setQueue((q) => shuffleArray(q));
      }
      return !v;
    });
  }

  return (
    <div className="mx-auto max-w-xl">
      {/* 进度 + 词库入口 */}
      <div className="mb-4 flex items-center justify-between text-sm text-zinc-500">
        <span>
          已学 {reviewed} 张 · 待学 {queue.length} 张
        </span>
        <span className="flex items-center gap-2">
          <button
            onClick={toggleShuffle}
            aria-pressed={shuffled}
            title={shuffled ? "恢复顺序背诵" : "随机顺序背诵"}
            className={`inline-flex items-center gap-1 rounded-lg px-2 py-1.5 text-xs font-medium transition-colors ${
              shuffled
                ? "bg-teal-50 text-teal-600 hover:bg-teal-100"
                : "text-zinc-500 hover:bg-zinc-100 hover:text-zinc-800"
            }`}
          >
            <Shuffle className="h-3.5 w-3.5" />
            随机
          </button>
          <button
            onClick={() => setBankOpen((v) => !v)}
            className="inline-flex items-center gap-0.5 rounded-lg px-2 py-1.5 text-xs font-medium text-zinc-500 transition-colors hover:bg-zinc-100 hover:text-zinc-800"
          >
            <List className="h-3.5 w-3.5" />
            词库
          </button>
        </span>
      </div>

      {/* 卡片（右上角发音按钮，读当前这面） */}
      <div className="relative">
        <button
          onClick={() => setFlipped((f) => !f)}
          className="flex min-h-[60vh] w-full flex-col items-center justify-center rounded-2xl border border-zinc-200 bg-white p-8 text-center shadow-sm transition-colors hover:border-teal-300 sm:min-h-[320px]"
        >
          <p className="mb-3 text-xs uppercase tracking-wide text-zinc-400">
            {flipped ? "背面 · 答案" : "正面 · 点击翻面"}
          </p>
          {/* 正面大（要记的词/句），背面可读大小（定义 + 例句，避免 text-2xl 撑爆整句） */}
          <div
            className={`w-full leading-relaxed text-zinc-900 ${
              flipped ? "text-lg font-medium" : "text-3xl font-semibold"
            }`}
          >
            {flipped ? (
              <CardBack
                back={current.card.back ?? ""}
                front={current.card.front}
                reading={current.card.reading}
                center
              />
            ) : (
              <CardFront text={current.card.front} reading={current.card.reading} />
            )}
          </div>
        </button>
        <div className="absolute right-3 top-3">
          <SpeakButton
            text={flipped ? current.card.back || current.card.front : current.card.front}
            lang={cardLang(current.card)}
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

      {/* 词库弹窗：隐藏菜单，背诵界面保持专注不被打扰 */}
      {bankOpen && (
        <div
          className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 sm:items-center sm:p-4"
          onClick={() => setBankOpen(false)}
        >
          <div
            className="flex h-[min(80vh,30rem)] w-full flex-col rounded-t-3xl bg-white shadow-xl sm:max-w-lg sm:rounded-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            <header className="flex items-center justify-between border-b border-zinc-100 px-4 py-3">
              <h2 className="text-base font-semibold text-zinc-900">词库</h2>
              <button
                onClick={() => setBankOpen(false)}
                className="rounded-lg px-2 py-1.5 text-zinc-400 hover:bg-zinc-100 hover:text-zinc-700"
                aria-label="关闭"
              >
                ✕
              </button>
            </header>
            <div className="flex gap-2 px-4 pt-3 text-sm">
              <button
                onClick={() => setListOpen("due")}
                className={`rounded-full px-3 py-2 transition-colors ${
                  listOpen === "due"
                    ? "bg-teal-100 text-teal-700"
                    : "bg-zinc-100 text-zinc-600 hover:bg-zinc-200"
                }`}
              >
                待学 {queue.length}
              </button>
              <button
                onClick={() => setListOpen("done")}
                className={`rounded-full px-3 py-2 transition-colors ${
                  listOpen === "done"
                    ? "bg-teal-100 text-teal-700"
                    : "bg-zinc-100 text-zinc-600 hover:bg-zinc-200"
                }`}
              >
                已学 {reviewedCards.length}
              </button>
            </div>
            <div className="flex-1 overflow-y-auto px-4 py-3">
              {listOpen === "due" ? (
                queue.length === 0 ? (
                  <p className="py-6 text-center text-sm text-zinc-400">
                    待学的卡都在上面了，继续背吧。
                  </p>
                ) : (
                  <ul className="space-y-2">
                    {queue.map((q, i) => (
                      <li key={`${q.card.id}-${i}`}>
                        <ReviewListCard item={q} onChanged={patchCard} onDeleted={removeCard} />
                      </li>
                    ))}
                  </ul>
                )
              ) : reviewedCards.length === 0 ? (
                <p className="py-6 text-center text-sm text-zinc-400">这一轮还没学过的卡。</p>
              ) : (
                <ul className="space-y-2">
                  {reviewedCards.map((q, i) => (
                    <li key={`${q.card.id}-${i}`}>
                      <ReviewListCard item={q} onChanged={patchCard} onDeleted={removeCard} />
                    </li>
                  ))}
                </ul>
              )}
            </div>
            <footer className="border-t border-zinc-100 px-4 py-3">
              <Link
                href={current.card.note_id ? `/notes/${current.card.note_id}/cards` : "/cards"}
                onClick={() => setBankOpen(false)}
                className="block text-center text-sm font-medium text-teal-600 hover:text-teal-700"
              >
                查看全部 → 闪卡页
              </Link>
            </footer>
          </div>
        </div>
      )}
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
  onChanged: (id: string, front: string, back: string, lang: string | null) => void;
  onDeleted: (id: string) => void;
}) {
  const [flipped, setFlipped] = useState(false);
  const [editing, setEditing] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [front, setFront] = useState(item.card.front);
  const [back, setBack] = useState(item.card.back ?? "");
  const [lang, setLang] = useState<Lang>(cardLang(item.card));

  async function saveEdit() {
    const supabase = createClient();
    const { error } = await supabase
      .from("cards")
      .update({ front: front.trim(), back: back.trim(), lang })
      .eq("id", item.card.id);
    if (!error) {
      onChanged(item.card.id, front.trim(), back.trim(), lang);
      setEditing(false);
    }
  }

  async function deleteCard() {
    if (!window.confirm("删除这张闪卡？")) return;
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
          className="w-full rounded-lg border border-zinc-300 px-3 py-2 text-sm focus:border-teal-500 focus:outline-none placeholder:text-sm"
        />
        <textarea
          value={back}
          onChange={(e) => setBack(e.target.value)}
          placeholder="背面（可换行加例句）"
          rows={2}
          className="w-full rounded-lg border border-zinc-300 px-3 py-2 text-sm focus:border-teal-500 focus:outline-none placeholder:text-sm"
        />
        <div className="flex items-center gap-2 text-sm">
          <label className="shrink-0 text-xs text-zinc-400">语言</label>
          <select
            value={lang}
            onChange={(e) => setLang(e.target.value as Lang)}
            className="rounded-lg border border-zinc-300 px-2.5 py-1.5 text-sm focus:border-teal-500 focus:outline-none"
          >
            {LANG_ORDER.map((l) => (
              <option key={l} value={l}>
                {LANG_LABEL[l]}
              </option>
            ))}
          </select>
        </div>
        <div className="flex gap-3 text-sm">
          <button onClick={saveEdit} className="text-teal-600 hover:text-teal-700">
            保存
          </button>
          <button
            onClick={() => {
              setFront(item.card.front);
              setBack(item.card.back ?? "");
              setLang(cardLang(item.card));
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
        <div className="mt-0.5 text-sm font-medium text-zinc-900">
          {flipped ? (
            <CardBack back={back ?? ""} />
          ) : (
            <CardFront text={front} reading={item.card.reading} />
          )}
        </div>
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
                  setLang(cardLang(item.card));
                  setEditing(true);
                }}
                className="block w-full px-3 py-2 text-left text-zinc-700 hover:bg-zinc-50"
              >
                编辑
              </button>
              <button
                onClick={() => {
                  setMenuOpen(false);
                  deleteCard();
                }}
                className="block w-full px-3 py-2 text-left text-red-600 hover:bg-red-50"
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
