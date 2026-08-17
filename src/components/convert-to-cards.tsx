"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { parseCards, type ParsedCard } from "@/lib/parse-cards";
import { parseSections, type CardSection } from "@/lib/parse-sections";

const KIND_LABEL: Record<"word" | "example" | "grammar", string> = {
  word: "生词",
  example: "例句",
  grammar: "语法",
};

/**
 * 「转成闪卡」弹窗：把笔记文本用规则解析成候选卡片。
 * - 笔记里有「生词 / 例句」标题时：按区域切分，分别生成「生词」「例句」两个合集（带 kind）。
 * - 没有这些标题时：维持整篇解析（向后兼容）。
 * - 顶部源文本框（仅整篇模式）可改可粘贴；卡片可编辑/删除；自动去重。
 */
export function ConvertToCards({
  noteId,
  text,
  onClose,
}: {
  noteId: string;
  text: string;
  onClose: () => void;
}) {
  const router = useRouter();
  const initialSections = useMemo(() => parseSections(text), [text]);
  // 一旦确定是「区域模式」就固定，不因预览里删空而切换回整篇。
  const [mode] = useState<"sections" | "flat">(() =>
    initialSections.length > 0 ? "sections" : "flat"
  );
  const [sections, setSections] = useState<CardSection[]>(initialSections);
  const [source, setSource] = useState(text);
  const [flat, setFlat] = useState<ParsedCard[]>(() =>
    initialSections.length > 0 ? [] : parseCards(text)
  );
  const [existingFronts, setExistingFronts] = useState<Set<string>>(new Set());
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  // 打开时拉取这篇笔记已有的卡片正面，用于去重。
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const supabase = createClient();
      const { data } = await supabase
        .from("cards")
        .select("front")
        .eq("note_id", noteId);
      if (cancelled) return;
      const fronts = new Set((data ?? []).map((c) => c.front.trim()));
      setExistingFronts(fronts);
    })();
    return () => {
      cancelled = true;
    };
  }, [noteId]);

  function reparse() {
    setFlat(parseCards(source));
    setError(null);
  }

  // —— 整篇模式（无区域标题）——
  function updateFlat(i: number, field: "front" | "back", value: string) {
    setFlat((prev) =>
      prev.map((c, idx) => (idx === i ? { ...c, [field]: value } : c))
    );
  }
  function removeFlat(i: number) {
    setFlat((prev) => prev.filter((_, idx) => idx !== i));
  }

  // —— 区域模式 ——
  function updateSectionCard(
    si: number,
    ci: number,
    field: "front" | "back",
    value: string
  ) {
    setSections((prev) =>
      prev.map((s, idx) =>
        idx === si
          ? {
              ...s,
              cards: s.cards.map((c, i) =>
                i === ci ? { ...c, [field]: value } : c
              ),
            }
          : s
      )
    );
  }
  function removeSectionCard(si: number, ci: number) {
    setSections((prev) =>
      prev.map((s, idx) =>
        idx === si ? { ...s, cards: s.cards.filter((_, i) => i !== ci) } : s
      )
    );
  }

  const allCards =
    mode === "sections"
      ? sections.flatMap((s) => s.cards)
      : flat;
  const dupCount = allCards.filter((c) => existingFronts.has(c.front.trim())).length;

  async function save() {
    const supabase = createClient();

    const rows =
      mode === "sections"
        ? (() => {
            const out: {
              note_id: string;
              front: string;
              back: string;
              kind: string;
              position: number;
            }[] = [];
            let pos = 0;
            for (const s of sections) {
              for (const c of s.cards) {
                if (!c.front.trim() || existingFronts.has(c.front.trim())) continue;
                out.push({
                  note_id: noteId,
                  front: c.front.trim(),
                  back: c.back.trim(),
                  kind: s.kind,
                  position: pos++,
                });
              }
            }
            return out;
          })()
        : flat
            .filter((c) => c.front.trim() && !existingFronts.has(c.front.trim()))
            .map((c, i) => ({
              note_id: noteId,
              front: c.front.trim(),
              back: c.back.trim(),
              position: i,
            }));

    if (rows.length === 0) {
      setError(dupCount > 0 ? "没有新的卡片可入库（都已存在）。" : "没有可入库的卡片。");
      return;
    }
    setSaving(true);
    setError(null);
    const { error } = await supabase.from("cards").insert(rows);
    setSaving(false);
    if (error) {
      setError(error.message);
      return;
    }
    setDone(true);
    router.refresh();
  }

  const summary =
    mode === "sections"
      ? sections
          .map((s) => `${KIND_LABEL[s.kind]} ${s.cards.length} 张`)
          .join(" · ")
      : `识别出 ${flat.length} 张${dupCount > 0 ? `，其中 ${dupCount} 张已存在将跳过` : ""}。`;

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 sm:items-center sm:p-4">
      <div className="flex max-h-[88vh] w-full flex-col rounded-t-2xl bg-white shadow-xl sm:max-w-lg sm:rounded-2xl">
        <header className="flex items-start justify-between border-b border-zinc-100 px-4 py-3">
          <div>
            <h2 className="text-base font-semibold text-zinc-900">转成闪卡</h2>
            <p className="mt-0.5 text-xs text-zinc-500">
              {done ? "已入库。" : summary}
            </p>
          </div>
          <button
            onClick={onClose}
            className="rounded-lg px-2 py-1 text-zinc-400 hover:bg-zinc-100 hover:text-zinc-700"
            aria-label="关闭"
          >
            ✕
          </button>
        </header>

        {done ? (
          <div className="px-4 py-10 text-center">
            <p className="text-3xl">✅</p>
            <p className="mt-3 text-sm text-zinc-700">
              已生成新卡片。去「卡片」页或这篇笔记的闪卡里看看。
            </p>
            <button
              onClick={onClose}
              className="mt-6 rounded-lg bg-teal-600 px-5 py-2 text-sm font-semibold text-white hover:bg-teal-700"
            >
              完成
            </button>
          </div>
        ) : (
          <>
            {mode === "flat" && (
              <div className="border-b border-zinc-100 px-4 py-3">
                <div className="mb-1.5 flex items-center justify-between">
                  <span className="text-xs font-medium text-zinc-500">
                    来源文本（可直接粘贴 Excel / Sheets 表格）
                  </span>
                  <button
                    onClick={reparse}
                    className="rounded-md px-2 py-1 text-xs font-medium text-teal-600 hover:bg-teal-50"
                  >
                    重新识别
                  </button>
                </div>
                <textarea
                  value={source}
                  onChange={(e) => setSource(e.target.value)}
                  rows={3}
                  className="w-full rounded-lg border border-zinc-200 bg-zinc-50 px-3 py-2 text-xs text-zinc-700 focus:border-teal-500 focus:outline-none"
                />
              </div>
            )}

            {/* 卡片预览 */}
            <div className="flex-1 space-y-3 overflow-y-auto px-4 py-3">
              {allCards.length === 0 ? (
                <div className="rounded-xl border border-dashed border-zinc-300 px-4 py-8 text-center text-sm text-zinc-500">
                  没识别出卡片。
                  <br />
                  请让内容是：每行「词 — 释义」「词：释义」「词  释义」（两个空格），
                  <br />
                  或从 Excel / Sheets 粘贴带「词汇 / 读音 / 释义」列的表格。
                </div>
              ) : mode === "flat" ? (
                flat.map((c, i) => {
                  const isDup = existingFronts.has(c.front.trim());
                  return (
                    <CardDraft
                      key={i}
                      front={c.front}
                      back={c.back}
                      isDup={isDup}
                      onChange={(field, value) => updateFlat(i, field, value)}
                      onRemove={() => removeFlat(i)}
                    />
                  );
                })
              ) : (
                sections.map((s, si) => (
                  <section key={si}>
                    <h3 className="mb-2 flex items-center gap-2 text-sm font-semibold text-zinc-700">
                      <span>{s.title}</span>
                      <span className="rounded-full bg-zinc-100 px-2 py-0.5 text-xs font-normal text-zinc-500">
                        {KIND_LABEL[s.kind]} · {s.cards.length} 张
                      </span>
                    </h3>
                    <div className="space-y-3">
                      {s.cards.map((c, ci) => {
                        const isDup = existingFronts.has(c.front.trim());
                        return (
                          <CardDraft
                            key={ci}
                            front={c.front}
                            back={c.back}
                            isDup={isDup}
                            onChange={(field, value) =>
                              updateSectionCard(si, ci, field, value)
                            }
                            onRemove={() => removeSectionCard(si, ci)}
                          />
                        );
                      })}
                    </div>
                  </section>
                ))
              )}
            </div>

            <footer className="flex gap-2 border-t border-zinc-100 px-4 py-3">
              <button
                onClick={onClose}
                className="flex-1 rounded-lg border border-zinc-200 px-4 py-2 text-sm text-zinc-600 hover:bg-zinc-50"
              >
                取消
              </button>
              <button
                onClick={save}
                disabled={saving || allCards.length - dupCount <= 0}
                className="flex-1 rounded-lg bg-teal-600 px-4 py-2 text-sm font-semibold text-white hover:bg-teal-700 disabled:opacity-60"
              >
                {saving ? "入库中…" : `确认入库 ${allCards.length - dupCount} 张`}
              </button>
            </footer>

            {error && <p className="px-4 pb-3 text-sm text-red-600">{error}</p>}
          </>
        )}
      </div>
    </div>
  );
}

function CardDraft({
  front,
  back,
  isDup,
  onChange,
  onRemove,
}: {
  front: string;
  back: string;
  isDup: boolean;
  onChange: (field: "front" | "back", value: string) => void;
  onRemove: () => void;
}) {
  return (
    <div
      className={`space-y-2 rounded-xl border p-3 ${
        isDup ? "border-dashed border-zinc-200 bg-zinc-50 opacity-60" : "border-zinc-200 bg-white"
      }`}
    >
      {isDup && (
        <p className="text-xs font-medium text-amber-600">
          ⏭ 已存在，跳过（想重新收录可改正面文字）
        </p>
      )}
      <input
        value={front}
        onChange={(e) => onChange("front", e.target.value)}
        placeholder="正面（要记的词）"
        className="w-full rounded-lg border border-zinc-200 bg-white px-3 py-1.5 text-sm font-medium text-zinc-900 focus:border-teal-500 focus:outline-none"
      />
      <textarea
        value={back}
        onChange={(e) => onChange("back", e.target.value)}
        placeholder="背面（释义 / 读音，可换行加例句）"
        rows={2}
        className="w-full rounded-lg border border-zinc-200 bg-white px-3 py-1.5 text-sm text-zinc-600 focus:border-teal-500 focus:outline-none"
      />
      <button onClick={onRemove} className="text-xs text-zinc-400 hover:text-red-600">
        删除这一张
      </button>
    </div>
  );
}
