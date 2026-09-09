// 完形填空题库生成：从待复习卡片里，把「生词」挖进一句话里出题。
// 优先用现成的语境句（例句卡 / 生词背面带「例句」），且只挖「要背的那个词」——
// 正面里的「(读音)」括号先去掉、按词本身匹配，不把整个搭配词组挖空；去掉括号后
// 仍是多词的短语/搭配（规则分不清该挖哪个词）就进 missing 交给 AI 现造例句。
// 没有语境句的生词也进 missing，由会话端 AI 生成例句再挖空（带「AI 生成」标识）。

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

/** 生词正面可能带「(读音)」，挖空 / 匹配 / 分类都针对词本身（去掉括号读音）。 */
export function clozeWord(front: string): string {
  return front.replace(/[（(][^（）()]*[）)]/g, "").trim();
}

/** 一张卡是不是「生词」（完形填空只挖生词）：
 *  明确 kind=word，或未分类且去掉「(读音)」后仍是单个词（无空格）。
 *  去掉括号后仍含空格（短语/句子/搭配）不算生词，交给句子池或 AI。 */
export function isWordCard(front: string, kind: string | null): boolean {
  if (!front.trim()) return false;
  if (kind === "word") return true;
  if (kind === "example" || kind === "grammar") return false;
  const w = clozeWord(front);
  return w !== "" && !/\s/.test(w);
}

/** 一张卡的正面是否算「语境句」（可挖别人词进去）：kind=example，或未分类且去掉括号后仍多词。 */
function isSentenceCard(front: string, kind: string | null): boolean {
  if (kind === "example") return true;
  if (kind !== null) return false;
  const w = clozeWord(front);
  return w !== "" && /\s/.test(w);
}

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

/** 例句之后可能还有别的标签（拓展/搭配/相关…），这些不是例句、不该当题目。 */
const EXAMPLE_TERMINATORS = [
  "拓展", "搭配", "常用搭配", "相关", "相关词", "用法", "注意", "说明",
  "接续", "接续规则", "规则", "读音", "发音", "音标", "拼音", "罗马音",
  "释义", "意思", "含义", "解释", "词性", "词义", "译文", "翻译", "解析",
  "长难句", "生词",
];

/** 生词背面经常是「释义 例句：例句（译文）拓展：搭配…」——把释义和例句拆开：
 *  释义给答前「词义」提示，例句当作外语语境句，避免两者混在一起。
 *  例句只取「例句：」后到下一个标签行 / 换行为止，不把「拓展/搭配」混进例句当题目。 */
function splitWordBack(back: string): { meaning: string; example: string } {
  const m = /例(?:句)?\s*[：:]/.exec(back);
  if (!m || m.index === undefined) return { meaning: back.trim(), example: "" };
  const meaning = back.slice(0, m.index).trim();
  const rest = back.slice(m.index + m[0].length);
  // 背面按标签分行 → 例句到换行为止；再在单行内切掉后续标签（旧双空格格式）。
  const firstLine = rest.split(/\n/)[0];
  const cut = firstLine.search(
    new RegExp(`\\s{2,}(?:${EXAMPLE_TERMINATORS.join("|")})[：:]`)
  );
  return {
    meaning,
    example: (cut >= 0 ? firstLine.slice(0, cut) : firstLine).trim(),
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
 * 只给「生词」出题；有语境句（含该词）且词是单个词 → 挖该词；多词搭配/无语境句 → missing（AI 造）。
 */
export function buildClozeItems(items: ReviewItem[]): {
  items: ClozeItem[];
  missing: MissingWord[];
} {
  // 句子池：例句卡正面 + 未分类的句子卡正面 + 各卡背面「例句」——统一收集，外语类优先。
  // 背面无条件入池：只有真正「含该词」的背面才会被选中（释义不含目标词，天然不会误命中）。
  const pool: SentenceSource[] = [];
  for (const it of items) {
    const c = it.card;
    const front = c.front?.trim() ?? "";
    const back = c.back?.trim() ?? "";
    if (front && isSentenceCard(front, c.kind)) {
      pool.push({ text: front, isForeign: true, translation: back });
    }
    if (back) {
      const { example } = splitWordBack(back);
      if (example) pool.push({ text: example, isForeign: true, translation: "" });
    }
  }

  const used = new Set<string>();
  const out: ClozeItem[] = [];
  const missing: MissingWord[] = [];
  for (const it of items) {
    const c = it.card;
    const front = c.front?.trim() ?? "";
    if (!front) continue;
    if (!isWordCard(front, c.kind)) continue;

    const word = clozeWord(front);
    if (!word) continue;
    // 词义只取释义部分（去掉「例：…」），别让答前提示连例句一起闪出来。
    const meaning = splitWordBack(c.back ?? "").meaning;

    // 去掉括号后仍是「多词」（短语/搭配）→ 规则分不清该挖哪个词，交给 AI 只挖核心词。
    if (/\s/.test(word)) {
      missing.push({ cardId: c.id, word, meaning, lang: detectLang(word) });
      continue;
    }

    const src = pickSentence(pool, word, used);
    if (!src) {
      // 没有现成语境句 → 交给 AI 生成例句（会话端补齐）。
      missing.push({ cardId: c.id, word, meaning, lang: detectLang(word) });
      continue;
    }
    const idx = matchIndex(src.text, word);
    if (idx < 0) continue;
    used.add(src.text);

    out.push({
      cardId: c.id,
      sentence: src.text,
      prompt: src.text.slice(0, idx) + "＿＿＿＿" + src.text.slice(idx + word.length),
      answer: src.text.slice(idx, idx + word.length),
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
