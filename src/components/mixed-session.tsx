"use client";

import { useMemo, useState } from "react";
import { FileText, PartyPopper, Smile, Activity } from "lucide-react";
import type { Card } from "@/lib/types";
import { createClient } from "@/lib/supabase/client";
import { SpeakButton } from "./speak-button";
import { cardLang } from "@/lib/lang-detect";
import { BackButton } from "./back-button";
import { backMeaning } from "./card-back";

type Question =
  | { type: "choice"; card: Card; options: string[]; answer: string }
  | { type: "fill"; card: Card; answer: string }
  | { type: "reverse"; card: Card; answer: string };

function shuffle<T>(arr: T[]): T[] {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

/** 混合出题：每题随机选择「选择题」（看词选释义）或「填空题」（输入答案），保证两类都来了才算混合。 */
function buildMixedQuestions(pool: Card[], limit: number): Question[] {
  const cards = shuffle(pool).slice(0, limit);
  const backs = pool.map((c) => backMeaning(c.back ?? "")).filter(Boolean);
  return cards.map((card): Question => {
    const answer = backMeaning(card.back ?? "");
    const r = Math.random();
    if (r < 0.34) {
      const others = shuffle(backs.filter((b) => b !== answer)).slice(0, 3);
      const options = Array.from(new Set(shuffle([answer, ...others])));
      return { type: "choice", card, options, answer };
    }
    if (r < 0.67) {
      return { type: "fill", card, answer };
    }
    // 反向「看含义写词」：答案是要写的词（正面），自测不计分。
    return { type: "reverse", card, answer: (card.front ?? "").trim() };
  });
}

/**
 * 混合练习会话：把一组卡片随机出成「选择题」或「填空题」，两类交替。
 * 自动判分；结束出成绩 + 错题清单，可再来一次。错题落库到错题集。
 */
export function MixedSession({
  cards,
  backHref,
  limit = 20,
}: {
  cards: Card[];
  backHref: string;
  limit?: number;
}) {
  const pool = useMemo(
    () => cards.filter((c) => c.front.trim() && (c.back ?? "").trim()),
    [cards]
  );

  const [questions, setQuestions] = useState<Question[]>(() =>
    buildMixedQuestions(pool, limit)
  );
  const [idx, setIdx] = useState(0);
  const [answered, setAnswered] = useState(false);
  const [feedbackCorrect, setFeedbackCorrect] = useState(false);
  const [pickedForChoice, setPickedForChoice] = useState<string | null>(null);
  const [value, setValue] = useState("");
  const [correctCount, setCorrectCount] = useState(0);
  const [wrongList, setWrongList] = useState<Question[]>([]);
  const [done, setDone] = useState(false);

  const q = questions[idx];

  async function record(ok: boolean) {
    if (ok) setCorrectCount((n) => n + 1);
    else {
      setWrongList((l) => [...l, q]);
      try {
        const supabase = createClient();
        const {
          data: { user },
        } = await supabase.auth.getUser();
        if (user) {
          await supabase
            .from("test_errors")
            .upsert({ user_id: user.id, card_id: q.card.id }, { onConflict: "user_id,card_id" });
        }
      } catch {
        // 忽略
      }
    }
  }

  function answerChoice(opt: string) {
    if (answered || !q) return;
    const ok = opt === q.answer;
    record(ok);
    setPickedForChoice(opt);
    setAnswered(true);
    setFeedbackCorrect(ok);
  }

  function checkFill() {
    if (answered || !q) return;
    // 填空题只看答案、不判分（释义可能记多个 / 顺序不同，没有标准答案）。
    setAnswered(true);
  }

  function next() {
    if (idx + 1 >= questions.length) {
      setDone(true);
      return;
    }
    setIdx((i) => i + 1);
    setAnswered(false);
    setPickedForChoice(null);
    setValue("");
  }

  function restart() {
    setQuestions(buildMixedQuestions(pool, limit));
    setIdx(0);
    setAnswered(false);
    setPickedForChoice(null);
    setValue("");
    setCorrectCount(0);
    setWrongList([]);
    setDone(false);
  }

  if (questions.length === 0) {
    return (
      <div className="mx-auto max-w-xl rounded-2xl border border-zinc-200 bg-white px-6 py-16 text-center">
        <FileText className="h-10 w-10 text-zinc-300" />
        <p className="mt-4 text-lg font-semibold text-zinc-900">没有可测试的闪卡</p>
        <p className="mt-1 text-sm text-zinc-500">
          需要闪卡同时有正面和背面（答案）才能出题。
        </p>
        <BackButton
          fallback={backHref}
          className="mt-6 inline-block rounded-lg bg-teal-600 px-5 py-2 text-sm font-semibold text-white hover:bg-teal-700"
        >
          返回
        </BackButton>
      </div>
    );
  }

  if (done) {
    const scored = questions.filter((x) => x.type === "choice").length;
    const fillCount = questions.length - scored;
    const pct = scored > 0 ? Math.round((correctCount / scored) * 100) : 0;
    return (
      <div className="mx-auto max-w-xl">
        <div className="rounded-2xl border border-zinc-200 bg-white px-6 py-8 text-center">
          <div className="flex justify-center">
            {pct >= 80 ? (
              <PartyPopper className="h-10 w-10 text-teal-500" />
            ) : pct >= 50 ? (
              <Smile className="h-10 w-10 text-teal-500" />
            ) : (
              <Activity className="h-10 w-10 text-teal-500" />
            )}
          </div>
          <p className="mt-3 text-lg font-semibold text-zinc-900">
            {scored > 0
              ? `答对 ${correctCount} / ${scored} 道选择题（${pct}%）`
              : "本次均为填空题（自测，不计分）"}
          </p>
          {scored > 0 && fillCount > 0 && (
            <p className="mt-1 text-xs text-zinc-400">{fillCount} 道填空题不计分</p>
          )}
          <div className="mt-6 flex gap-2">
            <button
              onClick={restart}
              className="flex-1 rounded-lg bg-teal-600 px-4 py-2 text-sm font-semibold text-white hover:bg-teal-700"
            >
              再来一次
            </button>
            <BackButton
              fallback={backHref}
              className="flex-1 rounded-lg border border-zinc-200 px-4 py-2 text-sm text-zinc-600 hover:bg-zinc-50"
            >
              返回
            </BackButton>
          </div>
        </div>

        {wrongList.length > 0 && (
          <section className="mt-6">
            <h2 className="mb-3 text-sm font-semibold text-zinc-700">
              错题回顾（{wrongList.length}）
            </h2>
            <ul className="space-y-2">
              {wrongList.map((wq, i) => (
                <li key={i} className="rounded-xl border border-zinc-200 bg-white p-3">
                  <div className="flex items-center justify-end gap-2">
                    <SpeakButton text={wq.card.front} lang={cardLang(wq.card)} />
                  </div>
                  <p className="mt-1 text-sm font-medium text-zinc-900">{wq.card.front}</p>
                  <p className="mt-0.5 whitespace-pre-wrap text-sm text-emerald-700">
                    答案：{wq.card.back}
                  </p>
                </li>
              ))}
            </ul>
          </section>
        )}
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-xl">
      <div className="mb-4 text-sm text-zinc-500">
        第 <span className="font-semibold text-zinc-800">{idx + 1}</span> / {questions.length} 题
      </div>
      <div className="mb-5 h-1.5 w-full overflow-hidden rounded-full bg-zinc-100">
        <div
          className="h-full bg-teal-500 transition-all"
          style={{ width: `${((idx + (answered ? 1 : 0)) / questions.length) * 100}%` }}
        />
      </div>

      <div className="rounded-2xl border border-zinc-200 bg-white p-6">
        <div className="flex items-start justify-between gap-3">
          <p className="whitespace-pre-wrap text-2xl font-semibold leading-relaxed text-zinc-900">
            {q.type === "reverse" ? backMeaning(q.card.back ?? "") : q.card.front}
          </p>
          {q.type !== "reverse" && (
            <SpeakButton text={q.card.front} lang={cardLang(q.card)} />
          )}
        </div>

        {q.type === "choice" ? (
          <div className="mt-5 space-y-2">
            {q.options.map((opt, i) => {
              const isAnswer = opt === q.answer;
              const isPicked = answered && opt === pickedForChoice;
              let cls = "border-zinc-200 text-zinc-700 hover:border-teal-300 hover:bg-zinc-50";
              if (answered) {
                if (isAnswer) cls = "border-emerald-400 bg-emerald-50 text-emerald-800";
                else if (isPicked) cls = "border-rose-400 bg-rose-50 text-rose-700";
                else cls = "border-zinc-200 text-zinc-400";
              }
              return (
                <button
                  key={i}
                  onClick={() => answerChoice(opt)}
                  disabled={answered}
                  className={`block w-full rounded-xl border px-4 py-2.5 text-left text-sm transition-colors ${cls}`}
                >
                  {String.fromCharCode(65 + i)}. {opt}
                </button>
              );
            })}
          </div>
        ) : (
          <div className="mt-5">
            <input
              value={value}
              onChange={(e) => setValue(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") checkFill();
              }}
              disabled={answered}
              placeholder={q.type === "reverse" ? "写下这个词" : "输入释义"}
              className="w-full rounded-xl border border-zinc-200 px-3 py-2.5 text-sm placeholder:text-sm focus:border-teal-500 focus:outline-none disabled:opacity-70"
            />
            {!answered && (
              <div className="mt-3">
                <button
                  onClick={checkFill}
                  className="rounded-xl bg-teal-600 px-4 py-2 text-sm font-semibold text-white hover:bg-teal-700"
                >
                  显示答案
                </button>
              </div>
            )}
          </div>
        )}
      </div>

      {answered && (
        <div className="mt-4 space-y-3">
          <p className={`whitespace-pre-wrap text-sm font-medium ${q.type !== "choice" ? "text-zinc-600" : feedbackCorrect ? "text-emerald-600" : "text-rose-600"}`}>
            {q.type !== "choice"
              ? `答案：${q.answer}`
              : feedbackCorrect
                ? "✓ 回答正确"
                : "✗ 回答错误"}
          </p>
          <button
            onClick={next}
            className="w-full rounded-lg bg-teal-600 px-5 py-2 text-sm font-semibold text-white hover:bg-teal-700"
          >
            {idx + 1 >= questions.length ? "查看成绩" : "下一题"}
          </button>
        </div>
      )}
    </div>
  );
}
