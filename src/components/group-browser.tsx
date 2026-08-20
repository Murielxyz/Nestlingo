"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Tag, Plus, Sparkles, X, Trash2, Check } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import type { CardWithNote, WordTheme } from "@/lib/types";
import { detectLang, LANG_LABEL, type Lang } from "@/lib/lang-detect";
import { themeMeta, themeOf } from "@/lib/word-themes";

const LANG_ORDER: Lang[] = ["thai", "korean", "chinese", "japanese", "other"];

/** 用户隐藏（删除）的主题 key 视作「未归类」，不再参与分组。 */
function themeOfVisible(
  card: CardWithNote,
  userThemes: WordTheme[],
  hiddenThemes: string[]
): string {
  const k = themeOf(card, userThemes);
  return hiddenThemes.includes(k) ? "other" : k;
}

type Filter = Lang | "all";

type ThemeGroup = {
  key: string;
  label: string;
  icon: LucideIcon | null;
  isCustom: boolean;
  cards: CardWithNote[];
};

/**
 * 词群页主体：语言标签 + 按「单词本身的相关性（主题）」分组的生词。
 * - 每个主题一张卡片（名字 + 词数 + 背/测），整卡可点 → 进入 /groups/[key] 列表页。
 * - 匹配不到任何主题的生词（"其他"）不显示。
 * - 支持新建自定义分类（名字 + 关键词，可用 AI 补关键词），命中即自动收录。
 * - 「批量操作」勾选多张卡片 → 批量删除/隐藏分类。
 */
export function GroupBrowser({
  cards,
  themes,
  hiddenThemes = [],
}: {
  cards: CardWithNote[];
  themes: WordTheme[];
  hiddenThemes?: string[];
}) {
  const router = useRouter();
  const [filter, setFilter] = useState<Filter>("all");
  const [creating, setCreating] = useState(false);
  const [userThemes, setUserThemes] = useState<WordTheme[]>(themes);
  const [hidden, setHidden] = useState<string[]>(hiddenThemes);
  const [clustering, setClustering] = useState(false);
  const [clusterError, setClusterError] = useState<string | null>(null);
  const [batchMode, setBatchMode] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());

  // 各语言标签的数字 = 能归类到某个主题（场景）的生词数，而不是全部生词；
  // 归类不到的（"其他"）不计入，跟下方主题卡片一致。
  const counts = useMemo(() => {
    const m = new Map<Lang, number>();
    for (const c of cards) {
      if (themeOfVisible(c, userThemes, hidden) === "other") continue;
      const l = detectLang(c.front);
      m.set(l, (m.get(l) ?? 0) + 1);
    }
    return m;
  }, [cards, userThemes, hidden]);

  const totalClassified = useMemo(
    () => Array.from(counts.values()).reduce((a, b) => a + b, 0),
    [counts]
  );

  const visible =
    filter === "all" ? cards : cards.filter((c) => detectLang(c.front) === filter);

  // 按「单词相关性」分组（内置主题优先，再查用户分类），并隐藏「其他」。
  const groups = useMemo<ThemeGroup[]>(() => {
    const m = new Map<string, CardWithNote[]>();
    for (const c of visible) {
      const key = themeOfVisible(c, userThemes, hidden);
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
          icon: builtin?.icon ?? null,
          isCustom: !builtin,
          cards: groupCards,
        };
      })
      .sort((a, b) => b.cards.length - a.cards.length);
  }, [visible, userThemes, hidden]);

  const presentLangs = LANG_ORDER.filter((l) => (counts.get(l) ?? 0) > 0);
  const allSelected = groups.length > 0 && groups.every((g) => selected.has(g.key));

  async function runCluster() {
    setClustering(true);
    setClusterError(null);
    try {
      const res = await fetch("/api/ai/cluster-cards", { method: "POST" });
      const data = await res.json();
      if (!res.ok) {
        setClusterError(data?.error ?? "AI 整理失败，请稍后重试。");
        return;
      }
      router.refresh();
    } catch (e) {
      setClusterError(e instanceof Error ? e.message : String(e));
    } finally {
      setClustering(false);
    }
  }

  function toggleSelect(key: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }

  function toggleSelectAll() {
    setSelected(allSelected ? new Set() : new Set(groups.map((g) => g.key)));
  }

  function toggleBatch() {
    setBatchMode((v) => {
      if (v) setSelected(new Set());
      return !v;
    });
  }

  // 批量删除分类：自定义删行，内置主题（含 AI 整理的）改成「隐藏」。
  async function batchDelete() {
    if (selected.size === 0) return;
    const keys = Array.from(selected);
    if (
      !window.confirm(
        `删除所选 ${keys.length} 个分类？里面的词会回到「未分类」，词不会被删除。`
      )
    ) {
      return;
    }
    const supabase = createClient();
    const customKeys = keys.filter((k) => userThemes.some((t) => t.id === k));
    const builtinKeys = keys.filter((k) => themeMeta(k) !== null);

    if (customKeys.length > 0) {
      const { error } = await supabase
        .from("word_themes")
        .delete()
        .in("id", customKeys);
      if (!error) {
        setUserThemes((prev) => prev.filter((t) => !customKeys.includes(t.id)));
      }
    }
    if (builtinKeys.length > 0) {
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (user) {
        const next = Array.from(new Set([...hidden, ...builtinKeys]));
        setHidden(next);
        await supabase
          .from("user_settings")
          .upsert({ user_id: user.id, hidden_themes: next }, { onConflict: "user_id" });
      }
    }
    setSelected(new Set());
    setBatchMode(false);
    router.refresh();
  }

  return (
    <div>
      {/* AI 智能整理 */}
      {!batchMode && (
        <div className="mb-4 flex flex-wrap items-center gap-2">
          <button
            onClick={runCluster}
            disabled={clustering}
            className="inline-flex items-center gap-1.5 rounded-full bg-teal-600 px-4 py-1.5 text-sm font-semibold text-white transition-colors hover:bg-teal-700 disabled:opacity-60"
          >
            <Sparkles className="h-4 w-4" />
            {clustering ? "AI 整理中…" : "AI 智能整理"}
          </button>
        </div>
      )}
      {clusterError && (
        <p className="mb-3 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800">
          {clusterError}
        </p>
      )}

      {/* 语言标签 + 批量操作 / 新建分类 */}
      <div className="mb-5 flex flex-wrap items-center gap-1.5">
        <button
          onClick={() => setFilter("all")}
          className={`rounded-full px-3.5 py-1.5 text-sm transition-colors ${
            filter === "all"
              ? "bg-teal-600 font-semibold text-white"
              : "border border-zinc-200 text-zinc-600 hover:bg-zinc-50"
          }`}
        >
          全部 {totalClassified}
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
        <div className="ml-auto flex items-center gap-1.5">
          <button
            onClick={toggleBatch}
            className={`rounded-full px-3.5 py-1.5 text-sm transition-colors ${
              batchMode
                ? "bg-teal-600 font-semibold text-white"
                : "border border-zinc-200 text-zinc-600 hover:bg-zinc-50"
            }`}
          >
            {batchMode ? "完成" : "批量操作"}
          </button>
          {!batchMode && (
            <button
              onClick={() => setCreating((v) => !v)}
              className="inline-flex items-center gap-1 rounded-full border border-teal-200 px-3 py-1.5 text-sm font-medium text-teal-600 transition-colors hover:bg-teal-50"
            >
              <Plus className="h-4 w-4" />
              新建分类
            </button>
          )}
        </div>
      </div>

      {cards.length - totalClassified > 0 && (
        <p className="-mt-3 mb-4 text-xs text-zinc-400">
          还有 {cards.length - totalClassified} 个词没归类到任何主题。
        </p>
      )}

      {creating && !batchMode && (
        <NewThemeForm
          onClose={() => setCreating(false)}
          onCreated={(t) => setUserThemes((prev) => [...prev, t])}
        />
      )}

      {/* 批量操作栏 */}
      {batchMode && (
        <div className="mb-4 flex items-center justify-between rounded-xl border border-zinc-200 bg-white px-4 py-2.5 shadow-sm">
          <div className="flex items-center gap-3">
            <button
              onClick={toggleSelectAll}
              className="text-sm font-medium text-teal-600 transition-colors hover:underline"
            >
              {allSelected ? "取消全选" : "全选"}
            </button>
            <span className="text-sm text-zinc-500">已选 {selected.size} 个分类</span>
          </div>
          <button
            onClick={batchDelete}
            disabled={selected.size === 0}
            className="inline-flex items-center gap-1 rounded-lg border border-red-200 px-3 py-1.5 text-sm font-medium text-red-600 transition-colors hover:bg-red-50 disabled:opacity-50"
          >
            <Trash2 className="h-4 w-4" />
            删除所选
          </button>
        </div>
      )}

      {/* 主题卡片网格 */}
      {groups.length === 0 ? (
        <div className="rounded-xl border border-dashed border-zinc-300 px-4 py-10 text-center text-sm text-zinc-500">
          这个语言下还没有能归类到主题的生词。
        </div>
      ) : (
        <ul className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {groups.map((g) => {
            const body = (
              <div className="flex items-start gap-3">
                <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-teal-50">
                  {(() => {
                    const Icon = g.icon ?? Tag;
                    return <Icon className="h-5 w-5 text-teal-600" />;
                  })()}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-semibold text-zinc-800">
                    {g.label}
                  </span>
                  <span className="mt-0.5 block text-xs text-zinc-400">
                    {g.cards.length} 词
                  </span>
                </span>
              </div>
            );
            return (
              <li key={g.key}>
                <div className="card-soft flex h-full flex-col overflow-hidden">
                  {batchMode ? (
                    <button
                      type="button"
                      onClick={() => toggleSelect(g.key)}
                      className="relative flex flex-1 flex-col p-4 text-left"
                    >
                      {body}
                      <span
                        className={`absolute right-3 top-3 flex h-5 w-5 items-center justify-center rounded-full border transition-colors ${
                          selected.has(g.key)
                            ? "border-teal-600 bg-teal-600 text-white"
                            : "border-zinc-300 bg-white text-transparent"
                        }`}
                      >
                        <Check className="h-3.5 w-3.5" />
                      </span>
                    </button>
                  ) : (
                    <Link
                      href={`/groups/${g.key}`}
                      className="flex flex-1 flex-col p-4 transition-colors hover:bg-teal-50/40"
                    >
                      {body}
                    </Link>
                  )}
                  {!batchMode && (
                    <div className="flex gap-2 border-t border-zinc-100 p-2">
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
                  )}
                </div>
              </li>
            );
          })}
        </ul>
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
