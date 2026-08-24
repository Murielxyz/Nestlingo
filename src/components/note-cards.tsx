"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { SquareCheckBig, Search } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { detectCardLang } from "@/lib/lang-detect";
import type { Card } from "@/lib/types";
import { CardTile } from "./card-tile";

/**
 * 一组卡片（按来源展开后的卡片列表 / 独立卡片块）。
 * 默认只显示干净的翻面卡片（点一下翻面记忆）。
 * 点「☑ 选择」进入选择模式：勾选多张批量删除，或 ✏️ 单张编辑。
 * 传 noteId 时多一个「＋ 添加」手动加卡。卡片内容独立保存，与笔记不联动。
 * 单张的翻面 / 编辑 / 「✨ AI 解释」统一走 CardTile（与按主题视图完全一致）。
 */
export function NoteCards({ cards, noteId }: { cards: Card[]; noteId?: string }) {
  const router = useRouter();
  const [selecting, setSelecting] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [addOpen, setAddOpen] = useState(false);
  const [newFront, setNewFront] = useState("");
  const [newBack, setNewBack] = useState("");
  const [busy, setBusy] = useState(false);
  const [query, setQuery] = useState("");

  // 搜索：按正面 / 背面文字过滤（不区分大小写）。
  const q = query.trim().toLowerCase();
  const visible = q
    ? cards.filter(
        (c) =>
          c.front.toLowerCase().includes(q) ||
          (c.back ?? "").toLowerCase().includes(q)
      )
    : cards;
  const allVisibleSelected =
    visible.length > 0 && visible.every((c) => selected.has(c.id));

  async function addCard(e: React.FormEvent) {
    e.preventDefault();
    if (!newFront.trim()) return;
    setBusy(true);
    const supabase = createClient();
    const { error } = await supabase
      .from("cards")
      .insert({
        note_id: noteId ?? null,
        front: newFront.trim(),
        back: newBack.trim(),
        lang: detectCardLang({ front: newFront.trim(), back: newBack.trim() }),
      });
    setBusy(false);
    if (error) return;
    setNewFront("");
    setNewBack("");
    setAddOpen(false);
    router.refresh();
  }

  function toggleSelect(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function toggleAll() {
    setSelected(() =>
      allVisibleSelected ? new Set() : new Set(visible.map((c) => c.id))
    );
  }

  async function deleteSelected() {
    // 只删「当前可见 ∧ 选中」的卡：搜索会把部分卡藏起来，不能顺手删掉看不到的。
    const toDelete = visible.filter((c) => selected.has(c.id)).map((c) => c.id);
    if (toDelete.length === 0) return;
    if (!window.confirm(`删除选中的 ${toDelete.length} 张闪卡？`)) return;
    const supabase = createClient();
    const { error } = await supabase
      .from("cards")
      .delete()
      .in("id", toDelete);
    if (error) return;
    setSelected(new Set());
    setSelecting(false);
    router.refresh();
  }

  return (
    <div className="space-y-4">
      {/* 搜索 */}
      {cards.length > 0 && (
        <div className="relative">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-zinc-400" />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="搜索这个合集里的词 / 释义…"
            className="w-full rounded-xl border border-zinc-200 bg-white py-2 pl-9 pr-3 text-sm focus:border-teal-500 focus:outline-none"
          />
        </div>
      )}

      {/* 操作栏 */}
      <div className="flex flex-wrap items-center gap-2">
        {noteId && (
          <button
            onClick={() => setAddOpen((v) => !v)}
            className="rounded-lg border border-zinc-200 px-3 py-1.5 text-sm text-zinc-600 transition-colors hover:bg-zinc-50"
          >
            ＋ 添加
          </button>
        )}

        {selecting && (
          <>
            <button
              onClick={toggleAll}
              className="rounded-lg border border-zinc-200 px-3 py-1.5 text-sm text-zinc-600 hover:bg-zinc-50"
            >
              {allVisibleSelected ? "取消全选" : "全选"}
            </button>
            <span className="text-sm text-zinc-500">已选 {selected.size}</span>
            <button
              onClick={deleteSelected}
              disabled={selected.size === 0}
              className="rounded-lg px-3 py-1.5 text-sm font-medium text-red-600 transition-colors hover:bg-red-50 disabled:opacity-40"
            >
              删除
            </button>
          </>
        )}
        <button
          onClick={() => {
            if (selecting) setSelected(new Set());
            setSelecting((v) => !v);
          }}
          className={`ml-auto inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-sm transition-colors ${
            selecting
              ? "bg-teal-600 font-semibold text-white hover:bg-teal-700"
              : "border border-zinc-200 text-zinc-600 hover:bg-zinc-50"
          }`}
        >
          {selecting ? (
            "完成"
          ) : (
            <>
              <SquareCheckBig className="h-4 w-4" />
              选择
            </>
          )}
        </button>
      </div>

      {/* 添加表单 */}
      {addOpen && noteId && (
        <form onSubmit={addCard} className="flex flex-wrap gap-2">
          <input
            value={newFront}
            onChange={(e) => setNewFront(e.target.value)}
            placeholder="正面（要记的词）"
            className="min-w-[140px] flex-1 rounded-lg border border-zinc-300 px-3 py-2 text-sm focus:border-teal-500 focus:outline-none"
          />
          <textarea
            value={newBack}
            onChange={(e) => setNewBack(e.target.value)}
            placeholder="背面（释义 / 读音，可换行加例句）"
            rows={2}
            className="min-w-[140px] flex-1 rounded-lg border border-zinc-300 px-3 py-2 text-sm focus:border-teal-500 focus:outline-none"
          />
          <button
            type="submit"
            disabled={busy}
            className="rounded-lg bg-teal-600 px-4 py-2 text-sm font-semibold text-white hover:bg-teal-700 disabled:opacity-60"
          >
            添加
          </button>
        </form>
      )}

      {cards.length === 0 ? (
        <div className="rounded-xl border border-dashed border-zinc-300 px-4 py-10 text-center text-sm text-zinc-500">
          还没有闪卡。
          {noteId ? (
            <>
              <br />
              点上方「＋ 添加」手动加，或回到笔记点「⋯ → 转成闪卡」。
            </>
          ) : (
            <> 去闪卡页点「＋ 添加闪卡」生成。</>
          )}
        </div>
      ) : visible.length === 0 ? (
        <div className="rounded-xl border border-dashed border-zinc-300 px-4 py-10 text-center text-sm text-zinc-500">
          没有匹配「{query.trim()}」的闪卡。
        </div>
      ) : (
        <ul className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          {visible.map((card) => (
            <li key={card.id}>
              <CardTile
                card={card}
                selecting={selecting}
                checked={selected.has(card.id)}
                onToggleSelect={() => toggleSelect(card.id)}
              />
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
