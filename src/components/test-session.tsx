"use client";

import { useMemo, useState } from "react";
import { FileText, PartyPopper, Smile, Activity } from "lucide-react";
import type { Card } from "@/lib/types";
import { createClient } from "@/lib/supabase/client";
import { SpeakButton } from "./speak-button";
import { cardLang } from "@/lib/lang-detect";
import { BackButton } from "./back-button";

type Question = {
  card: Card;
  options: string[];
  answer: string;
};

function shuffle<T>(arr: T[]): T[] {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

/** 从一组卡片出选择题：看正面（要记的词/句），从背面释义里选正确答案。 */
function buildQuestions(pool: Card[], limit: number): Question[] {
  const cards = shuffle(pool).slice(0, limit);
  const backs = pool.map((c) => (c.back ?? "").trim()).filter(Boolean);
  return cards.map((card): Question => {
    const answer = (card.back ?? "").trim();
    const others = shuffle(backs.filter((b) => b !== answer)).slice(0, 3);
    const options = Array.from(new Set(shuffle([answer, ...others])));
    return { card, options, answer };
  });
}

/**
 * 测试会话：把一组卡片出成选择题（看词选释义）。
 * 自动判分；结束出成绩 + 错题清单，可再来一次。
 */
export function TestSession({
  cards,
  backHref,
  limit = 20,
}: {
  cards: Card[];
  title: string;
  backHref: string;
  limit?: number;
}) {
  // 只测有背面（有答案）的卡
  const pool = useMemo(
    () => cards.filter((c) => c.front.trim() && (c.back ?? "").trim()),
    [cards]
  );

  const [questions, setQuestions] = useState<Question[]>(() =>
    buildQuestions(pool, limit)
  );
  const [idx, setIdx] = useState(0);
  const [answered, setAnswered] = useState(false);
  const [feedbackCorrect, setFeedbackCorrect] = useState(false);
  const [pickedForChoice, setPickedForChoice] = useState<string | null>(null);
  const [correctCount, setCorrectCount] = useState(0);
  const [wrongList, setWrongList] = useState<Question[]>([]);
  const [done, setDone] = useState(false);

  const q = questions[idx];

  async function record(ok: boolean) {
    if (ok) setCorrectCount((n) => n + 1);
    else {
      setWrongList((l) => [...l, q]);
      // 落库到错题集（独立于 SM-2 复习评分；表没建/出错不影响测试本身）。
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
    setAnswered(true);
    setFeedbackCorrect(ok);
  }

  function next() {
    if (idx + 1 >= questions.length) {
      setDone(true);
      return;
    }
    setIdx((i) => i + 1);
    setAnswered(false);
    setPickedForChoice(null);
  }

  function restart() {
    setQuestions(buildQuestions(pool, limit));
    setIdx(0);
    setAnswered(false);
    setPickedForChoice(null);
    setCorrectCount(0);
    setWrongList([]);
    setDone(false);
  }

  // ===== 无题可测 =====
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

  // ===== 成绩单 =====
  if (done) {
    const total = questions.length;
    const pct = Math.round((correctCount / total) * 100);
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
            答对 {correctCount} / {total} 题（{pct}%）
          </p>
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

  // ===== 答题中 =====
  return (
    <div className="mx-auto max-w-xl">
      {/* 进度 */}
      <div className="mb-4 text-sm text-zinc-500">
        第 <span className="font-semibold text-zinc-800">{idx + 1}</span> /{" "}
        {questions.length} 题
      </div>
      <div className="mb-5 h-1.5 w-full overflow-hidden rounded-full bg-zinc-100">
        <div
          className="h-full bg-teal-500 transition-all"
          style={{ width: `${((idx + (answered ? 1 : 0)) / questions.length) * 100}%` }}
        />
      </div>

      {/* 题目：正面（要测的词 / 句），选背面释义 */}
      <div className="rounded-2xl border border-zinc-200 bg-white p-6">
        <div className="flex items-start justify-between gap-3">
          <p className="whitespace-pre-wrap text-2xl font-semibold leading-relaxed text-zinc-900">
            {q.card.front}
          </p>
          <SpeakButton text={q.card.front} lang={cardLang(q.card)} />
        </div>

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
                onClick={() => {
                  setPickedForChoice(opt);
                  answerChoice(opt);
                }}
                disabled={answered}
                className={`block w-full rounded-xl border px-4 py-2.5 text-left text-sm transition-colors ${cls}`}
              >
                {String.fromCharCode(65 + i)}. {opt}
              </button>
            );
          })}
        </div>
      </div>

      {/* 反馈 + 下一题 */}
      {answered && (
        <div className="mt-4 flex items-center justify-between">
          <p className={`text-sm font-medium ${feedbackCorrect ? "text-emerald-600" : "text-rose-600"}`}>
            {feedbackCorrect ? "✓ 回答正确" : "✗ 回答错误"}
          </p>
          <button
            onClick={next}
            className="rounded-lg bg-teal-600 px-5 py-2 text-sm font-semibold text-white hover:bg-teal-700"
          >
            {idx + 1 >= questions.length ? "查看成绩" : "下一题"}
          </button>
        </div>
      )}
    </div>
  );
}
