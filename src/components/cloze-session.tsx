"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { ArrowRight, Eye, Sparkles, Loader2 } from "lucide-react";
import type { ReviewItem } from "@/lib/supabase/queries";
import {
  buildClozeItems,
  normalizeAnswer,
  parseAiCloze,
  type ClozeItem,
  type MissingWord,
} from "@/lib/cloze";
import { SpeakButton } from "./speak-button";
import { BackButton } from "./back-button";

/**
 * 完形填空会话：显示一句把某个生词挖掉的句子，你填词或点「显示答案」，
 * 揭示后直接「下一题」——纯练习，不计 SM-2、不改到期。
 * 有现成语境句的就用（只挖目标词本身）；没有的让 AI 现造一句（带小「AI」标识）。
 * 由 `buildClozeItems` 出题，整组卡都没有生词时给出提示。
 */
export function ClozeSession({
  items,
  dailyGoal = 20,
  backHref = "/review",
}: {
  items: ReviewItem[];
  dailyGoal?: number;
  backHref?: string;
}) {
  const [value, setValue] = useState("");
  const [revealed, setRevealed] = useState(false);
  const [shown, setShown] = useState(false); // 点了「显示答案」：只把空填上，还没进整句
  const [correct, setCorrect] = useState<boolean | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const [reviewed, setReviewed] = useState(0);
  const [queue, setQueue] = useState<ClozeItem[] | null>(null); // null = 正在出题
  const [total, setTotal] = useState(0);
  // 没有现成例句的生词：先进来不调 AI（省 token），等用户点「用 AI 造例句」再生成。
  const [missingWords, setMissingWords] = useState<MissingWord[]>([]);
  const [aiError, setAiError] = useState<string | null>(null);
  const [aiBusy, setAiBusy] = useState(false);

  // 整组卡里有没有「生词」卡（不够也没法挖空，直接提示）。
  const hasWords = useMemo(
    () =>
      items.some((it) => {
        const f = it.card.front?.trim() ?? "";
        return f && (it.card.kind === "word" || (it.card.kind === null && !/\s/.test(f)));
      }),
    [items]
  );

  // 初次进入：只用「能挖空」的卡出题，不自动调 AI（省 token）。
  // 缺例句的生词记进 missingWords，等用户手动点「用 AI 造例句」再生成。
  useEffect(() => {
    const { items: base, missing } = buildClozeItems(items);
    setMissingWords(missing);
    setTotal(base.length);
    setQueue(base.slice(0, dailyGoal));
  }, [items, dailyGoal]);

  // 重新出题：重置全部会话状态并重新构建队列。
  function restart() {
    const { items: base, missing } = buildClozeItems(items);
    setMissingWords(missing);
    setTotal(base.length);
    setQueue(base.slice(0, dailyGoal));
    setReviewed(0);
    setValue("");
    setRevealed(false);
    setShown(false);
    setCorrect(null);
    setAiError(null);
  }

  // 手动给没语境句的生词生成例句：点按钮才调 AI，造完追加到队列里。
  async function generateMissing() {
    if (missingWords.length === 0) return;
    setAiBusy(true);
    setAiError(null);
    try {
      const res = await fetch("/api/ai/cloze-examples", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          items: missingWords.map((m) => ({ word: m.word, lang: m.lang, meaning: m.meaning })),
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error ?? "AI 生成例句失败");
      const byWord = new Map<string, { sentence: string; translation?: string }>(
        (data?.examples ?? []).map((e: Record<string, unknown>) => [
          String(e.word ?? ""),
          {
            sentence: String(e.sentence ?? ""),
            translation: typeof e.translation === "string" ? e.translation : undefined,
          },
        ])
      );
      const ai = missingWords
        .map((m) => {
          const ex = byWord.get(m.word);
          return ex ? parseAiCloze(ex.sentence, m, ex.translation ?? "") : null;
        })
        .filter((x): x is ClozeItem => x != null);
      setMissingWords([]); // 造完清掉，按钮收起、避免重复生成。
      setQueue((q) => [...(q ?? []), ...ai]);
      setTotal((t) => t + ai.length);
    } catch (e) {
      setAiError(e instanceof Error ? e.message : "AI 生成例句失败");
    } finally {
      setAiBusy(false);
    }
  }

  // 点「显示答案」把空填上后，聚焦到输入框，方便照着抄再核对。
  useEffect(() => {
    if (shown) inputRef.current?.focus();
  }, [shown]);

  // 「缺例句的生词」提示 + 「用 AI 造例句」按钮 + AI 报错：空队列（全组无例句）和正常出题时都要显示。
  const missingPanel = (missingWords.length > 0 || aiError) && (
    <>
      {missingWords.length > 0 && (
        <div className="mb-3 flex items-center justify-between gap-2 rounded-xl border border-violet-200 bg-violet-50 px-3 py-2 text-sm text-violet-700">
          <span className="inline-flex items-center gap-1.5">
            <Sparkles className="h-4 w-4 shrink-0" />
            <span className="min-w-0">
              {aiBusy
                ? "正在用 AI 给缺例句的生词造句子…"
                : `有 ${missingWords.length} 个生词没有现成例句`}
            </span>
          </span>
          <button
            onClick={generateMissing}
            disabled={aiBusy}
            className="inline-flex shrink-0 items-center gap-1 rounded-lg bg-violet-600 px-3 py-1.5 text-xs font-semibold text-white transition-colors hover:bg-violet-700 disabled:opacity-60"
          >
            {aiBusy ? "AI 造句中…" : "用 AI 造例句"}
          </button>
        </div>
      )}
      {aiError && (
        <p className="mb-3 rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-600">
          {aiError}
        </p>
      )}
    </>
  );

  if (!hasWords) {
    return (
      <div className="rounded-2xl border border-zinc-200 bg-white px-6 py-16 text-center">
        <p className="text-lg font-semibold text-zinc-900">没有可挖空的生词</p>
        <p className="mt-1 text-sm text-zinc-500">
          这组卡里没有生词卡，完形填空无从出题。可先去笔记给生词转闪卡，或改用问答方式学习。
        </p>
        <div className="mt-6 flex justify-center">
          <BackButton
            fallback={backHref}
            className="rounded-lg border border-zinc-200 px-4 py-2 text-sm text-zinc-600 hover:bg-zinc-50"
          >
            返回
          </BackButton>
        </div>
      </div>
    );
  }

  if (queue === null) {
    return (
      <div className="rounded-2xl border border-zinc-200 bg-white px-6 py-16 text-center">
        <Loader2 className="mx-auto h-8 w-8 animate-spin text-teal-500" />
        <p className="mt-4 text-sm text-zinc-500">正在出题…</p>
      </div>
    );
  }

  const current = queue[0];

  if (!current) {
    // 队列空了：若还有「没例句的生词」，说明整组都没现成例句——保留「用 AI 造例句」入口，
    // 生成后追加进队列继续练；真没生词可练才算完成。
    if (missingWords.length > 0) {
      return (
        <div className="mx-auto max-w-xl">
          {missingPanel}
          <div className="rounded-2xl border border-zinc-200 bg-white px-6 py-16 text-center">
            <p className="text-lg font-semibold text-zinc-900">这些生词还没有例句</p>
            <p className="mt-1 text-sm text-zinc-500">
              点上方「用 AI 造例句」生成后再练习，或直接返回。
            </p>
            <div className="mt-6 flex justify-center">
              <BackButton
                fallback={backHref}
                className="rounded-lg border border-zinc-200 px-4 py-2 text-sm text-zinc-600 hover:bg-zinc-50"
              >
                返回
              </BackButton>
            </div>
          </div>
        </div>
      );
    }
    return (
      <div className="rounded-2xl border border-zinc-200 bg-white px-6 py-16 text-center">
        <p className="text-lg font-semibold text-zinc-900">本轮完形填空完成！</p>
        <p className="mt-1 text-sm text-zinc-500">
          {aiError
            ? `共学 ${reviewed} 道（AI 没生成成功，部分生词被略过）。`
            : `共学 ${reviewed} 道。`}
        </p>
        <div className="mt-6 flex justify-center gap-2">
          <button
            onClick={restart}
            className="rounded-lg bg-teal-600 px-4 py-2 text-sm font-semibold text-white hover:bg-teal-700"
          >
            再来一次
          </button>
          <BackButton
            fallback={backHref}
            className="rounded-lg border border-zinc-200 px-4 py-2 text-sm text-zinc-600 hover:bg-zinc-50"
          >
            返回
          </BackButton>
        </div>
      </div>
    );
  }

  function advance() {
    setReviewed((n) => n + 1);
    setQueue((q) => q!.slice(1));
    setValue("");
    setRevealed(false);
    setShown(false);
    setCorrect(null);
  }

  function check() {
    if (revealed) return;
    // 显示答案后也要比对：没打字（空）、打错的都判 ✗，不直接进整句。
    setCorrect(normalizeAnswer(value) === normalizeAnswer(current.answer));
    setRevealed(true);
  }

  function toggleAnswer() {
    if (revealed) return;
    setShown((s) => !s);
  }

  // 答后展示：把答案词在原句里高亮（保留原句其余内容）。
  const answerStart = (() => {
    const i = current.sentence.toLowerCase().indexOf(current.answer.toLowerCase());
    return i >= 0 ? i : 0;
  })();
  const fullSentence = (
    <>
      {current.sentence.slice(0, answerStart)}
      <span className="rounded bg-teal-100 px-1 text-teal-700">{current.answer}</span>
      {current.sentence.slice(answerStart + current.answer.length)}
    </>
  );

  // 「显示答案」只把挖空处填上（仍在答题态），不切换成整句。
  const blankIdx = current.prompt.indexOf("＿＿＿＿");
  const filledPrompt =
    blankIdx >= 0 ? (
      <>
        {current.prompt.slice(0, blankIdx)}
        <span className="rounded bg-teal-100 px-1 text-teal-700">{current.answer}</span>
        {current.prompt.slice(blankIdx + 4)}
      </>
    ) : (
      current.prompt
    );

  return (
    <div className="mx-auto max-w-xl">
      {/* 进度 */}
      <div className="mb-4 flex items-center justify-between text-sm text-zinc-500">
        <span>已学 {reviewed} 道 · 待学 {queue.length} 道</span>
      </div>

      {/* 有生词缺例句时：主动提示，点按钮才调 AI（省 token） */}
      {missingPanel}

      {/* 题目：挖空句 + 输入 / 揭示 */}
      <div className="rounded-2xl border border-zinc-200 bg-white p-6 shadow-sm">
        <div className="mb-3 flex items-center justify-between gap-2">
          <p className="flex items-center gap-2 text-xs uppercase tracking-wide text-zinc-400">
            {revealed ? "完整句子" : "完形填空 · 填入缺失的词"}
            {current.aiGenerated && (
              <span
                className="inline-flex items-center gap-0.5 rounded-full bg-zinc-50 px-1.5 py-0.5 text-[10px] font-normal not-italic normal-case tracking-normal text-zinc-400"
                title="这句例句由 AI 生成"
              >
                <Sparkles className="h-3 w-3" />
                AI
              </span>
            )}
          </p>
          {/* 喇叭放在标签行右侧，不再绝对定位压住句子文字 */}
          <SpeakButton text={revealed ? current.sentence : current.prompt} />
        </div>

        <div className="min-h-[80px]">
          <p className="text-xl font-medium leading-relaxed text-zinc-900">
            {revealed ? fullSentence : shown ? filledPrompt : current.prompt}
          </p>
          {/* 译文紧跟挖空句下方（答前、答后都在） */}
          {current.translation && (
            <p className="mt-2 text-sm leading-relaxed text-zinc-500">
              <span className="mr-1.5 inline-flex rounded bg-white px-1.5 py-0.5 text-[11px] font-medium text-zinc-400 shadow-sm">
                译
              </span>
              {current.translation}
            </p>
          )}
        </div>

        {/* 空格词的意思（答前猜什么、答后核对用） */}
        {current.meaning && (
          <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1.5 rounded-xl bg-zinc-50 px-3 py-2 text-sm">
            <span className="inline-flex items-center gap-1.5 text-zinc-600">
              <span className="rounded bg-teal-50 px-1.5 py-0.5 text-[11px] font-medium text-teal-600">
                词义
              </span>
              {current.meaning}
            </span>
          </div>
        )}
        {revealed && current.hint && (
          <p className="mt-2 text-xs font-medium text-teal-600">{current.hint}</p>
        )}

        {!revealed ? (
          <div className="mt-5 space-y-2">
            <div className="flex gap-2">
              <input
                ref={inputRef}
                value={value}
                onChange={(e) => setValue(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") check();
                }}
                placeholder={shown ? "照着空再打一遍" : "输入缺失的词"}
                className="min-w-0 flex-1 rounded-xl border border-zinc-200 px-3 py-2 text-sm placeholder:text-sm focus:border-teal-500 focus:outline-none"
              />
              <button
                onClick={check}
                className="shrink-0 rounded-xl bg-teal-600 px-5 py-2 text-sm font-semibold text-white transition-colors hover:bg-teal-700"
              >
                核对
              </button>
            </div>
            <button
              onClick={toggleAnswer}
              className={`inline-flex w-full items-center justify-center gap-1.5 rounded-xl border px-4 py-2 text-sm font-medium transition-colors ${
                shown
                  ? "border-teal-200 bg-teal-50 text-teal-700 hover:bg-teal-100"
                  : "border-zinc-200 text-zinc-600 hover:bg-zinc-50"
              }`}
            >
              <Eye className="h-4 w-4" />
              {shown ? "隐藏答案" : "显示答案"}
            </button>
          </div>
        ) : (
          <div className="mt-3 text-sm">
            {correct === true ? (
              <p className="font-medium text-emerald-600">✓ 正确</p>
            ) : correct === false ? (
              <p className="font-medium text-red-600">✗ 正确答案：{current.answer}</p>
            ) : null}
          </div>
        )}
      </div>

      {/* 揭示后：直接下一题（不计记忆曲线） */}
      {revealed && (
        <button
          onClick={advance}
          className="mt-5 inline-flex w-full items-center justify-center gap-1.5 rounded-xl bg-teal-600 px-4 py-3 text-sm font-semibold text-white transition-colors hover:bg-teal-700"
        >
          {queue.length > 1 ? "下一题" : "完成"}
          <ArrowRight className="h-4 w-4" />
        </button>
      )}
    </div>
  );
}
