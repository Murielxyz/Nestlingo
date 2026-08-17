"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import type { Card } from "@/lib/types";
import { SpeakButton } from "./speak-button";

/**
 * 一组卡片。
 * 默认只显示干净的翻面卡片（点一下翻面记忆）。
 * 点「☑ 选择」进入选择模式：勾选多张批量删除，或 ✏️ 单张编辑。
 * 传 noteId 时多一个「＋ 添加」手动加卡。卡片内容独立保存，与笔记不联动。
 */
export function NoteCards({ cards, noteId }: { cards: Card[]; noteId?: string }) {
  const router = useRouter();
  const [selecting, setSelecting] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [editingId, setEditingId] = useState<string | null>(null);
  const [addOpen, setAddOpen] = useState(false);
  const [newFront, setNewFront] = useState("");
  const [newBack, setNewBack] = useState("");
  const [busy, setBusy] = useState(false);

  async function addCard(e: React.FormEvent) {
    e.preventDefault();
    if (!newFront.trim()) return;
    setBusy(true);
    const supabase = createClient();
    const { error } = await supabase
      .from("cards")
      .insert({ note_id: noteId ?? null, front: newFront.trim(), back: newBack.trim() });
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
    setSelected((prev) =>
      prev.size === cards.length ? new Set() : new Set(cards.map((c) => c.id))
    );
  }

  async function deleteSelected() {
    if (selected.size === 0) return;
    if (!window.confirm(`删除选中的 ${selected.size} 张卡片？`)) return;
    const supabase = createClient();
    const { error } = await supabase
      .from("cards")
      .delete()
      .in("id", Array.from(selected));
    if (error) return;
    setSelected(new Set());
    setSelecting(false);
    router.refresh();
  }

  return (
    <div className="space-y-4">
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

        {selecting ? (
          <>
            <button
              onClick={toggleAll}
              className="rounded-lg border border-zinc-200 px-3 py-1.5 text-sm text-zinc-600 hover:bg-zinc-50"
            >
              {selected.size === cards.length ? "取消全选" : "全选"}
            </button>
            <span className="text-sm text-zinc-500">已选 {selected.size}</span>
            <button
              onClick={deleteSelected}
              disabled={selected.size === 0}
              className="rounded-lg px-3 py-1.5 text-sm font-medium text-red-600 transition-colors hover:bg-red-50 disabled:opacity-40"
            >
              删除
            </button>
            <button
              onClick={() => {
                setSelecting(false);
                setSelected(new Set());
              }}
              className="ml-auto rounded-lg bg-teal-600 px-3 py-1.5 text-sm font-semibold text-white hover:bg-teal-700"
            >
              完成
            </button>
          </>
        ) : (
          <button
            onClick={() => setSelecting(true)}
            className="rounded-lg border border-zinc-200 px-3 py-1.5 text-sm text-zinc-600 transition-colors hover:bg-zinc-50"
          >
            ☑ 选择
          </button>
        )}
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
            <> 去卡片页点「＋ 添加闪卡」生成。</>
          )}
        </div>
      ) : (
        <ul className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          {cards.map((card) => (
            <li key={card.id}>
              <CardItem
                card={card}
                selecting={selecting}
                checked={selected.has(card.id)}
                editing={editingId === card.id}
                onToggleSelect={() => toggleSelect(card.id)}
                onStartEdit={() => setEditingId(card.id)}
                onCancelEdit={() => setEditingId(null)}
              />
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function CardItem({
  card,
  selecting,
  checked,
  editing,
  onToggleSelect,
  onStartEdit,
  onCancelEdit,
}: {
  card: Card;
  selecting: boolean;
  checked: boolean;
  editing: boolean;
  onToggleSelect: () => void;
  onStartEdit: () => void;
  onCancelEdit: () => void;
}) {
  const router = useRouter();
  const [flipped, setFlipped] = useState(false);
  const [front, setFront] = useState(card.front);
  const [back, setBack] = useState(card.back ?? "");
  const [menuOpen, setMenuOpen] = useState(false);

  async function saveEdit() {
    const supabase = createClient();
    const { error } = await supabase
      .from("cards")
      .update({ front: front.trim(), back: back.trim() })
      .eq("id", card.id);
    if (!error) {
      onCancelEdit();
      router.refresh();
    }
  }

  async function deleteCard() {
    if (!window.confirm("删除这张卡片？")) return;
    const supabase = createClient();
    const { error } = await supabase
      .from("cards")
      .delete()
      .eq("id", card.id);
    if (!error) router.refresh();
  }

  if (editing) {
    return (
      <div className="space-y-2 rounded-xl border border-zinc-200 bg-white p-3">
        <input
          value={front}
          onChange={(e) => setFront(e.target.value)}
          placeholder="正面"
          className="w-full rounded-lg border border-zinc-300 px-3 py-1.5 text-sm focus:border-teal-500 focus:outline-none"
          autoFocus
        />
        <textarea
          value={back}
          onChange={(e) => setBack(e.target.value)}
          placeholder="背面（可换行加例句）"
          rows={3}
          className="w-full rounded-lg border border-zinc-300 px-3 py-1.5 text-sm focus:border-teal-500 focus:outline-none"
        />
        <div className="flex gap-3 text-sm">
          <button onClick={saveEdit} className="text-teal-600 hover:text-teal-700">
            保存
          </button>
          <button
            onClick={() => {
              setFront(card.front);
              setBack(card.back ?? "");
              onCancelEdit();
            }}
            className="text-zinc-500 hover:text-zinc-700"
          >
            取消
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="relative">
      <div
        onClick={() => (selecting ? onToggleSelect() : setFlipped((f) => !f))}
        role="button"
        tabIndex={0}
        className={`block w-full cursor-pointer rounded-xl border bg-white p-4 text-left transition-colors ${
          selecting && checked
            ? "border-teal-500 ring-2 ring-teal-200"
            : "border-zinc-200 hover:border-teal-300"
        }`}
      >
        <div className="flex items-start justify-between">
          <p className="text-[11px] uppercase tracking-wide text-zinc-400">
            {flipped ? "背面" : "正面"}
          </p>
          {selecting && (
            <span
              className={`-mr-1 -mt-1 flex h-5 w-5 items-center justify-center rounded-full border text-xs ${
                checked
                  ? "border-teal-500 bg-teal-500 text-white"
                  : "border-zinc-300 bg-white text-transparent"
              }`}
            >
              ✓
            </span>
          )}
        </div>
        <p className="mt-1 whitespace-pre-wrap text-base font-medium text-zinc-900">
          {flipped ? card.back || "（空）" : card.front}
        </p>
        <div className="mt-2 flex items-center justify-between">
          <p className="text-xs text-zinc-400">{selecting ? "点选这张" : "点击翻面"}</p>
          {!selecting && (
            <SpeakButton
              text={flipped ? card.back || card.front : card.front}
              className="rounded-md px-1.5 py-0.5 text-sm leading-none text-zinc-400 transition-colors hover:bg-zinc-100 hover:text-zinc-700"
            />
          )}
        </div>
      </div>

      {selecting && (
        <button
          onClick={onStartEdit}
          className="absolute bottom-2 right-2 rounded-md bg-white px-2 py-1 text-xs text-zinc-500 shadow-sm hover:bg-zinc-100 hover:text-zinc-700"
          aria-label="编辑卡片"
        >
          ✏️ 编辑
        </button>
      )}

      {/* 非选择模式：每张卡右上角「⋯」菜单（编辑 / 删除） */}
      {!selecting && (
        <div className="absolute right-2 top-2">
          <button
            onClick={(e) => {
              e.stopPropagation();
              setMenuOpen((v) => !v);
            }}
            className="rounded-md px-1.5 py-0.5 text-sm text-zinc-400 hover:bg-zinc-100 hover:text-zinc-700"
            aria-label="更多操作"
          >
            ⋯
          </button>
          {menuOpen && (
            <>
              <div className="fixed inset-0 z-10" onClick={() => setMenuOpen(false)} />
              <div className="absolute right-0 top-full z-20 mt-1 w-28 overflow-hidden rounded-lg border border-zinc-200 bg-white py-1 text-sm shadow-lg">
                <button
                  onClick={() => {
                    setMenuOpen(false);
                    onStartEdit();
                  }}
                  className="block w-full px-3 py-1.5 text-left text-zinc-700 hover:bg-zinc-50"
                >
                  ✏️ 编辑
                </button>
                <button
                  onClick={() => {
                    setMenuOpen(false);
                    deleteCard();
                  }}
                  className="block w-full px-3 py-1.5 text-left text-red-600 hover:bg-red-50"
                >
                  🗑 删除
                </button>
              </div>
            </>
          )}
        </div>
      )}
    </div>
  );
}
