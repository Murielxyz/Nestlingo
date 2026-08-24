"use client";

// 词群页「收录」弹窗：把词收进某个主题，三种方式——
// 1) 选择已有未归类词（支持搜索） 2) 新建一张闪卡 3) 粘贴文本转成闪卡。
// 收录 = 把 cards.theme 设成该主题 key，不新建分类、不删任何卡片。

import { useMemo, useState, useEffect } from "react";
import { Search, X, Sparkles } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import type { CardWithNote } from "@/lib/types";
import { parseCards } from "@/lib/parse-cards";
import { detectCardLang } from "@/lib/lang-detect";
import { listImportableCollections, type ImportableCollection } from "@/lib/import-collections";

type Tab = "select" | "create" | "paste" | "collection";

export function CollectWordsModal({
  themeKey,
  themeLabel,
  unclassified,
  onClose,
  onDone,
}: {
  themeKey: string;
  themeLabel: string;
  unclassified: CardWithNote[];
  onClose: () => void;
  onDone: () => void;
}) {
  const [tab, setTab] = useState<Tab>("select");
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);
  const [lemmatizing, setLemmatizing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);

  // 打开任意 tabs 时清掉上一次的提示。
  useEffect(() => {
    setDone(null);
  }, [tab]);

  const [front, setFront] = useState("");
  const [back, setBack] = useState("");
  const [text, setText] = useState("");

  // 「从合集导入」：按笔记/合集搜索，一键把该篇的生词+例句收进当前主题。
  const [collections, setCollections] = useState<ImportableCollection[]>([]);
  const [collectionLoading, setCollectionLoading] = useState(false);
  const [collectionQuery, setCollectionQuery] = useState("");
  const [selectedNoteIds, setSelectedNoteIds] = useState<Set<string>>(new Set());
  const [importing, setImporting] = useState(false);

  const supabase = createClient();

  // 首次打开（或切到「从合集导入」）时拉一次所有可导入的合集，跳过当前主题已收录的卡。
  useEffect(() => {
    let cancelled = false;
    async function load() {
      setCollectionLoading(true);
      try {
        const list = await listImportableCollections(themeKey);
        if (!cancelled) setCollections(list);
      } catch {
        if (!cancelled) setCollections([]);
      } finally {
        if (!cancelled) setCollectionLoading(false);
      }
    }
    load();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return unclassified;
    return unclassified.filter(
      (c) =>
        c.front.toLowerCase().includes(q) ||
        (c.back ?? "").toLowerCase().includes(q)
    );
  }, [unclassified, query]);

  // 按合集标题 / 卡面搜索可导入的合集。
  const filteredCollections = useMemo(() => {
    const q = collectionQuery.trim().toLowerCase();
    if (!q) return collections;
    return collections.filter(
      (col) =>
        col.title.toLowerCase().includes(q) ||
        col.cards.some((c) => c.front.toLowerCase().includes(q))
    );
  }, [collections, collectionQuery]);

  function toggleCollection(noteId: string) {
    setSelectedNoteIds((prev) => {
      const next = new Set(prev);
      if (next.has(noteId)) next.delete(noteId);
      else next.add(noteId);
      return next;
    });
  }

  // 一键导入所选合集：把这些笔记的全部 生词+例句 卡 theme 设成当前主题。
  async function importCollections() {
    if (selectedNoteIds.size === 0) return;
    setImporting(true);
    setError(null);
    const ids = collections
      .filter((c) => selectedNoteIds.has(c.noteId))
      .flatMap((c) => c.cards.map((card) => card.id));
    if (ids.length === 0) {
      setImporting(false);
      setDone("所选合集已全部收录");
      return;
    }
    const { error } = await supabase.from("cards").update({ theme: themeKey }).in("id", ids);
    setImporting(false);
    if (error) {
      setError(error.message);
      return;
    }
    onDone();
  }

  function toggle(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  async function assignSelected() {
    if (selected.size === 0) return;
    setBusy(true);
    setError(null);
    const { error } = await supabase
      .from("cards")
      .update({ theme: themeKey })
      .in("id", Array.from(selected));
    setBusy(false);
    if (error) {
      setError(error.message);
      return;
    }
    onDone();
  }

  async function lemmatize() {
    if (!front.trim()) return;
    setLemmatizing(true);
    setError(null);
    try {
      const res = await fetch("/api/ai/lemma", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ text: front.trim() }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data?.error ?? "还原失败，请重试");
        return;
      }
      const base = typeof data?.baseForm === "string" ? data.baseForm.trim() : "";
      if (base && base !== front.trim()) setFront(base);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLemmatizing(false);
    }
  }

  async function createCard() {
    if (!front.trim()) {
      setError("正面不能为空。");
      return;
    }
    setBusy(true);
    setError(null);
    const { error } = await supabase.from("cards").insert({
      front: front.trim(),
      back: back.trim() || null,
      kind: "word",
      theme: themeKey,
      lang: detectCardLang({ front: front.trim(), back: back.trim() || null }),
      position: 0,
    });
    setBusy(false);
    if (error) {
      setError(error.message);
      return;
    }
    onDone();
  }

  async function pasteCards() {
    const cards = parseCards(text);
    if (cards.length === 0) {
      setError("没识别到闪卡，检查格式（词—释义 / 表格 / 词  读音  释义）。");
      return;
    }
    setBusy(true);
    setError(null);
    const { error } = await supabase.from("cards").insert(
      cards.map((c) => ({
        front: c.front,
        back: c.back || null,
        kind: "word",
        theme: themeKey,
        lang: detectCardLang({ front: c.front, back: c.back || null }),
        position: 0,
      }))
    );
    setBusy(false);
    if (error) {
      setError(error.message);
      return;
    }
    onDone();
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
      onClick={onClose}
    >
      <div
        className="max-h-[80vh] w-full max-w-lg overflow-y-auto rounded-2xl bg-white p-5 shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <header className="mb-4 flex items-center justify-between">
          <h2 className="text-base font-semibold text-zinc-900">
            收录到「{themeLabel}」
          </h2>
          <button
            onClick={onClose}
            className="rounded-lg p-1 text-zinc-400 hover:bg-zinc-100 hover:text-zinc-700"
            aria-label="关闭"
          >
            <X className="h-5 w-5" />
          </button>
        </header>

        <div className="mb-4 flex gap-1.5">
          {(
            [
              ["select", "选择已有"],
              ["create", "新建"],
              ["paste", "粘贴"],
              ["collection", "从合集导入"],
            ] as [Tab, string][]
          ).map(([t, label]) => (
            <button
              key={t}
              onClick={() => setTab(t)}
              className={`rounded-full px-3 py-1 text-sm transition-colors ${
                tab === t
                  ? "bg-teal-600 font-semibold text-white"
                  : "border border-zinc-200 text-zinc-600 hover:bg-zinc-50"
              }`}
            >
              {label}
            </button>
          ))}
        </div>

        {error && (
          <p className="mb-3 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-600">
            {error}
          </p>
        )}

        {done && (
          <p className="mb-3 rounded-lg border border-teal-200 bg-teal-50 px-3 py-2 text-sm text-teal-700">
            {done}
          </p>
        )}

        {tab === "select" && (
          <div>
            <div className="relative mb-3">
              <Search className="absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-zinc-400" />
              <input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder={`搜索未归类的词（共 ${unclassified.length} 个）`}
                className="w-full rounded-lg border border-zinc-200 py-2 pl-9 pr-3 text-sm focus:border-teal-500 focus:outline-none"
              />
            </div>
            <div className="max-h-72 space-y-1 overflow-y-auto">
              {filtered.length === 0 ? (
                <p className="py-8 text-center text-sm text-zinc-400">
                  没有未归类的词了。
                </p>
              ) : (
                filtered.map((c) => (
                  <label
                    key={c.id}
                    className="flex items-center gap-2.5 rounded-lg border border-zinc-100 px-3 py-2 hover:bg-zinc-50"
                  >
                    <input
                      type="checkbox"
                      checked={selected.has(c.id)}
                      onChange={() => toggle(c.id)}
                      className="h-4 w-4 shrink-0 accent-teal-600"
                    />
                    <span className="min-w-0 flex-1 truncate text-sm font-medium text-zinc-800">
                      {c.front}
                    </span>
                    <span className="min-w-0 flex-1 truncate text-xs text-zinc-500">
                      {c.back || ""}
                    </span>
                  </label>
                ))
              )}
            </div>
            <button
              onClick={assignSelected}
              disabled={busy || selected.size === 0}
              className="mt-3 w-full rounded-lg bg-teal-600 py-2 text-sm font-semibold text-white transition-colors hover:bg-teal-700 disabled:opacity-60"
            >
              {busy ? "收录中…" : `收录 ${selected.size} 个词`}
            </button>
          </div>
        )}

        {tab === "create" && (
          <div className="space-y-3">
            <div>
              <label className="mb-1 block text-xs font-medium text-zinc-600">
                正面（要记的词）
              </label>
              <div className="flex gap-2">
                <input
                  value={front}
                  onChange={(e) => setFront(e.target.value)}
                  placeholder="如 สวย"
                  className="min-w-0 flex-1 rounded-lg border border-zinc-200 px-3 py-2 text-sm focus:border-teal-500 focus:outline-none"
                />
                <button
                  type="button"
                  onClick={lemmatize}
                  disabled={lemmatizing || !front.trim()}
                  className="inline-flex shrink-0 items-center gap-1 rounded-lg border border-teal-200 px-2.5 py-2 text-xs font-medium text-teal-600 transition-colors hover:bg-teal-50 disabled:opacity-50"
                >
                  <Sparkles className="h-3.5 w-3.5" />
                  {lemmatizing ? "还原中…" : "还原原形"}
                </button>
              </div>
              <p className="mt-1 text-xs text-zinc-400">
                韩/日文变形词可点「还原原形」转成词典形（如 행복한 → 행복하다）。
              </p>
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium text-zinc-600">
                背面（释义）
              </label>
              <input
                value={back}
                onChange={(e) => setBack(e.target.value)}
                placeholder="如 漂亮"
                className="w-full rounded-lg border border-zinc-200 px-3 py-2 text-sm focus:border-teal-500 focus:outline-none"
              />
            </div>
            <button
              onClick={createCard}
              disabled={busy}
              className="w-full rounded-lg bg-teal-600 py-2 text-sm font-semibold text-white transition-colors hover:bg-teal-700 disabled:opacity-60"
            >
              {busy ? "创建中…" : "创建并收录"}
            </button>
          </div>
        )}

        {tab === "paste" && (
          <div className="space-y-3">
            <textarea
              value={text}
              onChange={(e) => setText(e.target.value)}
              placeholder={"粘贴词表 / 表格，一行一个：\n词—释义\n词  读音  释义\n或从 Excel 复制的表格"}
              rows={8}
              className="w-full rounded-lg border border-zinc-200 px-3 py-2 text-sm focus:border-teal-500 focus:outline-none"
            />
            <button
              onClick={pasteCards}
              disabled={busy}
              className="w-full rounded-lg bg-teal-600 py-2 text-sm font-semibold text-white transition-colors hover:bg-teal-700 disabled:opacity-60"
            >
              {busy ? "转换中…" : "转成闪卡并收录"}
            </button>
          </div>
        )}

        {tab === "collection" && (
          <div>
            <p className="mb-2 text-xs text-zinc-400">
              按笔记/合集搜索，一键把该篇的「生词 + 例句」一起收进当前主题。
            </p>
            <div className="relative mb-3">
              <Search className="absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-zinc-400" />
              <input
                value={collectionQuery}
                onChange={(e) => setCollectionQuery(e.target.value)}
                placeholder="搜索笔记标题 / 词面…"
                className="w-full rounded-lg border border-zinc-200 py-2 pl-9 pr-3 text-sm focus:border-teal-500 focus:outline-none"
              />
            </div>
            <div className="max-h-72 space-y-1 overflow-y-auto">
              {collectionLoading ? (
                <p className="py-8 text-center text-sm text-zinc-400">加载中…</p>
              ) : filteredCollections.length === 0 ? (
                <p className="py-8 text-center text-sm text-zinc-400">
                  没有可导入的合集（该主题已收录的卡会自动跳过）。
                </p>
              ) : (
                filteredCollections.map((col) => (
                  <label
                    key={col.noteId}
                    className="flex items-center gap-2.5 rounded-lg border border-zinc-100 px-3 py-2 hover:bg-zinc-50"
                  >
                    <input
                      type="checkbox"
                      checked={selectedNoteIds.has(col.noteId)}
                      onChange={() => toggleCollection(col.noteId)}
                      className="h-4 w-4 shrink-0 accent-teal-600"
                    />
                    <span className="min-w-0 flex-1 truncate text-sm font-medium text-zinc-800">
                      {col.title}
                    </span>
                    <span className="shrink-0 rounded-full bg-teal-50 px-2 py-0.5 text-xs font-medium text-teal-600">
                      {col.cards.length} 张待收录
                    </span>
                  </label>
                ))
              )}
            </div>
            <button
              onClick={importCollections}
              disabled={importing || selectedNoteIds.size === 0}
              className="mt-3 w-full rounded-lg bg-teal-600 py-2 text-sm font-semibold text-white transition-colors hover:bg-teal-700 disabled:opacity-60"
            >
              {importing
                ? "导入中…"
                : `导入 ${selectedNoteIds.size} 个合集`}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
