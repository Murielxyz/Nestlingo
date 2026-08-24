// 完形填空题库生成：从待复习卡片里，把「生词」挖进一句话里出题。
// 优先用现成的语境句（例句 / 语法例 / 生词背面带例句）；没有语境句的生词会
// 被记进 missing，交给会话端 AI 生成例句再挖空（带「AI 生成」标识）。

import type { ReviewItem } from "@/lib/supabase/queries";
import { detectLang, type Lang } from "@/lib/lang-detect";

export type ClozeItem = {
  cardId: string;
  /** 原句（未挖空），答后展示。 */
  sentence: string;
  /** 挖空后的句子（答案词已替换成 ＿＿＿＿）。 */
  prompt: string;
  /** 从原句里挖掉的那个词（保留原句写法）。 */
  answer: string;
  /** 卡片背面释义（= 这个空要填的意思），答前提示、答后核对用。 */
  meaning: string;
  /** 该词的语境译文（例句卡背面 / 整句译文）；答前提示，帮你知道句子在说什么。 */
  translation: string;
  /** 语法卡的正面（如语法点），供答后补充；非语法卡为空。 */
  hint: string;
  /** 这条题是 AI 现造例句出的（无现成语境）。 */
  aiGenerated: boolean;
};

/** 没有现成语境句的生词，等 AI 给例句；lang 用来提示模型造句语言。 */
export type MissingWord = {
  cardId: string;
  word: string;
  meaning: string;
  lang: Lang;
};

/** 找一个「看起来是一句话」的文本：要么明确是例句/语法，要么含空格（韩/拉丁）。 */
function isSentenceLike(text: string): boolean {
  return /\s/.test(text);
}

/** 返回 word 在 sentence 里第一次出现的下标（忽略大小写）；找不到返回 -1。
 *  纯拉丁词加边界检查（避免把 category 里的 cat 当成命中）。 */
function matchIndex(sentence: string, word: string): number {
  if (!word) return -1;
  const w = word.toLowerCase();
  const latin = /^[A-Za-z]+$/.test(word);
  const lc = sentence.toLowerCase();
  let from = 0;
  for (;;) {
    const i = lc.indexOf(w, from);
    if (i < 0) return -1;
    if (latin) {
      const before = i > 0 ? sentence[i - 1] : "";
      const after = i + word.length < sentence.length ? sentence[i + word.length] : "";
      if (/[A-Za-z]/.test(before) || /[A-Za-z]/.test(after)) {
        from = i + 1;
        continue;
      }
    }
    return i;
  }
}

/** 句子池里的候选：text 是原句，translation 是该句的译文（例句卡背面 / 整句译文）。 */
type SentenceSource = {
  text: string;
  isForeign: boolean;
  translation: string;
};

/** 生词背面经常是「释义 例：例句（译文）」——把释义和例句拆开：
 *  释义给答前「词义」提示，例句当作外语语境句，避免两者混在一起。 */
function splitWordBack(back: string): { meaning: string; example: string } {
  const m = /例(?:句)?\s*[：:]/.exec(back);
  if (!m || m.index === undefined) return { meaning: back.trim(), example: "" };
  return {
    meaning: back.slice(0, m.index).trim(),
    example: back.slice(m.index + m[0].length).trim(),
  };
}

/** 从句子池里找一句含 word 的；优先没被用过的外语例句，其次任意没被用过的。 */
function pickSentence(
  pool: SentenceSource[],
  word: string,
  used: Set<string>
): SentenceSource | null {
  const has = (x: SentenceSource) => matchIndex(x.text, word) >= 0 && !used.has(x.text);
  const foreign = pool.find((x) => x.isForeign && has(x));
  if (foreign) return foreign;
  return pool.find((x) => has(x)) ?? null;
}

/**
 * 把待复习卡片交给完形填空题生成器。
 * 只给「生词」出题（kind=word，或未分类且正面是单 token）。有语境句的 → items；
 * 没有语境句的 → missing（交给 AI 现造例句）。两者都不含就只在 missing 里。
 */
export function buildClozeItems(items: ReviewItem[]): {
  items: ClozeItem[];
  missing: MissingWord[];
} {
  // 句子池：例句/语法带空格的正面 + 各卡背面（可能自带例句）——统一收集，外语类优先。
  // 背面无条件入池：只有真正「含该词」的背面才会被选中（释义不含目标词，天然不会误命中）。
  const pool: SentenceSource[] = [];
  for (const it of items) {
    const c = it.card;
    const front = c.front?.trim() ?? "";
    const back = c.back?.trim() ?? "";
    // 只把「真句子」收进池：例句类正面，或正面含空格（韩/拉丁句子）。
    // 生词的正面是单个词，收进来会变成「自己挖空自己」，必须排除。
    if (front && (c.kind === "example" || isSentenceLike(front))) {
      // 正面是目标语言句子，背面就是它的译文 → 拿来当答前提示。
      pool.push({ text: front, isForeign: true, translation: back });
    }
    if (back) {
      const { example } = splitWordBack(back);
      // 生词背面「释义 例：…」→ 只用例句当外语语境句，别把释义跟例句混在一起；
      // 没有拆分出来的例句（如纯译文 / 纯释义）维持原样，当作候选句。
      if (example) pool.push({ text: example, isForeign: true, translation: "" });
      else pool.push({ text: back, isForeign: false, translation: "" });
    }
  }

  const used = new Set<string>();
  const out: ClozeItem[] = [];
  const missing: MissingWord[] = [];
  for (const it of items) {
    const c = it.card;
    const front = c.front?.trim() ?? "";
    if (!front) continue;
    const isWord = c.kind === "word" || (c.kind === null && !isSentenceLike(front));
    if (!isWord) continue;

    const src = pickSentence(pool, front, used);
    // 词义只取释义部分（去掉「例：…」），别让答前提示连例句一起闪出来。
    const meaning = splitWordBack(c.back ?? "").meaning;
    if (!src) {
      // 没有现成语境句 → 交给 AI 生成例句（会话端补齐）。
      missing.push({
        cardId: c.id,
        word: front,
        meaning,
        lang: detectLang(front),
      });
      continue;
    }
    const idx = matchIndex(src.text, front);
    if (idx < 0) continue;
    used.add(src.text);

    out.push({
      cardId: c.id,
      sentence: src.text,
      prompt:
        src.text.slice(0, idx) + "＿＿＿＿" + src.text.slice(idx + front.length),
      answer: src.text.slice(idx, idx + front.length),
      meaning,
      translation: src.translation,
      hint: c.kind === "grammar" ? front : "",
      aiGenerated: false,
    });
  }
  return { items: out, missing };
}

/**
 * 把 AI 返回的例句（目标词用 ⟦ ⟧ 包起来）拆成一条完形题。
 * 优先用 ⟦ ⟧ 定位（模型可能给词变形，靠它准确抓位置）；没有就退回 matchIndex；
 * 都定位不到返回 null（这题放弃，宁缺毋滥）。
 */
export function parseAiCloze(
  raw: string,
  missing: MissingWord,
  translation = ""
): ClozeItem | null {
  if (!raw) return null;
  const word = missing.word;

  const i = raw.indexOf("⟦");
  const j = raw.indexOf("⟧", i + 1);
  let sentence = raw;
  let answer = word;
  let prompt = raw;

  if (i >= 0 && j > i) {
    answer = raw.slice(i + 1, j).trim() || word;
    sentence = raw.slice(0, i) + answer + raw.slice(j + 1);
    prompt = raw.slice(0, i) + "＿＿＿＿" + raw.slice(j + 1);
  } else {
    const idx = matchIndex(raw, word);
    if (idx < 0) return null;
    answer = raw.slice(idx, idx + word.length);
    sentence = raw;
    prompt = raw.slice(0, idx) + "＿＿＿＿" + raw.slice(idx + word.length);
  }

  if (!sentence.trim()) return null;
  return {
    cardId: missing.cardId,
    sentence,
    prompt,
    answer,
    meaning: missing.meaning,
    translation,
    hint: "",
    aiGenerated: true,
  };
}

/** 输入里的答案规范化（忽略大小写与多余空格）后与正确词比较。 */
export function normalizeAnswer(value: string): string {
  return value.trim().toLowerCase().replace(/\s+/g, " ");
}
