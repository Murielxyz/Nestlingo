"use client";

import { useMemo, useRef, useState } from "react";
import { Sparkles, X, BookOpen, RotateCcw, Volume2, Square } from "lucide-react";
import { speakParagraph } from "@/lib/speech";
import { detectLang } from "@/lib/lang-detect";

/** 故事模式里的一张卡（只用 front/back，id 仅作 key）。 */
export type StoryCard = {
  id: string;
  front: string;
  back: string | null;
};

/** 洗牌（原地拷贝，不改原数组）。 */
function shuffle<T>(arr: T[]): T[] {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

/**
 * 故事模式：从「当前合集」里勾选几张生词，让 AI 编一段连贯短文。
 * 生词在文里用【】包起来，前端渲染成可点击的高亮词，点一下弹出对应的闪卡（正面词 + 背面释义）。
 * 不加朗读（浏览器 TTS 对韩语等读得很怪，真人化朗读后续单独做）。
 */
export function StoryMode({ cards }: { cards: StoryCard[] }) {
  // 预选最多 8 张（随机），方便一键生成；也可手动勾选/清空。
  const [selected, setSelected] = useState<Set<string>>(
    () => new Set(shuffle(cards).slice(0, 8).map((c) => c.id))
  );
  const [story, setStory] = useState<string | null>(null);
  const [translation, setTranslation] = useState<string | null>(null);
  const [showTranslation, setShowTranslation] = useState(false);
  const [usedCards, setUsedCards] = useState<StoryCard[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [activeWord, setActiveWord] = useState<string | null>(null);
  const [speaking, setSpeaking] = useState(false);
  const stopRef = useRef<(() => void) | null>(null);

  // 词 → 卡 的映射（AI 把 front 原样括进【】，点击时按词找回释义）。
  const wordMap = useMemo(() => {
    const m = new Map<string, StoryCard>();
    for (const c of usedCards) m.set(c.front, c);
    return m;
  }, [usedCards]);

  function toggle(id: string) {
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

  async function generate() {
    const chosen = cards.filter((c) => selected.has(c.id));
    if (chosen.length === 0) return;
    stopRef.current?.();
    stopRef.current = null;
    setSpeaking(false);
    setBusy(true);
    setError(null);
    setStory(null);
    setTranslation(null);
    setShowTranslation(false);
    setActiveWord(null);
    try {
      const res = await fetch("/api/ai/story", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          cards: chosen.map((c) => ({ front: c.front, back: c.back ?? "" })),
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "生成失败");
      setUsedCards(chosen);
      setStory(data.story);
      setTranslation(data.translation ?? null);
      setShowTranslation(false);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  function toggleRead() {
    if (speaking) {
      stopRef.current?.();
      stopRef.current = null;
      setSpeaking(false);
      return;
    }
    if (!story) return;
    const plain = story.replace(/【|】/g, "");
    let lang = detectLang(plain);
    if (lang === "other") lang = detectLang(usedCards[0]?.front ?? "");
    stopRef.current = speakParagraph(plain, lang, () => setSpeaking(false));
    if (stopRef.current) setSpeaking(true);
  }

  // 把正文里的【词】拆成「普通文本 / 可点击词」片段。
  function renderStory(text: string) {
    const parts = text.split(/(【[^】]+】)/g);
    return parts.map((p, i) => {
      const m = p.match(/^【([^】]+)】$/);
      if (!m) return <span key={i}>{p}</span>;
      const word = m[1];
      const card = wordMap.get(word);
      return card ? (
        <button
          key={i}
          onClick={() => setActiveWord(word)}
          className="mx-0.5 rounded bg-teal-50 px-1 font-semibold text-teal-700 underline decoration-teal-300 underline-offset-2 transition-colors hover:bg-teal-100"
        >
          {word}
        </button>
      ) : (
        <span key={i} className="font-semibold text-teal-700">
          {word}
        </span>
      );
    });
  }

  if (cards.length === 0) {
    return (
      <div className="mx-auto max-w-xl rounded-2xl border border-dashed border-zinc-300 px-6 py-12 text-center">
        <BookOpen className="mx-auto h-10 w-10 text-zinc-300" />
        <p className="mt-3 text-sm text-zinc-500">
          这个合集里没有可编故事的生词，先去转成闪卡或换个合集。
        </p>
      </div>
    );
  }

  // ===== 已生成：显示故事 =====
  if (story) {
    return (
      <div className="mx-auto max-w-xl">
        <div className="card-soft p-5">
          <div className="flex items-center justify-between gap-3">
            <p className="text-sm text-zinc-600">
              用 <span className="font-semibold text-teal-700">{usedCards.length}</span>{" "}
              个生词编的故事：
            </p>
            <button
              onClick={toggleRead}
              className="inline-flex shrink-0 items-center gap-1.5 rounded-lg border border-teal-200 px-3 py-1.5 text-sm font-medium text-teal-600 transition-colors hover:bg-teal-50"
            >
              {speaking ? <Square className="h-4 w-4" /> : <Volume2 className="h-4 w-4" />}
              {speaking ? "停止" : "朗读"}
            </button>
          </div>
          <div className="mt-3 rounded-xl bg-white p-4">
            <p className="text-base leading-loose text-zinc-900">
              {renderStory(story)}
            </p>
          </div>

          {translation && (
            <div className="mt-3">
              <button
                onClick={() => setShowTranslation((v) => !v)}
                className="inline-flex items-center gap-1.5 rounded-lg border border-zinc-200 px-3 py-1.5 text-sm font-medium text-zinc-600 transition-colors hover:bg-zinc-50"
              >
                {showTranslation ? "隐藏翻译" : "查看翻译"}
              </button>
              {showTranslation && (
                <p className="mt-2 rounded-xl bg-teal-50/60 px-4 py-3 text-sm leading-relaxed text-zinc-600">
                  {translation}
                </p>
              )}
            </div>
          )}

          <p className="mt-3 text-xs text-zinc-400">点击高亮的生词，查看它的闪卡。</p>
          <div className="mt-4 flex gap-2">
            <button
              onClick={() => {
                stopRef.current?.();
                stopRef.current = null;
                setSpeaking(false);
                setStory(null);
                setTranslation(null);
                setShowTranslation(false);
                setActiveWord(null);
              }}
              className="inline-flex flex-1 items-center justify-center gap-1.5 rounded-xl border border-zinc-200 px-4 py-2 text-sm text-zinc-600 transition-colors hover:bg-zinc-50"
            >
              <RotateCcw className="h-4 w-4" />
              重新选词
            </button>
            <button
              onClick={generate}
              disabled={busy}
              className="btn-brand flex-1 disabled:opacity-60"
            >
              <Sparkles className="h-4 w-4" />
              {busy ? "生成中…" : "换一篇"}
            </button>
          </div>
        </div>

        {error && (
          <div className="mt-4 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
            {error}
          </div>
        )}

        {/* 点词弹出的闪卡 */}
        {activeWord && (
          <div
            className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
            onClick={() => setActiveWord(null)}
          >
            <div
              className="w-full max-w-sm rounded-2xl bg-white p-5 shadow-xl"
              onClick={(e) => e.stopPropagation()}
            >
              <div className="flex items-start justify-between gap-3">
                <p className="text-xl font-bold leading-snug text-zinc-900">
                  {activeWord}
                </p>
                <button
                  onClick={() => setActiveWord(null)}
                  className="rounded-lg p-1.5 text-zinc-400 hover:bg-zinc-100 hover:text-zinc-700"
                  aria-label="关闭"
                >
                  <X className="h-4 w-4" />
                </button>
              </div>
              <p className="mt-2 whitespace-pre-wrap text-sm leading-relaxed text-zinc-600">
                {wordMap.get(activeWord)?.back || "（无释义）"}
              </p>
            </div>
          </div>
        )}
      </div>
    );
  }

  // ===== 选择阶段：勾选要编进故事的词 =====
  return (
    <div className="mx-auto max-w-xl">
      <div className="card-soft p-5">
        <div className="flex items-center justify-between gap-3">
          <p className="text-sm text-zinc-600">
            勾选要编进故事的词（已选{" "}
            <span className="font-semibold text-teal-700">{selected.size}</span>{" "}
            个）
          </p>
          <button
            onClick={toggleAll}
            className="text-sm text-teal-600 transition-colors hover:text-teal-700"
          >
            {selected.size === cards.length ? "清空" : "全选"}
          </button>
        </div>

        <div className="mt-3 max-h-80 space-y-1.5 overflow-y-auto pr-1">
          {cards.map((c) => {
            const on = selected.has(c.id);
            return (
              <button
                key={c.id}
                onClick={() => toggle(c.id)}
                className={`flex w-full items-center gap-3 rounded-lg border px-3 py-2 text-left transition-colors ${
                  on
                    ? "border-teal-300 bg-teal-50"
                    : "border-zinc-200 bg-white hover:border-teal-200"
                }`}
              >
                <span
                  className={`shrink-0 text-sm font-semibold ${
                    on ? "text-teal-600" : "text-zinc-300"
                  }`}
                >
                  {on ? "✓" : "○"}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-medium text-zinc-900">
                    {c.front}
                  </span>
                  <span className="block truncate text-xs text-zinc-500">
                    {c.back || ""}
                  </span>
                </span>
              </button>
            );
          })}
        </div>

        <button
          onClick={generate}
          disabled={busy || selected.size === 0}
          className="btn-brand mt-4 w-full disabled:opacity-60"
        >
          <Sparkles className="h-4 w-4" />
          {busy ? "生成中…" : `生成故事（${selected.size}）`}
        </button>
      </div>

      {error && (
        <div className="mt-4 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
          {error}
        </div>
      )}
    </div>
  );
}
