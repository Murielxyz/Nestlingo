"use client";

// 词群「某个主题」的列表页：专注「看词 + 管理」。
// 排版参考「闪卡合集」的卡片网格（两列、正反面直接展示、不翻面）；
// 词群特有：右上「收录词」一个主按钮，每张卡「发音 + 移出」，底部低调「删除分类」。
// 批量「选择 / 全选 / 删除分类」在词群主页（外层）做，这里不重复，保持清爽。

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Plus, Tag, Search } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import type { CardWithNote } from "@/lib/types";
import { detectLang, LANG_LABEL, LANG_COLOR } from "@/lib/lang-detect";
import { themeMeta } from "@/lib/word-themes";
import { CollectWordsModal } from "@/components/collect-words-modal";
import { SpeakButton } from "./speak-button";

export function ThemeDetail({
  themeKey,
  label,
  isCustom,
  cards,
  unclassified,
  hiddenThemes,
}: {
  themeKey: string;
  label: string;
  isCustom: boolean;
  cards: CardWithNote[];
  unclassified: CardWithNote[];
  hiddenThemes: string[];
}) {
  const router = useRouter();
  const [collecting, setCollecting] = useState(false);
  const [busy, setBusy] = useState(false);
  const [query, setQuery] = useState("");
  const Icon = themeMeta(themeKey)?.icon ?? Tag;

  // 搜索：按正面 / 背面文字过滤（不区分大小写）。
  const q = query.trim().toLowerCase();
  const visible = q
    ? cards.filter(
        (c) =>
          c.front.toLowerCase().includes(q) ||
          (c.back ?? "").toLowerCase().includes(q)
      )
    : cards;

  // 从主题里移出某个词 = 清掉它的 theme 标签（不删卡片）。
  async function remove(cardId: string) {
    const supabase = createClient();
    const { error } = await supabase
      .from("cards")
      .update({ theme: null })
      .eq("id", cardId);
    if (!error) router.refresh();
  }

  // 删除分类：自定义分类直接删行；内置主题改成「隐藏」，词回到未分类。
  async function deleteTheme() {
    const supabase = createClient();
    if (isCustom) {
      if (
        !window.confirm(
          `删除分类「${label}」？里面的词会回到「未分类」，不会被删除。`
        )
      ) {
        return;
      }
      setBusy(true);
      const { error } = await supabase.from("word_themes").delete().eq("id", themeKey);
      setBusy(false);
      if (error) return;
      router.push("/cards?view=theme");
      router.refresh();
      return;
    }

    if (
      !window.confirm(
        `删除分类「${label}」？它会在词群页里消失，里面的词回到「未分类」，词不会被删除。`
      )
    ) {
      return;
    }
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) return;
    setBusy(true);
    const next = Array.from(new Set([...hiddenThemes, themeKey]));
    const { error } = await supabase
      .from("user_settings")
      .upsert({ user_id: user.id, hidden_themes: next }, { onConflict: "user_id" });
    setBusy(false);
    if (!error) {
      router.push("/cards?view=theme");
      router.refresh();
    }
  }

  return (
    <div>
      <header className="mb-5 flex items-center gap-3">
        <Link
          href="/cards?view=theme"
          className="rounded-lg px-2 py-1 text-lg text-zinc-500 transition-colors hover:bg-zinc-100 hover:text-zinc-800"
          aria-label="返回"
        >
          ←
        </Link>
        <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-teal-50">
          <Icon className="h-5 w-5 text-teal-600" />
        </span>
        <h1 className="text-xl font-bold text-zinc-900">{label}</h1>
        <span className="text-xs text-zinc-400">{cards.length} 词</span>
        <button
          onClick={() => setCollecting(true)}
          className="ml-auto inline-flex items-center gap-1 rounded-lg bg-teal-600 px-3 py-1.5 text-sm font-semibold text-white transition-colors hover:bg-teal-700"
        >
          <Plus className="h-4 w-4" />
          收录词
        </button>
      </header>

      {/* 搜索 */}
      {cards.length > 0 && (
        <div className="relative mb-4">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-zinc-400" />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={`搜索「${label}」里的词 / 释义…`}
            className="w-full rounded-xl border border-zinc-200 bg-white py-2 pl-9 pr-3 text-sm focus:border-teal-500 focus:outline-none"
          />
        </div>
      )}

      {/* 词列表：卡片网格，正反面直接展示，不翻面 */}
      {cards.length === 0 ? (
        <div className="rounded-xl border border-dashed border-zinc-300 px-4 py-10 text-center text-sm text-zinc-500">
          这个分类还没有词，点右上角「收录词」把未归类的词收进来。
        </div>
      ) : visible.length === 0 ? (
        <div className="rounded-xl border border-dashed border-zinc-300 px-4 py-10 text-center text-sm text-zinc-500">
          没有匹配「{query.trim()}」的词。
        </div>
      ) : (
        <ul className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          {visible.map((c) => {
            const lang = detectLang(c.front);
            return (
              <li
                key={c.id}
                className="rounded-xl border border-zinc-200 bg-white p-4 transition-colors hover:border-teal-300"
              >
                <Link href={`/cards/${c.id}?from=/groups`} className="block">
                  <div className="flex items-start justify-between gap-2">
                    <p className="min-w-0 flex-1 whitespace-pre-wrap text-base font-medium text-zinc-900">
                      {c.front}
                    </p>
                    <span
                      className={`shrink-0 rounded-full px-2 py-0.5 text-[11px] font-medium ${
                        LANG_COLOR[lang]
                      }`}
                    >
                      {LANG_LABEL[lang]}
                    </span>
                  </div>
                  {c.back && (
                    <p className="mt-1 whitespace-pre-wrap text-sm text-zinc-500">
                      {c.back}
                    </p>
                  )}
                </Link>
                <div className="mt-3 flex items-center justify-between border-t border-zinc-100 pt-2">
                  <SpeakButton
                    text={c.front}
                    className="rounded-md px-1.5 py-0.5 text-sm leading-none text-zinc-400 transition-colors hover:bg-zinc-100 hover:text-zinc-700"
                  />
                  <button
                    onClick={() => remove(c.id)}
                    className="rounded-lg px-2 py-1 text-xs text-zinc-400 transition-colors hover:bg-red-50 hover:text-red-600"
                  >
                    移出
                  </button>
                </div>
              </li>
            );
          })}
        </ul>
      )}

      {/* 删除分类：低频危险操作，放底部低调处理 */}
      <div className="mt-6 flex justify-end border-t border-zinc-100 pt-3">
        <button
          onClick={deleteTheme}
          disabled={busy}
          className="text-xs text-zinc-400 transition-colors hover:text-red-600 disabled:opacity-60"
        >
          删除分类
        </button>
      </div>

      {collecting && (
        <CollectWordsModal
          themeKey={themeKey}
          themeLabel={label}
          unclassified={unclassified}
          onClose={() => setCollecting(false)}
          onDone={() => {
            setCollecting(false);
            router.refresh();
          }}
        />
      )}
    </div>
  );
}
