"use client";

import { useCallback, useEffect, useState } from "react";
import { Layers, Pencil, Trash2 } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { detectCardLang, cardLang, LANG_LABEL, LANG_ORDER, type Lang } from "@/lib/lang-detect";
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
  onConvert,
}: {
  noteId: string;
  onClose: () => void;
  onConvert: () => void;
}) {
  const [cards, setCards] = useState<Card[] | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [front, setFront] = useState("");
  const [back, setBack] = useState("");
  const [lang, setLang] = useState<Lang>("other");
  const [addOpen, setAddOpen] = useState(false);
  const [newFront, setNewFront] = useState("");
  const [newBack, setNewBack] = useState("");
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

  function startEdit(c: Card) {
    setEditingId(c.id);
    setFront(c.front);
    setBack(c.back ?? "");
    setLang(cardLang(c));
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

  async function addCard(e: React.FormEvent) {
    e.preventDefault();
    if (!newFront.trim()) return;
    const supabase = createClient();
    const { error } = await supabase
      .from("cards")
      .insert({
        note_id: noteId,
        front: newFront.trim(),
        back: newBack.trim(),
        lang: detectCardLang({ front: newFront.trim(), back: newBack.trim() }),
      });
    if (!error) {
      setNewFront("");
      setNewBack("");
      setAddOpen(false);
      load();
    }
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
  const visibleCards = (cards ?? []).filter(
    (c) => effectiveFilter === "all" || c.kind === effectiveFilter
  );

  return (
    <aside className="flex w-full shrink-0 flex-col border-l border-zinc-200 bg-zinc-50 md:w-[380px]">
      <header className="flex items-center justify-between border-b border-zinc-200 bg-white px-3 py-2">
        <h2 className="flex items-center gap-1.5 text-sm font-semibold text-zinc-800">
          <Layers className="h-4 w-4 text-teal-600" />
          闪卡{cards ? `（${cards.length}）` : ""}
        </h2>
        <button
          onClick={onClose}
          className="rounded-lg px-2 py-1 text-sm text-zinc-500 transition-colors hover:bg-zinc-100 hover:text-zinc-800"
          aria-label="收起闪卡"
        >
          ✕
        </button>
      </header>

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
        <div className="flex gap-2">
          <button
            onClick={() => setAddOpen((v) => !v)}
            className="flex-1 rounded-lg border border-dashed border-zinc-300 px-3 py-2 text-sm text-zinc-600 transition-colors hover:border-teal-300 hover:text-teal-600"
          >
            ＋ 添加闪卡
          </button>
          <button
            onClick={onConvert}
            className="flex-1 rounded-lg border border-dashed border-teal-300 px-3 py-2 text-sm text-teal-600 transition-colors hover:bg-teal-50"
          >
            转成闪卡
          </button>
        </div>

        {addOpen && (
          <form
            onSubmit={addCard}
            className="space-y-2 rounded-xl border border-zinc-200 bg-white p-3"
          >
            <input
              value={newFront}
              onChange={(e) => setNewFront(e.target.value)}
              placeholder="正面（要记的词）"
              autoFocus
              className="w-full rounded-lg border border-zinc-200 px-3 py-1.5 text-sm focus:border-teal-500 focus:outline-none"
            />
            <textarea
              value={newBack}
              onChange={(e) => setNewBack(e.target.value)}
              placeholder="背面（释义 / 读音，可换行加例句）"
              rows={2}
              className="w-full rounded-lg border border-zinc-200 px-3 py-1.5 text-sm focus:border-teal-500 focus:outline-none"
            />
            <div className="flex gap-2">
              <button
                type="submit"
                className="rounded-lg bg-teal-600 px-3 py-1.5 text-sm font-semibold text-white hover:bg-teal-700"
              >
                添加
              </button>
              <button
                type="button"
                onClick={() => setAddOpen(false)}
                className="rounded-lg px-3 py-1.5 text-sm text-zinc-500 hover:bg-zinc-100"
              >
                取消
              </button>
            </div>
          </form>
        )}

        {cards === null ? (
          <p className="py-6 text-center text-xs text-zinc-400">加载中…</p>
        ) : cards.length === 0 ? (
          <p className="py-6 text-center text-xs text-zinc-400">
            还没有闪卡。
            <br />
            点上方「＋ 添加」手动加，或「转成闪卡」从笔记内容识别。
          </p>
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
                  className="w-full rounded-lg border border-zinc-200 px-3 py-1.5 text-sm focus:border-teal-500 focus:outline-none"
                />
                <textarea
                  value={back}
                  onChange={(e) => setBack(e.target.value)}
                  placeholder="背面"
                  rows={2}
                  className="w-full rounded-lg border border-zinc-200 px-3 py-1.5 text-sm focus:border-teal-500 focus:outline-none"
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
      </div>
    </aside>
  );
}
