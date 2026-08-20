// 把 AI 分析结果转成 TipTap 文档（JSON）+ 纯文本，直接存进 notes 表。
// 生成的结构和用户手写精读笔记一致：生词 / 例句 / 语法用彩色 callout + 逐条列表「词：释义  拓展」，
// 这样「转成闪卡」的 parse-sections 能按区域自动切出 word / example / grammar 三类卡。

import type { JSONContent } from "@tiptap/core";
import { docToText } from "@/lib/doc-to-text";
import { katakanaRuns, hiraganaOf } from "@/lib/kana";

/** AI 分析返回的结构（analyze 路由的 JSON 输出）。 */
export type AiAnalysis = {
  title: string;
  summary: string;
  /** 整理后的原文文稿（修正错别字 / 去口水话 / 分段，保留原语言原文）。 */
  transcript: string;
  /** 原文的逐段中文翻译，段落与 transcript 用 \n 分隔、一一对应（可缺省）。 */
  transcriptTranslation?: string;
  words: { front: string; back: string; extra: string }[];
  sentences: { front: string; back: string; extra: string }[];
  grammar: {
    title: string;
    explanation: string;
    example: string;
    /** 语法点在原文里出现的原语言短语，用于下划线标注（可缺省）。 */
    phrase?: string;
  }[];
};

function text(s: string): JSONContent {
  return { type: "text", text: s };
}

function para(s: string): JSONContent {
  return { type: "paragraph", content: [text(s)] };
}

/** 一条「词：释义  拓展」列表项（生词 / 例句 / 语法共用）。
 *  拓展用两个空格接在释义后面：parseCards 的 wrapBackSpaces 会把双空格拆成换行，
 *  于是转成闪卡时拓展落到背面释义的下一行，而不是跟释义挤在同一行（避免括号混淆）。 */
function item(front: string, back: string, extra: string): JSONContent {
  let line = front || back || "";
  if (front && back) line = `${front}：${back}`;
  if (extra) line = `${line}  ${extra}`;
  return { type: "listItem", content: [para(line)] };
}

function bulletList(items: JSONContent[]): JSONContent {
  return { type: "bulletList", content: items };
}

function clean(v: unknown): string {
  return typeof v === "string" ? v.trim() : "";
}

function callout(
  kind: "word" | "example" | "grammar" | "article",
  content: JSONContent[]
): JSONContent {
  return { type: "callout", attrs: { kind }, content };
}

/** 把多行文本拆成段落节点。 */
function parasOf(text: string): JSONContent[] {
  return text
    .split(/\n+/)
    .map((l) => l.trim())
    .filter(Boolean)
    .map((line) => para(line));
}

/** 一段淡灰小字中文翻译（跟在原文段下方）。 */
function translationPara(s: string): JSONContent {
  return {
    type: "paragraph",
    content: [{ type: "text", text: s, marks: [{ type: "translation" }] }],
  };
}

/** 给一段原文加「生词高亮（只标首现）+ 语法下划线（只标首现）+ 片假名上方平假名读音」，返回带 mark 的段落。 */
function markedTranscriptPara(
  line: string,
  wordFronts: string[],
  grammarPhrases: string[],
  seenWords: Set<string>,
  seenGrammar: Set<string>
): JSONContent {
  const lower = line.toLowerCase();
  const highlights: { start: number; end: number }[] = [];
  const underlines: { start: number; end: number }[] = [];

  for (const w of wordFronts) {
    if (seenWords.has(w)) continue;
    const i = lower.indexOf(w.toLowerCase());
    if (i >= 0) {
      highlights.push({ start: i, end: i + w.length });
      seenWords.add(w);
    }
  }
  for (const p of grammarPhrases) {
    if (seenGrammar.has(p)) continue;
    const i = lower.indexOf(p.toLowerCase());
    if (i >= 0) {
      underlines.push({ start: i, end: i + p.length });
      seenGrammar.add(p);
    }
  }
  const furigana = katakanaRuns(line);

  // 把所有标注的起止点合并成切分点，逐段判断该段带哪些 mark。
  const bounds = new Set<number>([0, line.length]);
  for (const s of [...highlights, ...underlines, ...furigana]) {
    bounds.add(s.start);
    bounds.add(s.end);
  }
  const sorted = Array.from(bounds).sort((a, b) => a - b);

  const content: JSONContent[] = [];
  for (let i = 0; i < sorted.length - 1; i++) {
    const start = sorted[i];
    const end = sorted[i + 1];
    if (start >= end) continue;
    const seg = line.slice(start, end);
    const marks: { type: string; attrs?: Record<string, any> }[] = [];
    if (highlights.some((s) => s.start <= start && end <= s.end)) {
      marks.push({ type: "highlight" });
    }
    if (underlines.some((s) => s.start <= start && end <= s.end)) {
      marks.push({ type: "underline" });
    }
    if (furigana.some((s) => s.start <= start && end <= s.end)) {
      const reading = hiraganaOf(seg);
      if (reading && reading !== seg) {
        marks.push({ type: "furigana", attrs: { rt: reading } });
      }
    }
    content.push({
      type: "text",
      text: seg,
      marks: marks.length > 0 ? marks : undefined,
    });
  }
  return { type: "paragraph", content };
}

/** 把一段文字稿（原文/转录稿）包成「原文」callout；「转成闪卡」时会跳过它。 */
export function transcriptCallout(text: string): JSONContent {
  const paras = parasOf(text);
  return callout("article", paras.length > 0 ? paras : [para("")]);
}

/** 分析结果 → TipTap 文档 JSON：生词/例句/语法用彩色 callout 块，概括 + 整理后的原文一起放进只读「原文」区块。 */
export function analysisToNoteContent(a: AiAnalysis, transcript?: string): JSONContent {
  const content: JSONContent[] = [];

  const summary = clean(a.summary);
  // 原文优先用 AI 整理后的版本，没有时退回调用方传入的原始文字稿。
  const t = clean(a.transcript) || (transcript?.trim() ?? "");
  const tParas = t.split(/\n+/).map((l) => l.trim()).filter(Boolean);
  const transParas = clean(a.transcriptTranslation).split(/\n+/).map((l) => l.trim());
  const wordFronts = (a.words ?? []).map((w) => clean(w.front)).filter(Boolean);
  const grammarPhrases = (a.grammar ?? []).map((g) => clean(g.phrase)).filter(Boolean);

  if (summary || tParas.length > 0) {
    const paras: JSONContent[] = [];
    if (summary) paras.push(para(summary));
    const seenWords = new Set<string>();
    const seenGrammar = new Set<string>();
    tParas.forEach((line, i) => {
      paras.push(
        markedTranscriptPara(line, wordFronts, grammarPhrases, seenWords, seenGrammar)
      );
      const tr = transParas[i]?.trim();
      if (tr) paras.push(translationPara(tr));
    });
    content.push(callout("article", paras));
  }

  const words = (a.words ?? []).filter((w) => clean(w.front) || clean(w.back));
  if (words.length > 0) {
    content.push(
      callout("word", [
        bulletList(
          words.map((w) => item(clean(w.front), clean(w.back), clean(w.extra)))
        ),
      ])
    );
  }

  const sentences = (a.sentences ?? []).filter(
    (s) => clean(s.front) || clean(s.back)
  );
  if (sentences.length > 0) {
    content.push(
      callout("example", [
        bulletList(
          sentences.map((s) => item(clean(s.front), clean(s.back), clean(s.extra)))
        ),
      ])
    );
  }

  const grammar = (a.grammar ?? []).filter(
    (g) => clean(g.title) || clean(g.explanation)
  );
  if (grammar.length > 0) {
    content.push(
      callout(
        "grammar",
        [
          bulletList(
            grammar.map((g) =>
              item(
                clean(g.title),
                clean(g.explanation),
                clean(g.example) ? `例：${clean(g.example)}` : ""
              )
            )
          ),
        ]
      )
    );
  }

  return { type: "doc", content };
}

/** 分析结果 → 笔记纯文本（存 content_text，供搜索 / 转成闪卡）。 */
export function analysisToNoteText(a: AiAnalysis): string {
  return docToText(analysisToNoteContent(a));
}
