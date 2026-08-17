"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Tag, Plus, Sparkles, ChevronDown, X } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import type { CardWithNote, WordTheme } from "@/lib/types";
import { detectLang, LANG_LABEL, LANG_COLOR, type Lang } from "@/lib/lang-detect";
import { classifyWord, themeMeta } from "@/lib/word-themes";

const LANG_ORDER: Lang[] = ["thai", "korean", "chinese", "japanese", "other"];

type Filter = Lang | "all";

type ThemeGroup = {
  key: string;
  label: string;
  emoji: string | null;
  isCustom: boolean;
  cards: CardWithNote[];
};

/**
 * 词群页主体：语言标签 + 按「单词本身的相关性（主题）」分组的生词。
 * - 每个主题一张卡片（名字 + 词数 + 背/测），点卡片展开该主题的词列表。
 * - 匹配不到任何主题的生词（"其他"）不显示。
 * - 支持新建自定义分类（名字 + 关键词，可用 AI 补关键词），命中即自动收录。
 */
export function GroupBrowser({
  cards,
  themes,
}: {
  cards: CardWithNote[];
  themes: WordTheme[];
}) {
  const [filter, setFilter] = useState<Filter>("all");
  const [expanded, setExpanded] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [userThemes, setUserThemes] = useState<WordTheme[]>(themes);

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

  // 按「单词相关性」分组（内置主题优先，再查用户分类），并隐藏「其他」。
  const groups = useMemo<ThemeGroup[]>(() => {
    const m = new Map<string, CardWithNote[]>();
    for (const c of visible) {
      const key = classifyWord(c.front, c.back ?? "", userThemes);
      if (key === "other") continue;
      if (!m.has(key)) m.set(key, []);
      m.get(key)!.push(c);
    }
    return Array.from(m.entries())
      .map(([key, groupCards]) => {
        const builtin = themeMeta(key);
        const custom = userThemes.find((t) => t.id === key);
        return {
          key,
          label: builtin?.label ?? custom?.name ?? key,
          emoji: builtin?.emoji ?? null,
          isCustom: !builtin,
          cards: groupCards,
        };
      })
      .sort((a, b) => b.cards.length - a.cards.length);
  }, [visible, userThemes]);

  const presentLangs = LANG_ORDER.filter((l) => (counts.get(l) ?? 0) > 0);
  const expandedGroup = groups.find((g) => g.key === expanded) ?? null;

  return (
    <div>
      {/* 语言标签 + 新建分类 */}
      <div className="mb-5 flex flex-wrap items-center gap-1.5">
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
        <button
          onClick={() => setCreating((v) => !v)}
          className="ml-auto inline-flex items-center gap-1 rounded-full border border-teal-200 px-3 py-1.5 text-sm font-medium text-teal-600 transition-colors hover:bg-teal-50"
        >
          <Plus className="h-4 w-4" />
          新建分类
        </button>
      </div>

      {creating && (
        <NewThemeForm
          onClose={() => setCreating(false)}
          onCreated={(t) => setUserThemes((prev) => [...prev, t])}
        />
      )}

      {/* 主题卡片网格 */}
      {groups.length === 0 ? (
        <div className="rounded-xl border border-dashed border-zinc-300 px-4 py-10 text-center text-sm text-zinc-500">
          这个语言下还没有能归类到主题的生词。
        </div>
      ) : (
        <ul className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {groups.map((g) => (
            <li key={g.key}>
              <div className="card-soft flex h-full flex-col p-4">
                <button
                  onClick={() => setExpanded(expanded === g.key ? null : g.key)}
                  className="flex flex-1 items-start gap-3 text-left"
                >
                  <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-teal-50 text-xl">
                    {g.emoji ?? <Tag className="h-5 w-5 text-teal-600" />}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-semibold text-zinc-800">
                      {g.label}
                    </span>
                    <span className="mt-0.5 block text-xs text-zinc-400">
                      {g.cards.length} 词
                    </span>
                  </span>
                  <ChevronDown
                    className={`h-4 w-4 shrink-0 text-zinc-400 transition-transform ${
                      expanded === g.key ? "rotate-180" : ""
                    }`}
                  />
                </button>
                <div className="mt-3 flex gap-2">
                  <Link
                    href={`/review?theme=${g.key}`}
                    className="flex-1 rounded-lg bg-teal-600 px-3 py-1.5 text-center text-sm font-semibold text-white transition-colors hover:bg-teal-700"
                  >
                    背
                  </Link>
                  <Link
                    href={`/review?theme=${g.key}&mode=test`}
                    className="flex-1 rounded-lg border border-teal-200 px-3 py-1.5 text-center text-sm font-semibold text-teal-600 transition-colors hover:bg-teal-50"
                  >
                    测
                  </Link>
                </div>
              </div>
            </li>
          ))}
        </ul>
      )}

      {/* 展开的词列表 */}
      {expandedGroup && (
        <section className="card-soft mt-6 p-4">
          <header className="mb-3 flex items-center justify-between gap-3">
            <h2 className="flex items-center gap-2 text-sm font-semibold text-zinc-800">
              {expandedGroup.emoji && <span className="text-xl">{expandedGroup.emoji}</span>}
              <span>{expandedGroup.label}</span>
              <span className="text-xs font-normal text-zinc-400">
                {expandedGroup.cards.length} 词
              </span>
            </h2>
            <button
              onClick={() => setExpanded(null)}
              className="inline-flex items-center gap-1 rounded-lg px-2 py-1 text-xs text-zinc-400 hover:bg-zinc-100 hover:text-zinc-700"
            >
              <X className="h-3.5 w-3.5" />
              收起
            </button>
          </header>
          <ul className="grid grid-cols-1 gap-2 sm:grid-cols-2">
            {expandedGroup.cards.map((c) => {
              const lang = detectLang(c.front);
              return (
                <li key={c.id}>
                  <Link
                    href={`/cards/${c.id}?from=/groups`}
                    className="flex items-center gap-3 rounded-xl border border-zinc-200 bg-white/80 px-3 py-2.5 transition-colors hover:border-teal-300"
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
      )}
    </div>
  );
}

/** 新建自定义分类：名字 + 关键词（可用 AI 补），创建后插入 word_themes。 */
function NewThemeForm({
  onClose,
  onCreated,
}: {
  onClose: () => void;
  onCreated: (t: WordTheme) => void;
}) {
  const router = useRouter();
  const [name, setName] = useState("");
  const [keywords, setKeywords] = useState("");
  const [busy, setBusy] = useState(false);
  const [aiBusy, setAiBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function aiFill() {
    const n = name.trim();
    if (!n) {
      setError("先填分类名，再让 AI 补关键词。");
      return;
    }
    setAiBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/ai/themes", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ name: n }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data?.error ?? "AI 调用失败");
        return;
      }
      const kw: string[] = data?.keywords ?? [];
      setKeywords((prev) => {
        const existing = prev.split(/[,，、;；\s]+/).filter(Boolean);
        const merged = Array.from(new Set([...existing, ...kw]));
        return merged.join("、");
      });
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setAiBusy(false);
    }
  }

  async function create() {
    const n = name.trim();
    const kw = keywords
      .split(/[,，、;；\s]+/)
      .map((k) => k.trim())
      .filter(Boolean);
    if (!n) {
      setError("请填分类名。");
      return;
    }
    setBusy(true);
    setError(null);
    const supabase = createClient();
    const { data, error } = await supabase
      .from("word_themes")
      .insert({ name: n, keywords: kw })
      .select()
      .single();
    setBusy(false);
    if (error || !data) {
      setError(error?.message ?? "创建失败");
      return;
    }
    onCreated(data as WordTheme);
    onClose();
    router.refresh();
  }

  return (
    <div className="card-soft mb-5 p-4">
      <div className="mb-3 flex items-center justify-between">
        <h3 className="text-sm font-semibold text-zinc-800">新建分类</h3>
        <button
          onClick={onClose}
          className="rounded-lg px-2 py-1 text-zinc-400 hover:bg-zinc-100 hover:text-zinc-700"
          aria-label="关闭"
        >
          <X className="h-4 w-4" />
        </button>
      </div>

      <input
        value={name}
        onChange={(e) => setName(e.target.value)}
        placeholder="分类名（例如：曼谷旅行）"
        className="w-full rounded-lg border border-zinc-200 px-3 py-2 text-sm font-medium text-zinc-800 focus:border-teal-500 focus:outline-none"
      />
      <div className="mt-3 flex items-start gap-2">
        <input
          value={keywords}
          onChange={(e) => setKeywords(e.target.value)}
          placeholder="关键词（用顿号/空格分隔，命中即自动收录）"
          className="w-full rounded-lg border border-zinc-200 px-3 py-2 text-sm text-zinc-700 focus:border-teal-500 focus:outline-none"
        />
        <button
          onClick={aiFill}
          disabled={aiBusy}
          className="inline-flex shrink-0 items-center gap-1 rounded-lg border border-teal-200 px-3 py-2 text-sm font-medium text-teal-600 transition-colors hover:bg-teal-50 disabled:opacity-60"
        >
          <Sparkles className="h-4 w-4" />
          {aiBusy ? "生成中…" : "AI 补关键词"}
        </button>
      </div>

      {error && <p className="mt-2 text-sm text-red-600">{error}</p>}

      <div className="mt-4 flex justify-end gap-2">
        <button
          onClick={onClose}
          className="rounded-lg border border-zinc-200 px-4 py-2 text-sm text-zinc-600 hover:bg-zinc-50"
        >
          取消
        </button>
        <button
          onClick={create}
          disabled={busy}
          className="rounded-lg bg-teal-600 px-4 py-2 text-sm font-semibold text-white hover:bg-teal-700 disabled:opacity-60"
        >
          {busy ? "创建中…" : "创建分类"}
        </button>
      </div>
    </div>
  );
}
