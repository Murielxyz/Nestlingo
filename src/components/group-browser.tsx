"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import type { CardWithNote } from "@/lib/types";
import { detectLang, LANG_LABEL, LANG_COLOR, type Lang } from "@/lib/lang-detect";
import {
  classifyWord,
  themeMeta,
  OTHER_THEME,
  type Theme,
} from "@/lib/word-themes";

const LANG_ORDER: Lang[] = ["thai", "korean", "chinese", "japanese", "other"];

type Filter = Lang | "all";

function themeOf(key: string): Theme {
  return themeMeta(key) ?? OTHER_THEME;
}

/**
 * 词群页主体：语言标签 + 按「单词本身的相关性（主题）」分组的生词。
 * 语言靠正面文字自动识别（泰语/韩语/中文/日语）；组 = 主题（美容/游戏/运动…），
 * 跟来源笔记无关。每个主题可直接「背 / 测」该主题下的生词。
 */
export function GroupBrowser({ cards }: { cards: CardWithNote[] }) {
  const [filter, setFilter] = useState<Filter>("all");

  const counts = useMemo(() => {
    const m = new Map<Lang, number>();
    for (const c of cards) {
      const l = detectLang(c.front);
      m.set(l, (m.get(l) ?? 0) + 1);
    }
    return m;
  }, [cards]);

  const visible =
    filter === "all" ? cards : cards.filter((c) => detectLang(c.front) === filter);

  // 按「单词相关性」分组（主题分类，不是来源笔记）
  const groups = useMemo(() => {
    const m = new Map<string, CardWithNote[]>();
    for (const c of visible) {
      const key = classifyWord(c.front, c.back ?? "");
      if (!m.has(key)) m.set(key, []);
      m.get(key)!.push(c);
    }
    return Array.from(m.entries()).sort((a, b) => b[1].length - a[1].length);
  }, [visible]);

  const presentLangs = LANG_ORDER.filter((l) => (counts.get(l) ?? 0) > 0);

  return (
    <div>
      {/* 语言标签 */}
      <div className="mb-5 flex flex-wrap gap-1.5">
        <button
          onClick={() => setFilter("all")}
          className={`rounded-full px-3.5 py-1.5 text-sm transition-colors ${
            filter === "all"
              ? "bg-teal-600 font-semibold text-white"
              : "border border-zinc-200 text-zinc-600 hover:bg-zinc-50"
          }`}
        >
          全部 {cards.length}
        </button>
        {presentLangs.map((l) => (
          <button
            key={l}
            onClick={() => setFilter(l)}
            className={`rounded-full px-3.5 py-1.5 text-sm transition-colors ${
              filter === l
                ? "bg-teal-600 font-semibold text-white"
                : "border border-zinc-200 text-zinc-600 hover:bg-zinc-50"
            }`}
          >
            {LANG_LABEL[l]} {counts.get(l)}
          </button>
        ))}
      </div>

      {groups.length === 0 ? (
        <div className="rounded-xl border border-dashed border-zinc-300 px-4 py-10 text-center text-sm text-zinc-500">
          这个语言下还没有生词。
        </div>
      ) : (
        groups.map(([key, groupCards]) => {
          const theme = themeOf(key);
          return (
            <section key={key} className="mb-6">
              <header className="mb-2 flex items-center justify-between gap-3">
                <h2 className="flex items-center gap-2 text-sm font-semibold text-zinc-700">
                  <span>{theme.emoji}</span>
                  <span>{theme.label}</span>
                  <span className="text-xs font-normal text-zinc-400">
                    {groupCards.length} 词
                  </span>
                </h2>
                <div className="flex shrink-0 gap-2 text-xs">
                  <Link
                    href={`/review?theme=${key}`}
                    className="rounded-md bg-teal-600 px-2.5 py-1 font-semibold text-white transition-colors hover:bg-teal-700"
                  >
                    背
                  </Link>
                  <Link
                    href={`/review?theme=${key}&mode=test`}
                    className="rounded-md border border-teal-200 px-2.5 py-1 font-semibold text-teal-600 transition-colors hover:bg-teal-50"
                  >
                    测
                  </Link>
                </div>
              </header>

              <ul className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                {groupCards.map((c) => {
                  const lang = detectLang(c.front);
                  return (
                    <li key={c.id}>
                      <Link
                        href={`/cards/${c.id}?from=/groups`}
                        className="flex items-center gap-3 rounded-xl border border-zinc-200 bg-white px-3 py-2.5 transition-colors hover:border-teal-300"
                      >
                        <span className="min-w-0 flex-1 truncate text-sm font-medium text-zinc-900">
                          {c.front}
                        </span>
                        <span className="min-w-0 flex-1 truncate text-xs text-zinc-500">
                          {c.back || ""}
                        </span>
                        <span
                          className={`shrink-0 rounded-full px-2 py-0.5 text-[11px] font-medium ${
                            LANG_COLOR[lang]
                          }`}
                        >
                          {LANG_LABEL[lang]}
                        </span>
                      </Link>
                    </li>
                  );
                })}
              </ul>
            </section>
          );
        })
      )}
    </div>
  );
}
