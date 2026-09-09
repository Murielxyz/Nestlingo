"use client";

// 卡片页两种视图（按来源 / 按主题）共用的「单张闪卡」：
// 翻面展示 + 就地编辑（正面/背面）+「✨ AI 解释」按钮。
// 来源与主题都渲染它，保证两处样式、翻面、编辑、AI 解释完全一致。
// 差异项（选择、移出主题等）通过 props / footer 露出来，交调用方处理。

import { useState, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { Pencil, Sparkles, Trash2 } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import type { Card } from "@/lib/types";
import { cardLang, LANG_LABEL, LANG_COLOR, LANG_ORDER, type Lang } from "@/lib/lang-detect";
import { CardBack } from "./card-back";
import { CardFront } from "./card-front";
import { SpeakButton } from "./speak-button";

export function CardTile({
  card,
  selecting = false,
  checked = false,
  onToggleSelect,
  footer,
  menu = true,
  menuItems,
  deleteLabel = "删除",
  onDelete,
}: {
  card: Card;
  /** 选择模式（批量）：卡面变成点选，右侧出勾选框；关闭「⋯」菜单。 */
  selecting?: boolean;
  checked?: boolean;
  onToggleSelect?: () => void;
  /** 底部左侧操作区（来源：提示文字 / 主题：「移出」按钮）。默认给翻面提示。 */
  footer?: ReactNode;
  /** 是否显示右上角「⋯」菜单。默认菜单项为「编辑 / 删除」。 */
  menu?: boolean;
  /** 自定义菜单项，传了则替换默认的「编辑 / 删除」（如主题页只给「移出」）。 */
  menuItems?: { label: string; onClick: () => void; danger?: boolean }[];
  /** 「删除」菜单项文案（如错题集改「移出错题集」）。 */
  deleteLabel?: string;
  /** 覆盖默认「删除」动作（默认删除整张卡；传了则由调用方处理，如移出错题集）。 */
  onDelete?: () => void;
}) {
  const router = useRouter();
  const [flipped, setFlipped] = useState(false);
  const [editing, setEditing] = useState(false);
  const [front, setFront] = useState(card.front);
  const [back, setBack] = useState(card.back ?? "");
  const [busy, setBusy] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [aiBusy, setAiBusy] = useState(false);
  const [aiError, setAiError] = useState<string | null>(null);
  const [lang, setLang] = useState<Lang>(cardLang(card));

  function reset() {
    setFront(card.front);
    setBack(card.back ?? "");
    setLang(cardLang(card));
    setTimeout(() => setEditing(false), 0);
    setTimeout(() => setMenuOpen(false), 0);
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
    if (!error) router.refresh();
  }

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
      setBack(data.explanation || "");
      router.refresh();
    } catch (err) {
      setAiError(err instanceof Error ? err.message : "AI 解释失败");
    } finally {
      setAiBusy(false);
    }
  }

  // 编辑态：就地改正面 / 背面，操作（AI 解释 / 语言 / 取消 / 保存）右对齐同一行。
  if (editing) {
    return (
      <div className="space-y-2 rounded-xl border border-zinc-200 bg-white p-3">
        <input
          value={front}
          onChange={(e) => setFront(e.target.value)}
          placeholder="正面（要记的词）"
          autoFocus
          className="w-full rounded-lg border border-zinc-300 px-3 py-2 text-sm focus:border-teal-500 focus:outline-none placeholder:text-sm"
        />
        <textarea
          value={back}
          onChange={(e) => setBack(e.target.value)}
          placeholder="背面（释义 / 读音，可换行加例句）"
          rows={3}
          className="w-full rounded-lg border border-zinc-300 px-3 py-2 text-sm focus:border-teal-500 focus:outline-none placeholder:text-sm"
        />
        {aiError && <p className="text-xs text-red-600">{aiError}</p>}
        <div className="flex flex-wrap items-center justify-end gap-2">
          <button
            type="button"
            onClick={fillBack}
            disabled={aiBusy || !front.trim()}
            className="inline-flex items-center gap-1.5 rounded-lg border border-violet-200 px-3 py-1.5 text-xs font-medium text-violet-600 transition-colors hover:bg-violet-50 disabled:opacity-60"
          >
            <Sparkles className="h-3.5 w-3.5" />
            {aiBusy ? "AI 解释中…" : "AI 解释"}
          </button>
          <select
            value={lang}
            onChange={(e) => setLang(e.target.value as Lang)}
            title="语言"
            aria-label="语言"
            className="rounded-lg border border-zinc-300 px-2 py-1.5 text-sm focus:border-teal-500 focus:outline-none"
          >
            {LANG_ORDER.map((l) => (
              <option key={l} value={l}>
                {LANG_LABEL[l]}
              </option>
            ))}
          </select>
          <button onClick={reset} className="text-sm text-zinc-500 hover:text-zinc-700">
            取消
          </button>
          <button
            onClick={saveEdit}
            disabled={busy}
            className="text-sm font-medium text-teal-600 hover:text-teal-700 disabled:opacity-60"
          >
            {busy ? "保存中…" : "保存"}
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="relative">
      <div
        onClick={() => (selecting ? onToggleSelect?.() : setFlipped((f) => !f))}
        role="button"
        tabIndex={0}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            if (selecting) onToggleSelect?.();
            else setFlipped((f) => !f);
          }
        }}
        className={`block w-full cursor-pointer rounded-xl border bg-white p-4 text-left transition-colors ${
          selecting && checked
            ? "border-teal-500 ring-2 ring-teal-200"
            : "border-zinc-200 hover:border-teal-300"
        }`}
      >
        <div className="flex items-start justify-between">
          <div className="flex items-center gap-2">
            <p className="text-[11px] uppercase tracking-wide text-zinc-400">
              {flipped ? "背面" : "正面"}
            </p>
            <span
              className={`rounded-full px-1.5 py-0.5 text-[10px] font-medium ${LANG_COLOR[cardLang(card)]}`}
            >
              {LANG_LABEL[cardLang(card)]}
            </span>
          </div>
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

        <div className="mt-1 text-base font-medium text-zinc-900">
          {flipped ? (
            <CardBack back={card.back ?? ""} />
          ) : (
            <CardFront text={card.front} reading={card.reading} />
          )}
        </div>

        <div className="mt-2 flex items-center justify-between">
          {footer ?? (
            <p className="text-sm text-zinc-400">
              {selecting ? "点选这张" : "点击翻面"}
            </p>
          )}
          <SpeakButton
            text={flipped ? card.back || card.front : card.front}
            lang={cardLang(card)}
            className="rounded-md px-1.5 py-0.5 text-sm leading-none text-zinc-400 transition-colors hover:bg-zinc-100 hover:text-zinc-700"
          />
        </div>
      </div>

      {/* 右上角「⋯」菜单：编辑 / 删除（主题页通过 menu=false 关掉） */}
      {menu && !selecting && (
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
              <div
                className="fixed inset-0 z-10"
                onClick={() => setMenuOpen(false)}
              />
              <div className="absolute right-0 top-full z-20 mt-1 w-28 overflow-hidden rounded-lg border border-zinc-200 bg-white py-1 text-sm shadow-lg">
                {menuItems ? (
                  menuItems.map((it) => (
                    <button
                      key={it.label}
                      onClick={() => {
                        setMenuOpen(false);
                        it.onClick();
                      }}
                      className={`flex w-full items-center gap-1.5 px-3 py-2 text-left ${
                        it.danger ? "text-red-600 hover:bg-red-50" : "text-zinc-700 hover:bg-zinc-50"
                      }`}
                    >
                      {it.label}
                    </button>
                  ))
                ) : (
                  <>
                    <button
                      onClick={() => {
                        setMenuOpen(false);
                        setEditing(true);
                      }}
                      className="flex w-full items-center gap-1.5 px-3 py-2 text-left text-zinc-700 hover:bg-zinc-50"
                    >
                      <Pencil className="h-3.5 w-3.5" /> 编辑
                    </button>
                    <button
                      onClick={() => {
                        setMenuOpen(false);
                        if (onDelete) onDelete();
                        else deleteCard();
                      }}
                      className="flex w-full items-center gap-1.5 px-3 py-2 text-left text-red-600 hover:bg-red-50"
                    >
                      <Trash2 className="h-3.5 w-3.5" /> {deleteLabel}
                    </button>
                  </>
                )}
              </div>
            </>
          )}
        </div>
      )}
    </div>
  );
}
