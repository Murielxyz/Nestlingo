"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { FileText, Pencil, Sparkles } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { cardLang, LANG_LABEL, LANG_ORDER, type Lang } from "@/lib/lang-detect";
import type { Card } from "@/lib/types";
import { CardBack } from "./card-back";
import { CardFront } from "./card-front";
import { SpeakButton } from "./speak-button";
import { BackButton } from "./back-button";
import { RowMenu } from "./row-menu";

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
  const [lang, setLang] = useState<Lang>(cardLang(card));
  const [busy, setBusy] = useState(false);
  const [aiBusy, setAiBusy] = useState(false);
  const [aiError, setAiError] = useState<string | null>(null);

  async function fillBack() {
    setAiBusy(true);
    setAiError(null);
    try {
      const res = await fetch("/api/ai/card-explain", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ front, back, kind: card.kind }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "AI 解释失败");
      // 用 AI 完善后的内容填进背面输入框，用户看过可再改再保存。
      setBack(data.explanation || "");
      router.refresh();
    } catch (err) {
      setAiError(err instanceof Error ? err.message : "AI 解释失败");
    } finally {
      setAiBusy(false);
    }
  }

  async function saveEdit() {
    setBusy(true);
    const supabase = createClient();
    const { error } = await supabase
      .from("cards")
      .update({ front: front.trim(), back: back.trim(), lang })
      .eq("id", card.id);
    setBusy(false);
    if (!error) {
      setEditing(false);
      router.refresh();
    }
  }

  async function deleteCard() {
    if (!window.confirm("删除这张闪卡？")) return;
    const supabase = createClient();
    const { error } = await supabase.from("cards").delete().eq("id", card.id);
    if (!error) router.replace("/cards");
  }

  return (
    <div className="mx-auto max-w-xl">
      <header className="page-header mb-6 flex items-center gap-3">
        <BackButton fallback={backHref} />
        <div className="min-w-0 flex-1">
          <h1 className="text-base font-semibold text-zinc-900">闪卡</h1>
          {card.note_title && (
            <Link
              href={`/notes/${card.note_id}/cards`}
              className="flex items-center gap-1 truncate text-xs text-zinc-400 transition-colors hover:text-zinc-600"
            >
              <FileText className="h-3 w-3 shrink-0" />
              {card.note_title}
            </Link>
          )}
        </div>
        {card.kind && (
          <span className="rounded-full bg-teal-50 px-2 py-0.5 text-xs font-medium text-teal-600">
            {KIND_LABEL[card.kind] ?? card.kind}
          </span>
        )}
        <RowMenu
          items={[{ label: "删除", onClick: deleteCard, danger: true }]}
        />
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
            <div className="mt-2">
              <button
                type="button"
                onClick={fillBack}
                disabled={aiBusy || !front.trim()}
                className="inline-flex items-center gap-1.5 rounded-lg border border-violet-200 px-3 py-1.5 text-xs font-medium text-violet-600 transition-colors hover:bg-violet-50 disabled:opacity-60"
              >
                <Sparkles className="h-3.5 w-3.5" />
                {aiBusy ? "AI 解释中…" : "✨ AI 解释"}
              </button>
              {aiError && <p className="mt-1 text-xs text-red-600">{aiError}</p>}
              <p className="mt-1 text-xs text-zinc-400">
                让 AI 把背面补成完整解释（读音 / 释义 / 搭配 / 例句…），填进来后仍可改再保存。
              </p>
            </div>
          </label>
          <label className="block">
            <span className="mb-1 block text-xs font-medium text-zinc-500">语言</span>
            <select
              value={lang}
              onChange={(e) => setLang(e.target.value as Lang)}
              className="w-full rounded-lg border border-zinc-200 px-3 py-2 text-sm focus:border-teal-500 focus:outline-none"
            >
              {LANG_ORDER.map((l) => (
                <option key={l} value={l}>
                  {LANG_LABEL[l]}
                </option>
              ))}
            </select>
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
              <div className="w-full text-lg font-semibold leading-relaxed text-zinc-900">
                {flipped ? (
                  <CardBack back={card.back ?? ""} />
                ) : (
                  <CardFront text={card.front} reading={card.reading} />
                )}
              </div>
            </button>
            <div className="absolute right-3 top-3">
              <SpeakButton
                text={flipped ? card.back || card.front : card.front}
                lang={cardLang(card)}
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
              className="flex flex-1 items-center justify-center gap-1.5 rounded-lg border border-zinc-200 px-4 py-2 text-sm text-zinc-600 transition-colors hover:bg-zinc-50"
            >
              <Pencil className="h-4 w-4" />
              编辑
            </button>
          </div>
        </>
      )}
    </div>
  );
}
