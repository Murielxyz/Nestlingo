"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { CircleCheck, SkipForward } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { parseNote, type CardSection } from "@/lib/parse-sections";
import type { RecognitionRules } from "@/lib/types";

const KIND_LABEL: Record<CardSection["kind"], string> = {
  word: "生词",
  example: "例句",
  grammar: "语法",
};

const KIND_ORDER: CardSection["kind"][] = ["word", "example", "grammar"];

/** 去重比较时，把正面里「（读音）」这类括号内容过滤掉，只看词本身是否相同（如「สวัสดี（sà-wàt-dii）」≈「สวัสดี」）。 */
function normalizeFront(front: string): string {
  return front
    .replace(/[（(][^（）()]*[）)]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * 「转成闪卡」弹窗：把笔记文本按识别规则解析成候选卡片。
 * - 笔记里的「生词 / 例句 / 语法」callout → 各自一组（带 kind）。
 * - callout 之外的表格 / 「词—释义」行 → 归入「生词」组（普通段落跳过）。
 * - 同类的多个区块合并成一组；勾了「只识别 callout」则只收 callout 内的内容。
 * - 卡片可编辑/删除，自动去重（已存在的正面会跳过）。
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
  const [sections, setSections] = useState<CardSection[]>([]);
  const [existingFronts, setExistingFronts] = useState<Set<string>>(new Set());
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  // 默认三类全选；可取消勾选某类（如只转生词、跳过例句/语法）。
  const [selectedKinds, setSelectedKinds] = useState<Set<CardSection["kind"]>>(
    () => new Set(KIND_ORDER)
  );

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
      const fronts = new Set((data ?? []).map((c) => normalizeFront(c.front)));
      setExistingFronts(fronts);
    })();
    return () => {
      cancelled = true;
    };
  }, [noteId]);

  // 打开时拉取识别规则并解析笔记文本。
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const supabase = createClient();
      const { data } = await supabase
        .from("user_settings")
        .select("recognition_rules")
        .limit(1)
        .maybeSingle();
      if (cancelled) return;
      const rules = (data?.recognition_rules ?? null) as RecognitionRules | null;
      const { sections: secs, rest } = parseNote(text, rules);

      // 勾了「只在 callout 内识别」：只收 callout；否则把 callout 之外的表格/词表也并入「生词」。
      // 若自定义分隔规则给某张卡标了类型（例句/语法），按类型归到对应分组，而不是一律塞进「生词」。
      if (!rules?.calloutOnly && rest.length > 0) {
        for (const c of rest) {
          const kind: CardSection["kind"] = c.kind ?? "word";
          const target = secs.find((s) => s.kind === kind);
          if (target) target.cards.push(c);
          else secs.push({ kind, title: KIND_LABEL[kind], cards: [c] });
        }
      }
      setSections(secs);
    })();
    return () => {
      cancelled = true;
    };
  }, [text]);

  function updateCard(si: number, ci: number, field: "front" | "back", value: string) {
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

  function removeCard(si: number, ci: number) {
    setSections((prev) =>
      prev.map((s, idx) =>
        idx === si ? { ...s, cards: s.cards.filter((_, i) => i !== ci) } : s
      )
    );
  }

  function toggleKind(kind: CardSection["kind"]) {
    setSelectedKinds((prev) => {
      const next = new Set(prev);
      if (next.has(kind)) next.delete(kind);
      else next.add(kind);
      return next;
    });
  }

  const visibleSections = sections.filter((s) => selectedKinds.has(s.kind));
  const allCards = visibleSections.flatMap((s) => s.cards);
  const dupCount = allCards.filter((c) => existingFronts.has(normalizeFront(c.front))).length;
  const newCount = allCards.length - dupCount;

  async function save() {
    const supabase = createClient();
    const rows: {
      note_id: string;
      front: string;
      back: string;
      kind: CardSection["kind"];
      position: number;
    }[] = [];
    let pos = 0;
    for (const s of visibleSections) {
      for (const c of s.cards) {
        if (!c.front.trim() || existingFronts.has(normalizeFront(c.front))) continue;
        rows.push({
          note_id: noteId,
          front: c.front.trim(),
          back: c.back.trim(),
          kind: s.kind,
          position: pos++,
        });
      }
    }

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
    allCards.length > 0
      ? `识别出 ${allCards.length} 张${dupCount > 0 ? `，跳过重复 ${dupCount} 张` : ""}`
      : "没识别出卡片";

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 sm:items-center sm:p-4">
      <div className="flex max-h-[88vh] w-full flex-col rounded-t-2xl bg-white shadow-xl sm:max-w-lg sm:rounded-2xl">
        <header className="flex items-start justify-between border-b border-zinc-100 px-4 py-3">
          <div>
            <h2 className="text-base font-semibold text-zinc-900">转成闪卡</h2>
            <p className="mt-0.5 text-xs text-zinc-500">{done ? "已入库。" : summary}</p>
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
            <CircleCheck className="mx-auto h-10 w-10 text-teal-500" />
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
            {/* 按类型勾选要收录的卡片（生词/例句/语法，默认全选，可取消某类） */}
            <div className="flex flex-wrap items-center gap-1.5 border-b border-zinc-100 px-4 py-2.5">
              <span className="mr-1 text-xs text-zinc-400">收录类型：</span>
              {KIND_ORDER.map((kind) => {
                const sec = sections.find((s) => s.kind === kind);
                if (!sec || sec.cards.length === 0) return null;
                const cnt = sec.cards.filter(
                  (c) => !existingFronts.has(normalizeFront(c.front))
                ).length;
                const active = selectedKinds.has(kind);
                return (
                  <button
                    key={kind}
                    onClick={() => toggleKind(kind)}
                    className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs transition-colors ${
                      active
                        ? "border-teal-500 bg-teal-50 text-teal-700"
                        : "border-zinc-200 bg-white text-zinc-400"
                    }`}
                  >
                    <span
                      className={`flex h-3.5 w-3.5 items-center justify-center rounded-full border text-[10px] ${
                        active
                          ? "border-teal-500 bg-teal-500 text-white"
                          : "border-zinc-300 bg-white text-transparent"
                      }`}
                    >
                      ✓
                    </span>
                    {KIND_LABEL[kind]} {cnt}
                  </button>
                );
              })}
            </div>

            {/* 卡片预览（按生词/例句/语法分组，已存在的正面不再逐张展示） */}
            <div className="flex-1 space-y-3 overflow-y-auto px-4 py-3">
              {allCards.length === 0 ? (
                <div className="rounded-xl border border-dashed border-zinc-300 px-4 py-8 text-center text-sm text-zinc-500">
                  没识别出卡片。
                  <br />
                  请让内容是：每行「词 — 释义」「词：释义」「词  释义」（两个空格），
                  <br />
                  从 Excel / Sheets 粘贴带「词汇 / 释义」列的表格，
                  <br />
                  或用工具栏的「生词 / 例句 / 语法」块框住内容。
                  <br />
                  整篇文章、两栏原文/译文不会被转成卡片。
                </div>
              ) : newCount === 0 ? (
                <div className="rounded-xl border border-dashed border-zinc-300 px-4 py-8 text-center text-sm text-zinc-500">
                  识别出的 {allCards.length} 张都已在库里（正面文字已存在），没有新卡片。
                </div>
              ) : (
                <>
                  {dupCount > 0 && (
                    <p className="flex items-center gap-1.5 rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-700">
                      <SkipForward className="h-3.5 w-3.5 shrink-0" />
                      已跳过 {dupCount} 张重复（正面文字已存在，无需重复收录）。
                    </p>
                  )}
                  {visibleSections.map((s, si) => {
                    const newCards = s.cards.filter(
                      (c) => !existingFronts.has(normalizeFront(c.front))
                    );
                    if (newCards.length === 0) return null;
                    return (
                      <section key={`${s.kind}-${si}`}>
                        <h3 className="mb-2 flex items-center gap-2 text-sm font-semibold text-zinc-700">
                          <span>{s.title}</span>
                          <span className="rounded-full bg-zinc-100 px-2 py-0.5 text-xs font-normal text-zinc-500">
                            {KIND_LABEL[s.kind]} · {newCards.length} 张
                          </span>
                        </h3>
                        <div className="space-y-3">
                          {s.cards.map((c, ci) => {
                            if (existingFronts.has(normalizeFront(c.front))) return null;
                            return (
                              <CardDraft
                                key={ci}
                                front={c.front}
                                back={c.back}
                                onChange={(field, value) => updateCard(si, ci, field, value)}
                                onRemove={() => removeCard(si, ci)}
                              />
                            );
                          })}
                        </div>
                      </section>
                    );
                  })}
                </>
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
                disabled={saving || newCount <= 0}
                className="flex-1 rounded-lg bg-teal-600 px-4 py-2 text-sm font-semibold text-white hover:bg-teal-700 disabled:opacity-60"
              >
                {saving ? "入库中…" : `确认入库 ${newCount} 张`}
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
  onChange,
  onRemove,
}: {
  front: string;
  back: string;
  onChange: (field: "front" | "back", value: string) => void;
  onRemove: () => void;
}) {
  return (
    <div className="space-y-2 rounded-xl border border-zinc-200 bg-white p-3">
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
