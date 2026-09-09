"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Play, Trash2, FlaskConical } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { cardLang, LANG_ORDER, LANG_LABEL, LANG_COLOR, type Lang } from "@/lib/lang-detect";
import type { ReviewItem } from "@/lib/supabase/queries";
import { ReviewSession } from "./review-session";
import { TestSession } from "./test-session";
import { CardTile } from "./card-tile";

/**
 * 错题集：测试里选错的卡。按语言筛选（自动检测）、开始背、清空。
 */
export function TestErrors({ items }: { items: ReviewItem[] }) {
  const router = useRouter();
  const [lang, setLang] = useState<Lang | "all">("all");
  const [backing, setBacking] = useState(false);
  const [testing, setTesting] = useState(false);

  const presentLangs = (() => {
    const s = new Set<Lang>();
    for (const i of items) s.add(cardLang(i.card));
    return LANG_ORDER.filter((l) => s.has(l));
  })();

  const visible =
    lang === "all"
      ? items
      : items.filter((i) => cardLang(i.card) === lang);

  async function clearAll() {
    if (!window.confirm(`清空全部 ${items.length} 张错题卡？`)) return;
    const supabase = createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (user) {
      await supabase.from("test_errors").delete().eq("user_id", user.id);
    }
    router.refresh();
  }

  /** 单张卡「移出错题集」（不删卡片本身，只从错题表移除）。 */
  async function removeFromErrors(cardId: string) {
    if (!window.confirm("把这张卡移出错题集？")) return;
    const supabase = createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (user) {
      await supabase.from("test_errors").delete().eq("user_id", user.id).eq("card_id", cardId);
    }
    router.refresh();
  }

  /** 测试练习里答对的卡：直接从错题表移除（测对通过就不该再显示在错题集）。 */
  async function passFromErrors(cardId: string) {
    const supabase = createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (user) {
      await supabase.from("test_errors").delete().eq("user_id", user.id).eq("card_id", cardId);
    }
  }

  if (testing) {
    return (
      <div>
        <button
          onClick={() => {
            setTesting(false);
            router.refresh();
          }}
          className="mb-4 inline-flex items-center gap-1 text-sm text-teal-600 transition-colors hover:text-teal-700"
        >
          ← 返回错题列表
        </button>
        <TestSession
          cards={visible.map((w) => w.card)}
          title="错题测试"
          backHref="/review?scope=errors"
          onCorrect={passFromErrors}
        />
      </div>
    );
  }

  if (backing) {
    return (
      <div>
        <button
          onClick={() => setBacking(false)}
          className="mb-4 inline-flex items-center gap-1 text-sm text-teal-600 transition-colors hover:text-teal-700"
        >
          ← 返回错题列表
        </button>
        <ReviewSession items={visible} dailyGoal={visible.length} />
      </div>
    );
  }

  return (
    <div>
      {/* 语言筛选 + 操作 */}
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        {presentLangs.length > 1 && (
          <div className="flex flex-wrap gap-1.5">
            <button
              onClick={() => setLang("all")}
              className={`rounded-full px-3 py-2 text-sm font-medium transition-colors ${
                lang === "all"
                  ? "bg-zinc-800 text-white"
                  : "border border-zinc-200 text-zinc-500 hover:bg-zinc-50"
              }`}
            >
              全部语言
            </button>
            {presentLangs.map((l) => (
              <button
                key={l}
                onClick={() => setLang(l)}
                className={`rounded-full px-3 py-2 text-sm font-medium transition-colors ${
                  lang === l
                    ? "bg-zinc-800 text-white"
                    : `${LANG_COLOR[l]} border border-transparent hover:opacity-80`
                }`}
              >
                {LANG_LABEL[l]}
              </button>
            ))}
          </div>
        )}

        <div className="flex w-full flex-col gap-2 sm:ml-auto sm:w-auto sm:flex-row sm:items-center">
          <button
            onClick={() => setBacking(true)}
            disabled={visible.length === 0}
            className="btn-brand w-full disabled:opacity-60 sm:w-auto"
          >
            <Play className="h-4 w-4" />
            开始背（{visible.length}）
          </button>
          <div className="flex w-full gap-2 sm:w-auto">
            <button
              onClick={() => setTesting(true)}
              disabled={visible.length === 0}
              className="inline-flex flex-1 items-center justify-center gap-1.5 rounded-xl border border-zinc-200 px-4 py-2.5 text-sm text-zinc-600 transition-colors hover:bg-zinc-50 disabled:opacity-60 sm:flex-none"
            >
              <FlaskConical className="h-4 w-4" />
              测试练习
            </button>
            <button
              onClick={clearAll}
              className="inline-flex flex-1 items-center justify-center gap-1.5 rounded-xl border border-zinc-200 px-4 py-2.5 text-sm text-zinc-600 transition-colors hover:bg-zinc-50 sm:flex-none"
            >
              <Trash2 className="h-4 w-4" />
              清空
            </button>
          </div>
        </div>
      </div>

      {visible.length === 0 ? (
        <div className="rounded-xl border border-dashed border-zinc-300 px-4 py-10 text-center text-sm text-zinc-500">
          {lang === "all" ? "没有错题。" : "这个语言下没有错题。"}
        </div>
      ) : (
        <ul className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          {visible.map((w) => (
            <li key={w.card.id}>
              <CardTile
                card={w.card}
                deleteLabel="移出"
                onDelete={() => void removeFromErrors(w.card.id)}
              />
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
