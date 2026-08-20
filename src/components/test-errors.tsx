"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Play, Trash2 } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { detectLang, LANG_LABEL, LANG_COLOR, type Lang } from "@/lib/lang-detect";
import type { ReviewItem } from "@/lib/supabase/queries";
import { ReviewSession } from "./review-session";
import { SpeakButton } from "./speak-button";

const LANG_ORDER: Lang[] = ["thai", "korean", "chinese", "japanese", "other"];

/**
 * 错题集：测试里选错的卡。按语言筛选（自动检测）、开始背、清空。
 */
export function TestErrors({ items }: { items: ReviewItem[] }) {
  const router = useRouter();
  const [lang, setLang] = useState<Lang | "all">("all");
  const [backing, setBacking] = useState(false);

  const presentLangs = (() => {
    const s = new Set<Lang>();
    for (const i of items) s.add(detectLang(i.card.front));
    return LANG_ORDER.filter((l) => s.has(l));
  })();

  const visible =
    lang === "all"
      ? items
      : items.filter((i) => detectLang(i.card.front) === lang);

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
              className={`rounded-full px-3 py-1 text-xs font-medium transition-colors ${
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
                className={`rounded-full px-3 py-1 text-xs font-medium transition-colors ${
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

        <div className="ml-auto flex gap-2">
          <button
            onClick={() => setBacking(true)}
            disabled={visible.length === 0}
            className="btn-brand disabled:opacity-60"
          >
            <Play className="h-4 w-4" />
            开始背（{visible.length}）
          </button>
          <button
            onClick={clearAll}
            className="inline-flex items-center gap-1.5 rounded-xl border border-zinc-200 px-4 py-2 text-sm text-zinc-600 transition-colors hover:bg-zinc-50"
          >
            <Trash2 className="h-4 w-4" />
            清空
          </button>
        </div>
      </div>

      {visible.length === 0 ? (
        <div className="rounded-xl border border-dashed border-zinc-300 px-4 py-10 text-center text-sm text-zinc-500">
          {lang === "all" ? "没有错题。" : "这个语言下没有错题。"}
        </div>
      ) : (
        <ul className="space-y-2">
          {visible.map((w) => (
            <li
              key={w.card.id}
              className="card-soft flex items-center gap-3 px-4 py-2.5"
            >
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium text-zinc-900">
                  {w.card.front}
                </p>
                <p className="truncate text-xs text-zinc-500">{w.card.back || ""}</p>
              </div>
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
      )}
    </div>
  );
}
