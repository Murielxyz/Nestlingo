"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import type { Card } from "@/lib/types";
import { SpeakButton } from "./speak-button";

const KIND_LABEL: Record<string, string> = {
  word: "生词",
  example: "例句",
  grammar: "语法",
};

/**
 * 单张闪卡详情页：翻面看正反面，可编辑 / 删除。
 * 返回箭头去 `backHref`（由调用方按来源页面传进来，避免从复习/词群进来后返回错地方）。
 */
export function CardDetail({
  card,
  backHref,
}: {
  card: Card & { note_title: string | null };
  backHref: string;
}) {
  const router = useRouter();
  const [flipped, setFlipped] = useState(false);
  const [editing, setEditing] = useState(false);
  const [front, setFront] = useState(card.front);
  const [back, setBack] = useState(card.back ?? "");
  const [busy, setBusy] = useState(false);

  async function saveEdit() {
    setBusy(true);
    const supabase = createClient();
    const { error } = await supabase
      .from("cards")
      .update({ front: front.trim(), back: back.trim() })
      .eq("id", card.id);
    setBusy(false);
    if (!error) {
      setEditing(false);
      router.refresh();
    }
  }

  async function deleteCard() {
    if (!window.confirm("删除这张卡片？")) return;
    const supabase = createClient();
    const { error } = await supabase.from("cards").delete().eq("id", card.id);
    if (!error) router.replace("/cards");
  }

  return (
    <div className="mx-auto max-w-xl">
      <header className="mb-6 flex items-center gap-3">
        <Link
          href={backHref}
          className="rounded-lg px-2 py-1 text-lg text-zinc-500 transition-colors hover:bg-zinc-100 hover:text-zinc-800"
          aria-label="返回"
        >
          ←
        </Link>
        <div className="min-w-0 flex-1">
          <h1 className="text-base font-semibold text-zinc-900">闪卡</h1>
          {card.note_title && (
            <Link
              href={`/notes/${card.note_id}/cards`}
              className="block truncate text-xs text-zinc-400 transition-colors hover:text-zinc-600"
            >
              📝 {card.note_title}
            </Link>
          )}
        </div>
        {card.kind && (
          <span className="rounded-full bg-teal-50 px-2 py-0.5 text-xs font-medium text-teal-600">
            {KIND_LABEL[card.kind] ?? card.kind}
          </span>
        )}
      </header>

      {editing ? (
        <div className="space-y-3 rounded-2xl border border-zinc-200 bg-white p-5">
          <label className="block">
            <span className="mb-1 block text-xs font-medium text-zinc-500">
              正面（要记的词）
            </span>
            <input
              value={front}
              onChange={(e) => setFront(e.target.value)}
              autoFocus
              className="w-full rounded-lg border border-zinc-200 px-3 py-2 text-sm focus:border-teal-500 focus:outline-none"
            />
          </label>
          <label className="block">
            <span className="mb-1 block text-xs font-medium text-zinc-500">
              背面（释义 / 读音，可换行加例句）
            </span>
            <textarea
              value={back}
              onChange={(e) => setBack(e.target.value)}
              rows={4}
              className="w-full rounded-lg border border-zinc-200 px-3 py-2 text-sm focus:border-teal-500 focus:outline-none"
            />
          </label>
          <div className="flex gap-3 text-sm">
            <button
              onClick={saveEdit}
              disabled={busy}
              className="rounded-lg bg-teal-600 px-4 py-2 font-semibold text-white transition-colors hover:bg-teal-700 disabled:opacity-60"
            >
              保存
            </button>
            <button
              onClick={() => setEditing(false)}
              className="rounded-lg px-4 py-2 text-zinc-500 hover:text-zinc-700"
            >
              取消
            </button>
          </div>
        </div>
      ) : (
        <>
          <div className="relative">
            <button
              onClick={() => setFlipped((f) => !f)}
              className="flex min-h-[260px] w-full flex-col items-center justify-center rounded-2xl border border-zinc-200 bg-white p-8 text-center shadow-sm transition-colors hover:border-teal-300"
            >
              <p className="mb-3 text-xs uppercase tracking-wide text-zinc-400">
                {flipped ? "背面 · 答案" : "正面 · 点击翻面"}
              </p>
              <p className="whitespace-pre-wrap text-2xl font-semibold leading-relaxed text-zinc-900">
                {flipped ? card.back || "（空）" : card.front}
              </p>
            </button>
            <div className="absolute right-3 top-3">
              <SpeakButton
                text={flipped ? card.back || card.front : card.front}
              />
            </div>
          </div>

          <div className="mt-4 flex gap-2">
            <button
              onClick={() => {
                setFront(card.front);
                setBack(card.back ?? "");
                setEditing(true);
              }}
              className="flex-1 rounded-lg border border-zinc-200 px-4 py-2 text-sm text-zinc-600 transition-colors hover:bg-zinc-50"
            >
              ✏️ 编辑
            </button>
            <button
              onClick={deleteCard}
              className="flex-1 rounded-lg border border-zinc-200 px-4 py-2 text-sm text-red-600 transition-colors hover:bg-red-50"
            >
              🗑 删除
            </button>
          </div>
        </>
      )}
    </div>
  );
}
