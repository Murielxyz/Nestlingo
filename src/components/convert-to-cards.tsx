"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { CircleCheck, SkipForward, Sparkles, Loader2 } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { parseNote, type CardSection } from "@/lib/parse-sections";
import type { ParsedCard } from "@/lib/parse-cards";
import { detectCardLang, LANG_LABEL, LANG_ORDER, type Lang } from "@/lib/lang-detect";
import type { RecognitionRules } from "@/lib/types";
import type { FuriganaSegment } from "@/lib/furigana";

const KIND_LABEL: Record<CardSection["kind"], string> = {
  word: "生词",
  example: "例句",
  grammar: "语法",
};

const KIND_ORDER: CardSection["kind"][] = ["word", "example", "grammar"];

/** 预览里的一张卡：正面 / 背面 + 自动判断的语言（可下拉修正）。 */
type PreviewCard = { front: string; back: string; lang: Lang };
type PreviewSection = { kind: CardSection["kind"]; title: string; cards: PreviewCard[] };

/** 把识别出的卡打上语言（正面拿不稳就看背面，判不出归「其他」）。 */
function withLang(items: ParsedCard[]): PreviewCard[] {
  return items.map((c) => ({
    front: c.front,
    back: c.back,
    lang: detectCardLang({ front: c.front, back: c.back }),
  }));
}

/** 去重比较时，把正面里「（读音）」这类括号内容过滤掉，只看词本身是否相同（如「สวัสดี（sà-wàt-dii）」≈「สวัสดี」）。 */
function normalizeFront(front: string): string {
  return front
    .replace(/[（(][^（）()]*[）)]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

/** 批量给日语汉字正面补读音（汉字上方假名）：只处理含汉字的日语新卡，
 *  把该组正面用 \n 拼成一次请求，再按 \n 分段切回每张，写入 reading。
 *  失败 / 数量对不上就静默跳过（reading 留空，卡片只显示纯汉字，不影响入库）。 */
async function fillReadings(rows: { lang: Lang; front: string; reading?: string | null }[]) {
  const targets = rows.filter((r) => r.lang === "japanese" && /[一-鿿]/.test(r.front));
  if (targets.length === 0) return;
  try {
    const res = await fetch("/api/ai/furigana", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text: targets.map((t) => t.front).join("\n") }),
    });
    if (!res.ok) return;
    const data = (await res.json()) as { segments?: FuriganaSegment[] };
    if (!Array.isArray(data.segments)) return;
    const groups: FuriganaSegment[][] = [];
    let buf: FuriganaSegment[] = [];
    for (const seg of data.segments) {
      if (seg.text === "\n") {
        groups.push(buf);
        buf = [];
      } else {
        buf.push(seg);
      }
    }
    if (buf.length > 0) groups.push(buf);
    if (groups.length !== targets.length) return;
    targets.forEach((t, i) => {
      t.reading = JSON.stringify(groups[i]);
    });
  } catch {
    // 接口失败 / 网络异常都静默跳过，不阻断入库。
  }
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
  const [sections, setSections] = useState<PreviewSection[]>([]);
  const [existingFronts, setExistingFronts] = useState<Set<string>>(new Set());
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  // 默认三类全选；可取消勾选某类（如只转生词、跳过例句/语法）。
  const [selectedKinds, setSelectedKinds] = useState<Set<CardSection["kind"]>>(
    () => new Set(KIND_ORDER)
  );
  // 批量改语言下拉：整批统一设成某一种（通常整篇同一个语言），选「自动」则逐张按内容重判。
  const [batchLang, setBatchLang] = useState<string>("");
  // 「AI 补全」：逐张把新卡背面丰富成更完整解释（覆盖原释义，不限背面是否为空）。
  const [aiBusy, setAiBusy] = useState(false);
  const [aiError, setAiError] = useState<string | null>(null);
  const [aiFilled, setAiFilled] = useState<Set<string>>(new Set());

  function applyBatchLang(v: string) {
    setBatchLang(v);
    if (v === "auto") {
      setSections((prev) =>
        prev.map((s) => ({
          ...s,
          cards: s.cards.map((c) => ({
            ...c,
            lang: detectCardLang({ front: c.front, back: c.back }),
          })),
        }))
      );
    } else if (v) {
      const l = v as Lang;
      setSections((prev) =>
        prev.map((s) => ({ ...s, cards: s.cards.map((c) => ({ ...c, lang: l })) }))
      );
    }
  }

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

      // 每张卡先自动判断语言（存进预览，用户可下拉修正）。
      const preview: PreviewSection[] = secs.map((s) => ({ ...s, cards: withLang(s.cards) }));

      // 勾了「只在 callout 内识别」：只收 callout；否则把 callout 之外的表格/词表也并入「生词」。
      // 若自定义分隔规则给某张卡标了类型（例句/语法），按类型归到对应分组，而不是一律塞进「生词」。
      if (!rules?.calloutOnly && rest.length > 0) {
        for (const c of rest) {
          const kind: CardSection["kind"] = c.kind ?? "word";
          const target = preview.find((s) => s.kind === kind);
          const card = {
            front: c.front,
            back: c.back,
            lang: detectCardLang({ front: c.front, back: c.back }),
          };
          if (target) target.cards.push(card);
          else preview.push({ kind, title: KIND_LABEL[kind], cards: [card] });
        }
      }
      setSections(preview);
    })();
    return () => {
      cancelled = true;
    };
  }, [text]);

  function updateCard(si: number, ci: number, field: "front" | "back" | "lang", value: string) {
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
      lang: Lang;
      reading?: string | null;
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
          lang: c.lang,
          reading: null,
          position: pos++,
        });
      }
    }

    if (rows.length === 0) {
      setError(dupCount > 0 ? "没有新的闪卡可入库（都已存在）。" : "没有可入库的闪卡。");
      return;
    }
    // 必须先禁用按钮（saving=true），再走网络：fillReadings 要请求读音接口，可能卡好几秒；
    // 若这时按钮还开着，用户很容易点两次 → 同一张卡入库两次重复。
    if (saving) return;
    setSaving(true);
    setError(null);
    try {
      await fillReadings(rows);
      const { error } = await supabase.from("cards").insert(rows);
      if (error) {
        setError(error.message);
        return;
      }
      setDone(true);
      router.refresh();
    } finally {
      setSaving(false);
    }
  }

  // 「AI 补全」：逐张调 /api/ai/card-explain，把背面丰富成更完整解释并覆盖（不限背面是否为空）。
  async function fillAll() {
    if (aiBusy) return;
    setAiBusy(true);
    setAiError(null);
    setAiFilled(new Set());
    const targets: { si: number; ci: number; front: string; back: string; kind: string }[] = [];
    for (let si = 0; si < sections.length; si++) {
      const s = sections[si];
      for (let ci = 0; ci < s.cards.length; ci++) {
        const c = s.cards[ci];
        if (!c.front.trim() || existingFronts.has(normalizeFront(c.front))) continue;
        targets.push({ si, ci, front: c.front, back: c.back, kind: s.kind });
      }
    }
    for (const t of targets) {
      try {
        const res = await fetch("/api/ai/card-explain", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ front: t.front, back: t.back, kind: t.kind }),
          signal: AbortSignal.timeout(60_000),
        });
        const data = await res.json();
        if (!res.ok) {
          setAiError(data?.error ?? "补全失败");
          break;
        }
        const explanation = String(data?.explanation ?? "").trim();
        if (!explanation) continue;
        updateCard(t.si, t.ci, "back", explanation);
        setAiFilled((prev) => {
          const next = new Set(prev);
          next.add(t.front);
          return next;
        });
      } catch (e) {
        setAiError(e instanceof Error ? e.message : String(e));
        break;
      }
    }
    setAiBusy(false);
  }

  const summary =
    allCards.length > 0
      ? `识别出 ${allCards.length} 张${dupCount > 0 ? `，跳过重复 ${dupCount} 张` : ""}`
      : "没识别出闪卡";

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 sm:items-center sm:p-4">
      <div className="flex max-h-[88vh] w-full flex-col rounded-t-3xl bg-white shadow-xl sm:max-w-lg sm:rounded-2xl">
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
              已生成新卡片。去「闪卡」页或这篇笔记的闪卡里看看。
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

            {/* 批量改语言：通常整篇同一个语言，先一键设为该语言，再逐张微调 */}
            <div className="flex flex-wrap items-center gap-2 border-b border-zinc-100 px-4 py-2.5">
              <span className="text-xs text-zinc-400">语言：</span>
              <select
                value={batchLang}
                onChange={(e) => applyBatchLang(e.target.value)}
                className="rounded-lg border border-zinc-200 bg-white px-2 py-1 text-xs text-zinc-600 focus:border-teal-500 focus:outline-none"
              >
                <option value="">选择批量语言…</option>
                <option value="auto">按内容自动判断（逐张）</option>
                {LANG_ORDER.map((l) => (
                  <option key={l} value={l}>
                    {LANG_LABEL[l]}
                  </option>
                ))}
              </select>
              <span className="text-xs text-zinc-400">整批设为同一种语言，再逐张微调。</span>
            </div>

            {/* AI 补全：把每张新卡背面丰富成更完整解释（覆盖原释义，不限背面是否为空） */}
            <div className="flex items-center gap-2 border-b border-zinc-100 px-4 py-2">
              <button
                onClick={() => void fillAll()}
                disabled={aiBusy || newCount <= 0}
                className="inline-flex items-center gap-1.5 rounded-lg border border-teal-200 px-3 py-1.5 text-xs font-medium text-teal-700 transition-colors hover:bg-teal-50 disabled:opacity-50"
              >
                {aiBusy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Sparkles className="h-3.5 w-3.5" />}
                AI 补全
              </button>
              {aiBusy && <span className="text-xs text-zinc-400">逐张补全中…</span>}
              {!aiBusy && aiFilled.size > 0 && (
                <span className="text-xs text-teal-600">已补全 {aiFilled.size} 张</span>
              )}
              {aiError && <span className="text-xs text-red-600">{aiError}</span>}
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
                                lang={c.lang}
                                ai={aiFilled.has(c.front)}
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
  lang,
  ai,
  onChange,
  onRemove,
}: {
  front: string;
  back: string;
  lang: Lang;
  ai?: boolean;
  onChange: (field: "front" | "back" | "lang", value: string) => void;
  onRemove: () => void;
}) {
  return (
    <div className="space-y-2 rounded-xl border border-zinc-200 bg-white p-3">
      <div className="flex items-center gap-1.5">
        <input
          value={front}
          onChange={(e) => onChange("front", e.target.value)}
          placeholder="正面（要记的词）"
          className="w-full rounded-lg border border-zinc-200 bg-white px-3 py-1.5 text-sm font-medium text-zinc-900 focus:border-teal-500 focus:outline-none"
        />
        {ai && (
          <span className="shrink-0 rounded-full bg-teal-50 px-2 py-0.5 text-[10px] font-medium text-teal-600">
            AI
          </span>
        )}
      </div>
      <div className="flex items-center gap-2">
        <select
          value={lang}
          onChange={(e) => onChange("lang", e.target.value)}
          className="rounded-lg border border-zinc-200 bg-white px-2 py-1 text-xs text-zinc-600 focus:border-teal-500 focus:outline-none"
        >
          {LANG_ORDER.map((l) => (
            <option key={l} value={l}>
              {LANG_LABEL[l]}
            </option>
          ))}
        </select>
        <textarea
          value={back}
          onChange={(e) => onChange("back", e.target.value)}
          placeholder="背面（释义 / 读音，可换行加例句）"
          rows={2}
          className="w-full rounded-lg border border-zinc-200 bg-white px-3 py-1.5 text-sm text-zinc-600 focus:border-teal-500 focus:outline-none"
        />
      </div>
      <button onClick={onRemove} className="text-xs text-zinc-400 hover:text-red-600">
        删除这一张
      </button>
    </div>
  );
}
