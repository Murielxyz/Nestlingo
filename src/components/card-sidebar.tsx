"use client";

import { useCallback, useEffect, useState } from "react";
import { Layers, Pencil, Sparkles, Trash2, Search } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { cardLang, LANG_LABEL, LANG_ORDER, type Lang } from "@/lib/lang-detect";
import { usePanelResize } from "@/lib/use-panel-resize";
import { parseCards, type ParsedCard } from "@/lib/parse-cards";
import type { Card } from "@/lib/types";
import { CardFront } from "./card-front";

const KIND_LABEL: Record<string, string> = {
  word: "生词",
  example: "例句",
  grammar: "语法",
};

/**
 * 笔记分栏里的闪卡侧栏（电脑端点「闪卡」按钮打开）：
 * 拉取这篇笔记的卡，紧凑单列展示，支持编辑 / 删除 / 手动添加。
 */
export function CardSidebar({
  noteId,
  onClose,
}: {
  noteId: string;
  onClose: () => void;
}) {
  const { width, onPointerDown } = usePanelResize({
    key: "nestlingo:cards-sidebar-width",
    initial: 380,
    min: 260,
    max: 600,
    flip: false,
  });
  const [cards, setCards] = useState<Card[] | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [front, setFront] = useState("");
  const [back, setBack] = useState("");
  const [lang, setLang] = useState<Lang>("other");
  // 「AI 解释」：对单张卡的背面生成更完整解释（/api/ai/card-explain），可直接就地改完保存。
  const [aiBusy, setAiBusy] = useState(false);
  const [aiError, setAiError] = useState<string | null>(null);
  const [addOpen, setAddOpen] = useState(false);
  // 搜索：头部放大镜展开/收起搜索行，命中「正面 + 背面」文本。
  const [searchOpen, setSearchOpen] = useState(false);
  const [query, setQuery] = useState("");
  // 「添加闪卡」：粘贴内容 → 识别成卡片 → 可编辑草稿 → 整批入库（同笔记闪卡页 AddNoteSheet）。
  const [paste, setPaste] = useState("");
  const [addLang, setAddLang] = useState<Lang>("other");
  const [drafts, setDrafts] = useState<ParsedCard[] | null>(null);
  const [kindFilter, setKindFilter] = useState<"all" | "word" | "example" | "grammar">("all");

  const load = useCallback(async () => {
    const supabase = createClient();
    const { data } = await supabase
      .from("cards")
      .select("*")
      .eq("note_id", noteId)
      .order("position", { ascending: true })
      .order("created_at", { ascending: true });
    setCards((data ?? []) as Card[]);
  }, [noteId]);

  useEffect(() => {
    load();
  }, [load]);

  // 其它入口（精读「记录到闪卡」/「收录到闪卡」）直接往 cards 表插卡时，侧栏不会自己知道；
  // 监听 `ln-cards-changed` 事件立即重新拉取，不用关了再开。
  useEffect(() => {
    const onChanged = () => load();
    window.addEventListener("ln-cards-changed", onChanged);
    return () => window.removeEventListener("ln-cards-changed", onChanged);
  }, [load]);

  function startEdit(c: Card) {
    setEditingId(c.id);
    setFront(c.front);
    setBack(c.back ?? "");
    setLang(cardLang(c));
    setAiError(null);
  }

  /** 「AI 解释」：调 /api/ai/card-explain 用正面+已有背面生成更完整解释，覆盖到背面输入框。 */
  async function aiFillBack() {
    const c = cards?.find((cc) => cc.id === editingId);
    if (!c || aiBusy || !front.trim()) return;
    setAiBusy(true);
    setAiError(null);
    try {
      const res = await fetch("/api/ai/card-explain", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          front: front.trim(),
          back: back.trim(),
          kind: c.kind ?? null,
        }),
        signal: AbortSignal.timeout(60_000),
      });
      const data = await res.json();
      if (!res.ok) {
        setAiError(data?.error ?? "解释失败");
        return;
      }
      const explanation = String(data?.explanation ?? "").trim();
      if (!explanation) {
        setAiError("没生成内容");
        return;
      }
      setBack(explanation);
    } catch (e) {
      setAiError(e instanceof Error ? e.message : String(e));
    } finally {
      setAiBusy(false);
    }
  }

  async function saveEdit() {
    if (!editingId) return;
    const supabase = createClient();
    const { error } = await supabase
      .from("cards")
      .update({ front: front.trim(), back: back.trim(), lang })
      .eq("id", editingId);
    if (!error) {
      setEditingId(null);
      load();
    }
  }

  async function deleteCard(id: string) {
    if (!window.confirm("删除这张闪卡？")) return;
    const supabase = createClient();
    const { error } = await supabase.from("cards").delete().eq("id", id);
    if (!error) load();
  }

  /** 粘贴识别：把一段词表 / 表格 / 「词—释义」文本拆成候选卡片草稿。 */
  function recognizeAdd() {
    const parsed = parseCards(paste);
    setDrafts(parsed.length ? parsed : null);
  }

  function patchDraft(i: number, patch: Partial<ParsedCard>) {
    setDrafts((prev) => prev?.map((c, ci) => (ci === i ? { ...c, ...patch } : c)) ?? null);
  }

  function removeDraft(i: number) {
    setDrafts((prev) => prev?.filter((_, ci) => ci !== i) ?? null);
  }

  /** 整批入库（默认语言取当前合集主导语言，识别失败可按卡片 lang 兜底）。 */
  async function submitAdd() {
    const rows = (drafts ?? []).filter((c) => c.front.trim());
    if (rows.length === 0) return;
    const supabase = createClient();
    const values = rows.map((c) => ({
      note_id: noteId,
      front: c.front.trim(),
      back: c.back.trim(),
      kind: c.kind ?? null,
      lang: addLang,
    }));
    const { error } = await supabase.from("cards").insert(values);
    if (error) return;
    setPaste("");
    setDrafts(null);
    setAddOpen(false);
    load();
  }

  /** 该合集主导语言（多数决），给「添加」表单做默认语言。 */
  function dominantLangOf(cards: Card[]): Lang {
    const counts = new Map<Lang, number>();
    for (const c of cards) {
      const l = cardLang(c);
      counts.set(l, (counts.get(l) ?? 0) + 1);
    }
    let best: Lang = "other";
    let max = 0;
    for (const [l, n] of counts) if (n > max) {
      max = n;
      best = l;
    }
    return best;
  }

  // 三种类型的计数 + 过滤标签（生词 / 例句 / 语法），哪类有卡就显示哪类 tab。
  const kindCounts = ({ word: 0, example: 0, grammar: 0 } as Record<string, number>);
  for (const c of cards ?? []) {
    if (c.kind && c.kind in kindCounts) kindCounts[c.kind]++;
  }
  const kinds: { key: "word" | "example" | "grammar"; label: string }[] = [
    { key: "word", label: "生词" },
    { key: "example", label: "例句" },
    { key: "grammar", label: "语法" },
  ];
  const presentKinds = kinds.filter((k) => kindCounts[k.key] > 0);
  const hasKinds = presentKinds.length > 0;
  const effectiveFilter =
    kindFilter !== "all" && kindCounts[kindFilter] === 0 ? "all" : kindFilter;
  const q = query.trim().toLowerCase();
  const visibleCards = (cards ?? []).filter((c) => {
    if (effectiveFilter !== "all" && c.kind !== effectiveFilter) return false;
    if (
      q &&
      !c.front.toLowerCase().includes(q) &&
      !(c.back ?? "").toLowerCase().includes(q)
    )
      return false;
    return true;
  });

  return (
    <aside
      style={{ width }}
      className="relative flex w-full shrink-0 flex-col border-l border-zinc-200 bg-zinc-50 md:w-auto"
    >
      {/* 桌面端拖拽把手：按住左边缘往里/外拖调整宽度 */}
      <div
        onPointerDown={onPointerDown}
        className="absolute inset-y-0 left-0 z-10 hidden w-1.5 cursor-col-resize bg-transparent transition-colors hover:bg-teal-200/70 md:block"
        aria-hidden
      />

      <header className="flex items-center justify-between border-b border-zinc-200 bg-white px-3 py-2">
        <h2 className="flex items-center gap-1.5 text-sm font-semibold text-zinc-800">
          <Layers className="h-4 w-4 text-teal-600" />
          闪卡{cards ? `（${cards.length}）` : ""}
        </h2>
        <div className="flex items-center gap-0.5">
          <button
            onClick={() => {
              setSearchOpen((v) => !v);
              if (searchOpen) setQuery("");
            }}
            className="rounded-lg px-2 py-1 text-zinc-500 transition-colors hover:bg-zinc-100 hover:text-zinc-800"
            aria-label="搜索闪卡"
            title="搜索闪卡"
          >
            <Search className="h-4 w-4" />
          </button>
          <button
            onClick={onClose}
            className="rounded-lg px-2 py-1 text-sm text-zinc-500 transition-colors hover:bg-zinc-100 hover:text-zinc-800"
            aria-label="收起闪卡"
          >
            ✕
          </button>
        </div>
      </header>

      {searchOpen && (
        <div className="border-b border-zinc-200 bg-white px-3 py-2">
          <div className="flex items-center gap-2 rounded-lg border border-zinc-200 bg-zinc-50 px-3 py-1.5">
            <Search className="h-4 w-4 shrink-0 text-zinc-400" />
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="搜索正面 / 背面…"
              className="min-w-0 flex-1 bg-transparent text-sm text-zinc-800 placeholder-zinc-400 focus:outline-none placeholder:text-sm"
            />
            {query && (
              <button
                onClick={() => setQuery("")}
                className="text-sm text-zinc-400 hover:text-zinc-600"
                aria-label="清空搜索"
              >
                ✕
              </button>
            )}
          </div>
        </div>
      )}

      {hasKinds && (
        <div className="flex flex-wrap gap-1 border-b border-zinc-200 bg-white px-2 py-1.5">
          {[
            { key: "all" as const, label: "全部", count: cards?.length ?? 0 },
            ...presentKinds.map((k) => ({ key: k.key, label: k.label, count: kindCounts[k.key] })),
          ].map((t) => (
            <button
              key={t.key}
              onClick={() => setKindFilter(t.key)}
              className={`rounded-full px-2.5 py-0.5 text-xs transition-colors ${
                effectiveFilter === t.key
                  ? "bg-teal-600 font-semibold text-white"
                  : "text-zinc-500 hover:bg-zinc-100"
              }`}
            >
              {t.label} {t.count}
            </button>
          ))}
        </div>
      )}

      <div className="flex-1 space-y-2 overflow-y-auto p-3">
        {cards === null ? (
          <p className="py-6 text-center text-xs text-zinc-400">加载中…</p>
        ) : cards.length === 0 ? (
          <p className="py-6 text-center text-xs text-zinc-400">
            还没有闪卡。
            <br />
            点下方「＋ 添加闪卡」粘贴内容识别，即可整批入库。
          </p>
        ) : visibleCards.length === 0 ? (
          <p className="py-6 text-center text-xs text-zinc-400">没有匹配的闪卡。</p>
        ) : (
          visibleCards.map((c) =>
            editingId === c.id ? (
              <div
                key={c.id}
                className="space-y-2 rounded-xl border border-teal-300 bg-white p-3"
              >
                <input
                  value={front}
                  onChange={(e) => setFront(e.target.value)}
                  placeholder="正面"
                  autoFocus
                  className="w-full rounded-lg border border-zinc-200 px-3 py-1.5 text-sm focus:border-teal-500 focus:outline-none placeholder:text-sm"
                />
                <textarea
                  value={back}
                  onChange={(e) => setBack(e.target.value)}
                  placeholder="背面"
                  rows={2}
                  className="w-full rounded-lg border border-zinc-200 px-3 py-1.5 text-sm focus:border-teal-500 focus:outline-none placeholder:text-sm"
                />
                <div className="flex items-center gap-2 text-sm">
                  <label className="shrink-0 text-xs text-zinc-400">语言</label>
                  <select
                    value={lang}
                    onChange={(e) => setLang(e.target.value as Lang)}
                    className="rounded-lg border border-zinc-200 px-2 py-1 text-sm focus:border-teal-500 focus:outline-none"
                  >
                    {LANG_ORDER.map((l) => (
                      <option key={l} value={l}>
                        {LANG_LABEL[l]}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="flex items-center justify-between text-sm">
                  <button
                    onClick={aiFillBack}
                    disabled={aiBusy || !front.trim()}
                    className="inline-flex items-center gap-1.5 rounded-lg border border-violet-200 px-3 py-2 text-xs font-medium text-violet-600 transition-colors hover:bg-violet-50 disabled:opacity-60"
                    aria-label="AI 解释背面"
                  >
                    <Sparkles className="h-3.5 w-3.5" />
                    {aiBusy ? "AI 解释中…" : "AI 解释"}
                  </button>
                  <div className="flex gap-3 text-sm">
                    <button onClick={saveEdit} className="text-teal-600 hover:text-teal-700">
                      保存
                    </button>
                    <button
                      onClick={() => setEditingId(null)}
                      className="text-zinc-500 hover:text-zinc-700"
                    >
                      取消
                    </button>
                  </div>
                </div>
                {aiError && <p className="text-xs text-red-600">{aiError}</p>}
              </div>
            ) : (
              <div
                key={c.id}
                className="group rounded-xl border border-zinc-200 bg-white p-3"
              >
                <div className="flex items-start justify-between gap-2">
                  <p className="whitespace-pre-wrap text-sm font-medium text-zinc-900">
                    <CardFront text={c.front} reading={c.reading} />
                  </p>
                  <div className="flex shrink-0 gap-1 opacity-0 transition-opacity group-hover:opacity-100">
                    <button
                      onClick={() => startEdit(c)}
                      className="rounded p-1 text-zinc-400 hover:text-zinc-700"
                      aria-label="编辑"
                    >
                      <Pencil className="h-3.5 w-3.5" />
                    </button>
                    <button
                      onClick={() => deleteCard(c.id)}
                      className="rounded p-1 text-zinc-400 hover:text-red-600"
                      aria-label="删除"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  </div>
                </div>
                {c.back && (
                  <p className="mt-1 whitespace-pre-wrap text-xs text-zinc-500">{c.back}</p>
                )}
                {c.kind && (
                  <span className="mt-1.5 inline-block rounded-full bg-teal-50 px-2 py-0.5 text-[10px] font-medium text-teal-600">
                    {KIND_LABEL[c.kind] ?? c.kind}
                  </span>
                )}
              </div>
            )
          )
        )}

        {!addOpen && (
          <button
            onClick={() => {
              setAddLang(dominantLangOf(cards ?? []));
              setAddOpen(true);
            }}
            className="w-full rounded-lg border border-dashed border-zinc-300 px-3 py-2 text-sm text-zinc-600 transition-colors hover:border-teal-300 hover:text-teal-600"
          >
            ＋ 添加闪卡
          </button>
        )}

        {addOpen && (
          <div className="space-y-2 rounded-xl border border-zinc-200 bg-white p-3">
            <textarea
              value={paste}
              onChange={(e) => setPaste(e.target.value)}
              placeholder="粘贴内容，逐行「词 — 释义」，或直接贴表格 / 词表"
              rows={4}
              autoFocus
              className="w-full rounded-lg border border-zinc-200 px-3 py-1.5 text-sm focus:border-teal-500 focus:outline-none placeholder:text-sm"
            />
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={recognizeAdd}
                className="rounded-lg bg-teal-600 px-3 py-1.5 text-sm font-semibold text-white hover:bg-teal-700"
              >
                识别成卡片
              </button>
              <label className="ml-auto shrink-0 text-xs text-zinc-400">语言</label>
              <select
                value={addLang}
                onChange={(e) => setAddLang(e.target.value as Lang)}
                className="rounded-lg border border-zinc-200 px-2 py-1.5 text-sm focus:border-teal-500 focus:outline-none"
              >
                {LANG_ORDER.map((l) => (
                  <option key={l} value={l}>
                    {LANG_LABEL[l]}
                  </option>
                ))}
              </select>
            </div>

            {drafts !== null && (
              <div className="space-y-2">
                {drafts.map((c, i) => (
                  <div key={i} className="space-y-1.5 rounded-lg border border-zinc-100 bg-zinc-50 p-2">
                    <input
                      value={c.front}
                      onChange={(e) => patchDraft(i, { front: e.target.value })}
                      placeholder="正面"
                      className="w-full rounded-md border border-zinc-200 bg-white px-2 py-1 text-sm focus:border-teal-500 focus:outline-none"
                    />
                    <textarea
                      value={c.back}
                      onChange={(e) => patchDraft(i, { back: e.target.value })}
                      placeholder="背面（释义 / 读音）"
                      rows={1}
                      className="w-full rounded-md border border-zinc-200 bg-white px-2 py-1 text-sm focus:border-teal-500 focus:outline-none"
                    />
                    <div className="flex items-center gap-1.5">
                      {c.kind && (
                        <span className="rounded-full bg-teal-50 px-2 py-0.5 text-[10px] font-medium text-teal-600">
                          {KIND_LABEL[c.kind] ?? c.kind}
                        </span>
                      )}
                      <button
                        type="button"
                        onClick={() => removeDraft(i)}
                        className="ml-auto rounded px-1.5 text-xs text-zinc-400 hover:text-red-600"
                        aria-label="移除"
                      >
                        ✕
                      </button>
                    </div>
                  </div>
                ))}
                <div className="flex items-center justify-between">
                  <button
                    type="button"
                    onClick={recognizeAdd}
                    className="text-xs text-teal-600 hover:text-teal-700"
                  >
                    ＋ 加一行
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setPaste("");
                      setDrafts(null);
                    }}
                    className="text-xs text-zinc-400 hover:text-zinc-600"
                  >
                    重新粘贴
                  </button>
                </div>
              </div>
            )}

            <div className="flex gap-2">
              <button
                type="button"
                onClick={submitAdd}
                disabled={!drafts || drafts.filter((c) => c.front.trim()).length === 0}
                className="rounded-lg bg-teal-600 px-3 py-1.5 text-sm font-semibold text-white hover:bg-teal-700 disabled:cursor-not-allowed disabled:opacity-40"
              >
                确认添加 {drafts ? drafts.filter((c) => c.front.trim()).length : 0} 张
              </button>
              <button
                type="button"
                onClick={() => {
                  setAddOpen(false);
                  setPaste("");
                  setDrafts(null);
                }}
                className="rounded-lg px-3 py-1.5 text-sm text-zinc-500 hover:bg-zinc-100"
              >
                取消
              </button>
            </div>
          </div>
        )}
      </div>
    </aside>
  );
}
