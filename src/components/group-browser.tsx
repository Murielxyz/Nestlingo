"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Tag, Plus, Sparkles, X, Trash2, Check, Search, MoreHorizontal, Download } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { exportCardsCsv } from "@/lib/export-data";
import type { CardWithNote, WordTheme } from "@/lib/types";
import { cardLang, LANG_ORDER, LANG_LABEL, LANG_COLOR, type Lang } from "@/lib/lang-detect";
import { themeMeta, themeOf } from "@/lib/word-themes";
import { listImportableCollections, type ImportableCollection } from "@/lib/import-collections";

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
  const [query, setQuery] = useState("");

  // 各语言标签的数字 = 能归类到某个主题（场景）的生词数，而不是全部生词；
  // 归类不到的（"其他"）不计入，跟下方主题卡片一致。
  const counts = useMemo(() => {
    const m = new Map<Lang, number>();
    for (const c of cards) {
      if (themeOfVisible(c, userThemes, hidden) === "other") continue;
      const l = cardLang(c);
      m.set(l, (m.get(l) ?? 0) + 1);
    }
    return m;
  }, [cards, userThemes, hidden]);

  const totalClassified = useMemo(
    () => Array.from(counts.values()).reduce((a, b) => a + b, 0),
    [counts]
  );

  const visible =
    filter === "all" ? cards : cards.filter((c) => cardLang(c) === filter);

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

  // 搜索：按主题名 / 卡面文字过滤（命中主题名→保留整组；否则看卡里文字）。
  const q = query.trim().toLowerCase();
  const searchedGroups = useMemo<ThemeGroup[]>(() => {
    if (!q) return groups;
    return groups
      .map((g) => {
        if (g.label.toLowerCase().includes(q)) return g;
        const matched = g.cards.filter(
          (c) =>
            c.front.toLowerCase().includes(q) ||
            (c.back ?? "").toLowerCase().includes(q)
        );
        return matched.length ? { ...g, cards: matched } : null;
      })
      .filter(Boolean) as ThemeGroup[];
  }, [groups, q]);

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
      // 先清掉这些分类下卡片的 theme 标记：删了分类后这些卡才不会冒出「裸UUID」鬼分组。
      await supabase.from("cards").update({ theme: null }).in("theme", customKeys);
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

  // 单个主题卡片的「删除」：自定义分类删行并清卡片 theme；内置主题改成「隐藏」。
  async function deleteTheme(key: string, isCustom: boolean, label: string) {
    const supabase = createClient();
    if (isCustom) {
      if (
        !window.confirm(`删除分类「${label}」？里面的词会回到「未分类」，不会被删除。`)
      ) {
        return;
      }
      await supabase.from("cards").update({ theme: null }).eq("theme", key);
      const { error } = await supabase.from("word_themes").delete().eq("id", key);
      if (!error) {
        setUserThemes((prev) => prev.filter((t) => t.id !== key));
      }
    } else {
      if (
        !window.confirm(
          `删除分类「${label}」？它会在闪卡页里消失，里面的词回到「未分类」，词不会被删除。`
        )
      ) {
        return;
      }
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (user) {
        const next = Array.from(new Set([...hidden, key]));
        setHidden(next);
        await supabase
          .from("user_settings")
          .upsert({ user_id: user.id, hidden_themes: next }, { onConflict: "user_id" });
      }
    }
    router.refresh();
  }

  return (
    <div>
      {clusterError && (
        <p className="mb-3 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800">
          {clusterError}
        </p>
      )}

      {/* 搜索 + 操作按钮：手机端上下堆叠，桌面端同一行（搜索左、按钮右）；语言标签另起一行 */}
      <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="relative w-full sm:max-w-md">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-zinc-400" />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="搜索主题 / 词…"
            className="w-full rounded-xl border border-zinc-200 bg-white py-2 pl-9 pr-3 text-sm focus:border-teal-500 focus:outline-none"
          />
        </div>
        {/* 次级工具栏：AI 智能整理 / 批量操作（默认样式）+ 新建分类（绿色主按钮，最右）——与按来源一致 */}
        {!batchMode && (
          <div className="flex flex-wrap items-center gap-1.5">
            <button
              onClick={runCluster}
              disabled={clustering}
              className="inline-flex items-center gap-1.5 rounded-lg border border-zinc-200 px-3 py-2 text-sm font-medium text-zinc-600 transition-colors hover:bg-zinc-50 disabled:opacity-60"
            >
              <Sparkles className="h-4 w-4" />
              {clustering ? "AI 整理中…" : "AI 智能整理"}
            </button>
            <button
              onClick={() => setCreating((v) => !v)}
              className="inline-flex items-center gap-1 rounded-lg bg-teal-600 px-3.5 py-2 text-sm font-semibold text-white transition-colors hover:bg-teal-700"
            >
              <Plus className="h-4 w-4" />
              新建分类
            </button>
          </div>
        )}
      </div>

      {/* 语言标签（与按来源一致：非活跃按各自语言色显示、选中态 teal 白字） */}
      <div className="mb-5 flex flex-wrap items-center gap-2">
        <button
          onClick={() => setFilter("all")}
          className={`rounded-full px-3 py-1 text-xs font-medium transition-colors ${
            filter === "all"
              ? "bg-teal-600 text-white"
              : "border border-zinc-200 text-zinc-500 hover:bg-zinc-50"
          }`}
        >
          全部语言
        </button>
        {presentLangs.map((l) => (
          <button
            key={l}
            onClick={() => setFilter(l)}
            className={`rounded-full px-3 py-1 text-xs font-medium transition-colors ${
              filter === l
                ? "bg-teal-600 text-white"
                : `${LANG_COLOR[l]} border border-transparent hover:opacity-80`
            }`}
          >
            {LANG_LABEL[l]}
          </button>
        ))}
        <button
          onClick={toggleBatch}
          className={`ml-auto text-xs font-medium transition-colors ${
            batchMode ? "text-teal-600" : "text-zinc-400 hover:text-teal-600"
          }`}
        >
          {batchMode ? "退出批量" : "批量操作"}
        </button>
      </div>

      {cards.length - totalClassified > 0 && (
        <p className="-mt-3 mb-4 text-xs text-zinc-400">
          还有 {cards.length - totalClassified} 条没归类到任何主题。
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
          <div className="flex items-center gap-2">
            <button
              onClick={batchDelete}
              disabled={selected.size === 0}
              className="inline-flex items-center gap-1 rounded-lg border border-red-200 px-3 py-1.5 text-sm font-medium text-red-600 transition-colors hover:bg-red-50 disabled:opacity-50"
            >
              <Trash2 className="h-4 w-4" />
              删除所选
            </button>
            <button
              onClick={toggleBatch}
              className="rounded-lg px-3 py-1.5 text-sm text-zinc-500 transition-colors hover:bg-zinc-100"
            >
              完成
            </button>
          </div>
        </div>
      )}

      {/* 主题卡片网格 */}
      {searchedGroups.length === 0 ? (
        <div className="rounded-xl border border-dashed border-zinc-300 px-4 py-10 text-center text-sm text-zinc-500">
          {q ? "没有匹配的主题或词。" : "这个语言下还没有能归类到主题的生词。"}
        </div>
      ) : (
        <ul className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {searchedGroups.map((g) => {
            const body = (
              <div className="flex items-center gap-2.5">
                <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-teal-50">
                  {(() => {
                    const Icon = g.icon ?? Tag;
                    return <Icon className="h-4 w-4 text-teal-600" />;
                  })()}
                </span>
                <span className="min-w-0 flex-1 truncate text-sm font-medium leading-snug text-zinc-800">
                  {g.label}
                </span>
                <span className="shrink-0 rounded-full bg-teal-50 px-2 py-0.5 text-xs font-medium text-teal-600">
                  {g.cards.length} 条
                </span>
              </div>
            );
            return (
              <li key={g.key}>
                <div className="flex h-full flex-col rounded-2xl border border-zinc-200 bg-white transition-colors hover:border-teal-300 hover:shadow-sm">
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
                      href={`/groups/${g.key}${filter !== "all" ? `?lang=${filter}` : ""}`}
                      className="flex flex-1 flex-col p-4"
                    >
                      {body}
                    </Link>
                  )}
                  {!batchMode && (
                    <div className="flex items-center justify-between border-t border-zinc-100 px-3 py-1.5">
                      <ThemeCardMenu onDelete={() => deleteTheme(g.key, g.isCustom, g.label)} />
                      <ThemeExportButton cards={g.cards} label={g.label} />
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

/** 导出某个主题下的全部生词为 CSV。 */
function ThemeExportButton({ cards, label }: { cards: CardWithNote[]; label: string }) {
  const [busy, setBusy] = useState(false);

  function exportOne() {
    setBusy(true);
    try {
      exportCardsCsv(cards, `${label}.csv`);
    } finally {
      setBusy(false);
    }
  }

  return (
    <button
      onClick={exportOne}
      disabled={busy}
      className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-xs text-zinc-500 transition-colors hover:bg-zinc-100 hover:text-zinc-800 disabled:opacity-60"
    >
      <Download className="h-3.5 w-3.5" />
      {busy ? "导出中…" : "导出"}
    </button>
  );
}

/** 主题卡片的「⋯」菜单：删除分类（内置主题→隐藏、自定义分类→删除，统一「删除」措辞）。 */
function ThemeCardMenu({ onDelete }: { onDelete: () => void }) {
  const [open, setOpen] = useState(false);

  return (
    <div className="relative">
      <button
        onClick={() => setOpen((v) => !v)}
        className="rounded-md p-1.5 text-zinc-400 transition-colors hover:bg-zinc-100 hover:text-zinc-700"
        aria-label="更多操作"
      >
        <MoreHorizontal className="h-4 w-4" />
      </button>
      {open && (
        <>
          <button
            className="fixed inset-0 z-10 cursor-default"
            onClick={() => setOpen(false)}
            aria-label="关闭菜单"
          />
          <div className="absolute bottom-full left-0 z-20 mb-1 w-32 overflow-hidden rounded-lg border border-zinc-200 bg-white py-1 shadow-lg">
            <button
              onClick={() => {
                setOpen(false);
                onDelete();
              }}
              className="flex w-full items-center gap-2 px-3 py-1.5 text-sm text-red-600 hover:bg-red-50"
            >
              <Trash2 className="h-3.5 w-3.5" />
              删除分类
            </button>
          </div>
        </>
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
  // 「从合集导入」（可选）：新建分类时顺手把某篇笔记的生词+例句一起收进来。
  const [importOpen, setImportOpen] = useState(false);
  const [collections, setCollections] = useState<ImportableCollection[]>([]);
  const [colLoading, setColLoading] = useState(false);
  const [colQuery, setColQuery] = useState("");
  const [selectedNoteIds, setSelectedNoteIds] = useState<Set<string>>(new Set());

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

  async function loadCollections() {
    setColLoading(true);
    try {
      const list = await listImportableCollections();
      setCollections(list);
    } catch {
      setCollections([]);
    } finally {
      setColLoading(false);
    }
  }

  function toggleCollection(noteId: string) {
    setSelectedNoteIds((prev) => {
      const next = new Set(prev);
      if (next.has(noteId)) next.delete(noteId);
      else next.add(noteId);
      return next;
    });
  }

  const filteredCollections = useMemo(() => {
    const q = colQuery.trim().toLowerCase();
    if (!q) return collections;
    return collections.filter(
      (col) =>
        col.title.toLowerCase().includes(q) ||
        col.cards.some((c) => c.front.toLowerCase().includes(q))
    );
  }, [collections, colQuery]);

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
    if (error || !data) {
      setBusy(false);
      setError(error?.message ?? "创建失败");
      return;
    }
    const newTheme = data as WordTheme;
    // 顺手把所选合集的 生词+例句 一起收进这个新分类。
    if (selectedNoteIds.size > 0) {
      const ids = collections
        .filter((c) => selectedNoteIds.has(c.noteId))
        .flatMap((c) => c.cards.map((card) => card.id));
      if (ids.length > 0) {
        await supabase.from("cards").update({ theme: newTheme.id }).in("id", ids);
      }
    }
    setBusy(false);
    onCreated(newTheme);
    onClose();
    router.refresh();
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
      onClick={onClose}
    >
      <div
        className="max-h-[85vh] w-full max-w-lg overflow-y-auto rounded-2xl bg-white p-5 shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-3 flex items-center justify-between">
          <h3 className="text-base font-semibold text-zinc-900">新建分类</h3>
          <button
            onClick={onClose}
            className="rounded-lg p-1 text-zinc-400 hover:bg-zinc-100 hover:text-zinc-700"
            aria-label="关闭"
          >
            <X className="h-5 w-5" />
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

      {/* 可选：从合集导入——new分类时把某篇笔记的生词+例句一起收进来 */}
      <div className="mt-3">
        <button
          type="button"
          onClick={() => {
            const next = !importOpen;
            setImportOpen(next);
            if (next && collections.length === 0) void loadCollections();
          }}
          className="text-xs font-medium text-zinc-500 transition-colors hover:text-teal-600"
        >
          {importOpen ? "▾ 收起「从合集导入」" : "＋ 从合集导入（可选）"}
        </button>

        {importOpen && (
          <div className="mt-2">
            {selectedNoteIds.size > 0 && (
              <p className="mb-1.5 text-[11px] text-teal-600">
                {(() => {
                  const cnt = collections
                    .filter((c) => selectedNoteIds.has(c.noteId))
                    .reduce((s, c) => s + c.cards.length, 0);
                  return `将随分类一起收录 ${selectedNoteIds.size} 个合集 / ${cnt} 条`;
                })()}
              </p>
            )}
            <div className="relative mb-2">
              <Search className="absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-zinc-400" />
              <input
                value={colQuery}
                onChange={(e) => setColQuery(e.target.value)}
                placeholder="搜索笔记标题 / 词面…"
                className="w-full rounded-lg border border-zinc-200 py-1.5 pl-8 pr-3 text-xs focus:border-teal-500 focus:outline-none"
              />
            </div>
            {colLoading ? (
              <p className="py-3 text-center text-xs text-zinc-400">加载中…</p>
            ) : filteredCollections.length === 0 ? (
              <p className="py-3 text-center text-xs text-zinc-400">
                没有可导入的合集（有生词/例句的笔记）。
              </p>
            ) : (
              <div className="max-h-40 space-y-1 overflow-y-auto">
                {filteredCollections.map((col) => (
                  <label
                    key={col.noteId}
                    className="flex items-center gap-2 rounded-md border border-zinc-100 px-2 py-1.5 hover:bg-zinc-50"
                  >
                    <input
                      type="checkbox"
                      checked={selectedNoteIds.has(col.noteId)}
                      onChange={() => toggleCollection(col.noteId)}
                      className="h-3.5 w-3.5 shrink-0 accent-teal-600"
                    />
                    <span className="min-w-0 flex-1 truncate text-xs font-medium text-zinc-700">
                      {col.title}
                    </span>
                    <span className="shrink-0 text-[10px] text-zinc-400">
                      {col.cards.length} 条
                    </span>
                  </label>
                ))}
              </div>
            )}
          </div>
        )}
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
    </div>
  );
}
