// 把 AI 分析结果转成 TipTap 文档（JSON）+ 纯文本，直接存进 notes 表。
// 生成的结构和用户手写精读笔记一致：生词 / 例句 / 语法用彩色 callout + 逐条列表「词：释义  拓展」，
// 这样「转成闪卡」的 parse-sections 能按区域自动切出 word / example / grammar 三类卡。

import type { JSONContent } from "@tiptap/core";
import { docToText } from "@/lib/doc-to-text";
import { katakanaRuns, hiraganaOf } from "@/lib/kana";
import type { FuriganaSegment } from "@/lib/furigana";

/** 一条接续规则：rule = 接什么形（如「動詞て形」「名詞＋の」），example = 该规则的一个例句。 */
export type GrammarConjugation = { rule: string; example: string };

/** AI 分析返回的结构（analyze 路由的 JSON 输出）。 */
export type AiAnalysis = {
  title: string;
  summary: string;
  /** 整理后的原文文稿（修正错别字 / 去口水话 / 分段，保留原语言原文）。 */
  transcript: string;
  /** 原文的逐段中文翻译，段落与 transcript 用 \n 分隔、一一对应（可缺省）。 */
  transcriptTranslation?: string;
  /** 日语原文的「汉字读音」segments（text + reading，含 \n 分隔；只有日语精读时才回填）。
   *  前端据此把汉字标成上方假名（<ruby>）。 */
  transcriptFurigana?: { text: string; reading: string }[];
  words: { front: string; back: string; extra: string; frontFurigana?: FuriganaSegment[] }[];
  sentences: { front: string; back: string; extra: string }[];
  grammar: {
    title: string;
    explanation: string;
    example: string;
    /** 语法点在原文里出现的原语言短语，用于下划线标注（可缺省）。 */
    phrase?: string;
    /** 接续规则（日语语法必填，其它语言可空）：不同词性分别列，每条配一个例句。 */
    conjugations?: GrammarConjugation[];
  }[];
};

function text(s: string): JSONContent {
  return { type: "text", text: s };
}

function para(s: string): JSONContent {
  return { type: "paragraph", content: [text(s)] };
}

/** 语法点背面的「说明 + 接续规则（每条配例句）」：说明在前，接续规则依次跟在后面。
 *  各段用两个空格连接——parseCards 的 wrapBackSpaces 会把双空格拆成换行，
 *  于是转成闪卡时「说明 / 每条接续规则 / 例」各占背面一行，层次清楚。 */
function grammarBack(explanation: string, conjugations: GrammarConjugation[]): string {
  const parts: string[] = [explanation];
  for (const c of conjugations) {
    if (!c.rule) continue;
    parts.push(c.example ? `接续：${c.rule}（${c.example}）` : `接续：${c.rule}`);
  }
  return parts.filter(Boolean).join("  ");
}

/** 一行「词：释义  拓展」文本（生词 / 例句 / 语法共用）。
 *  拓展用两个空格接在释义后面：parseCards 的 wrapBackSpaces 会把双空格拆成换行，
 *  于是转成闪卡时拓展落到背面释义的下一行，而不是跟释义挤在同一行（避免括号混淆）。 */
export function itemLine(front: string, back: string, extra: string): string {
  // 换行折成双空格：行是单行文本，转成闪卡时 parseCards 会把双空格再拆回换行，
  // 于是「翻译\n词1：释义\n词2：释义」这类多行背面能原样存进笔记、又在背面按行显示。
  const b = back.replace(/\n/g, "  ");
  const e = extra.replace(/\n/g, "  ");
  let line = front || b || "";
  if (front && b) line = `${front}：${b}`;
  if (e) line = `${line}  ${e}`;
  return line;
}

/** 一条「词：释义  拓展」列表项（生词 / 例句 / 语法共用）。 */
export function item(front: string, back: string, extra: string): JSONContent {
  return { type: "listItem", content: [para(itemLine(front, back, extra))] };
}

/** 一段「词：释义  拓展」普通段落（用户记笔记不用列表时的变体，纯文本输出与 item() 一致）。 */
function paraItem(front: string, back: string, extra: string): JSONContent {
  return para(itemLine(front, back, extra));
}

function bulletList(items: JSONContent[]): JSONContent {
  return { type: "bulletList", content: items };
}

/**[front] 段 + 读音 → 带 furigana 上标的文本节点（汉字套 ruby、其余原样）。 */
function frontWithFurigana(
  front: string,
  furigana: FuriganaSegment[] | undefined
): JSONContent[] {
  if (!furigana || furigana.length === 0) return [{ type: "text", text: front }];
  const nodes: JSONContent[] = [];
  for (const seg of furigana) {
    if (seg.reading) {
      nodes.push({
        type: "text",
        text: seg.text,
        marks: [{ type: "furigana", attrs: { rt: seg.reading } }],
      });
    } else {
      nodes.push({ type: "text", text: seg.text });
    }
  }
  return nodes.length > 0 ? nodes : [{ type: "text", text: front }];
}

/** 一条「生词」列表项：front 可带读音（汉字上方假名），后面接「：释义  拓展」。
 *  与 item() 输出格式一致（无读音时就是「front：back  extra」），转成闪卡不受影响。 */
function wordItem(word: {
  front: string;
  back: string;
  extra: string;
  frontFurigana?: FuriganaSegment[];
}): JSONContent {
  const { front, back, extra } = word;
  const nodes: JSONContent[] = front
    ? frontWithFurigana(front, word.frontFurigana)
    : [];
  if (front && back) nodes.push({ type: "text", text: `：${back}` });
  else if (back) nodes.push({ type: "text", text: back });
  if (extra) nodes.push({ type: "text", text: `  ${extra}` });
  return { type: "listItem", content: [{ type: "paragraph", content: nodes }] };
}

function clean(v: unknown): string {
  return typeof v === "string" ? v.trim() : "";
}

function callout(
  kind: "word" | "example" | "grammar" | "article",
  content: JSONContent[],
  source?: string | null
): JSONContent {
  return { type: "callout", attrs: source ? { kind, source } : { kind }, content };
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
  seenGrammar: Set<string>,
  readings: { start: number; end: number; reading: string }[] = []
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
  for (const s of [...highlights, ...underlines, ...furigana, ...readings]) {
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
    const marks: { type: string; attrs?: Record<string, unknown> }[] = [];
    if (highlights.some((s) => s.start <= start && end <= s.end)) {
      marks.push({ type: "highlight" });
    }
    if (underlines.some((s) => s.start <= start && end <= s.end)) {
      marks.push({ type: "underline" });
    }
    // 汉字读音（AI 标音）：只在该段恰好等于一个读音区间时套用，避免把整串读音错挂在被切开的子段上。
    const kanjiReading = readings.find((r) => r.start === start && r.end === end);
    if (kanjiReading) {
      marks.push({ type: "furigana", attrs: { rt: kanjiReading.reading } });
    } else if (furigana.some((s) => s.start <= start && end <= s.end)) {
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

/** 把整篇 furigana segments（含 \n 分隔）拆成「每行一组 {start,end,reading} 区间」，供 markedTranscriptPara 用。 */
function readingsPerLine(
  segments: { text: string; reading: string }[],
  lineCount: number
): { start: number; end: number; reading: string }[][] {
  const result: { start: number; end: number; reading: string }[][] = Array.from(
    { length: lineCount },
    () => []
  );
  let li = 0;
  let offset = 0;
  for (const seg of segments) {
    if (seg.text === "\n") {
      li += 1;
      offset = 0;
      continue;
    }
    if (li >= lineCount) break;
    const start = offset;
    const end = offset + seg.text.length;
    if (seg.reading) result[li].push({ start, end, reading: seg.reading });
    offset = end;
  }
  return result;
}

/** 把一段文字稿（原文/转录稿）包成「原文」callout；「转成闪卡」时会跳过它。可带来源链接（来自素材库的原始 URL）。 */
export function transcriptCallout(text: string, source?: string | null): JSONContent {
  const paras = parasOf(text);
  return callout("article", paras.length > 0 ? paras : [para("")], source);
}

/** 分析结果 → TipTap 文档 JSON：生词/例句/语法用彩色 callout 块，概括 + 整理后的原文一起放进只读「原文」区块。
 *  `source` 会挂在重建后的「原文」callout 上（精读时继承原原文块的来源链接，避免来源标识消失）。 */
export function analysisToNoteContent(
  a: AiAnalysis,
  transcript?: string,
  source?: string | null
): JSONContent {
  const content: JSONContent[] = [];

  const summary = clean(a.summary);
  // 原文优先用 AI 整理后的版本，没有时退回调用方传入的原始文字稿。
  const t = clean(a.transcript) || (transcript?.trim() ?? "");
  const tParas = t.split(/\n+/).map((l) => l.trim()).filter(Boolean);
  const transParas = clean(a.transcriptTranslation).split(/\n+/).map((l) => l.trim());
  const wordFronts = (a.words ?? []).map((w) => clean(w.front)).filter(Boolean);
  const grammarPhrases = (a.grammar ?? []).map((g) => clean(g.phrase)).filter(Boolean);
  const readingsByLine = a.transcriptFurigana
    ? readingsPerLine(a.transcriptFurigana, tParas.length)
    : [];

  if (summary || tParas.length > 0) {
    const paras: JSONContent[] = [];
    if (summary) paras.push(para(summary));
    const seenWords = new Set<string>();
    const seenGrammar = new Set<string>();
    tParas.forEach((line, i) => {
      paras.push(
        markedTranscriptPara(
          line,
          wordFronts,
          grammarPhrases,
          seenWords,
          seenGrammar,
          readingsByLine[i] ?? []
        )
      );
      const tr = transParas[i]?.trim();
      if (tr) paras.push(translationPara(tr));
    });
    content.push(callout("article", paras, source));
  }

  const words = (a.words ?? []).filter((w) => clean(w.front) || clean(w.back));
  if (words.length > 0) {
    content.push(
      callout("word", [
        bulletList(
          words.map((w) =>
            wordItem({
              front: clean(w.front),
              back: clean(w.back),
              extra: clean(w.extra),
              frontFurigana: w.frontFurigana,
            })
          )
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
                grammarBack(
                  clean(g.explanation),
                  (g.conjugations ?? []).map((c) => ({
                    rule: clean(c.rule),
                    example: clean(c.example),
                  }))
                ),
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

/** AI 学伴返回的结构化知识点（assistant 路由的 JSON 输出）。
 *  一次对话里可以同时带出生词 / 例句 / 语法 / 原文四类点，前端勾选后加入笔记或转成闪卡。 */
export type AssistantPoint = {
  kind: "word" | "example" | "grammar" | "article";
  /** 生词=原词；例句=原句；语法=语法点；原文=正文（多段用换行分隔）。 */
  front: string;
  /** 生词=释义；例句=翻译；语法=说明；原文=逐段译文（段数与 front 一致，用换行分隔）。 */
  back: string;
  /** 生词=读音（泰语罗马音带声调、日语假名、韩语罗马转写、中文拼音、英语音标）；其余类型忽略。 */
  reading?: string;
  /** 生词=例句（一个用原语言写的完整句子）；例句=用法说明；语法=例句；原文=空。 */
  extra: string;
  /** 生词=搭配（常用搭配 / 词组，合并写在一起）；其余类型忽略。 */
  note?: string;
  /** 语法点的接续规则（日语必填，其它语言可空）；其余类型忽略。 */
  conjugations?: GrammarConjugation[];
};

/** 学伴的知识点 → 一组 callout 块（按类型分组；article 逐段配翻译）。
 *  用于「加入笔记」逐块插入，格式与手写精读一致，因此也能被「转成闪卡」识别。 */
export function pointsToNoteContent(
  points: AssistantPoint[],
  opts?: { list?: boolean }
): JSONContent[] {
  // list:true（默认）= 每条一个 listItem 包进 bulletList（语伴旧路径）；list:false = 每条一个普通段落（用户记笔记不用列表）。
  const asList = opts?.list ?? true;
  const blocks: JSONContent[] = [];
  const words = points.filter((p) => p.kind === "word");
  const sentences = points.filter((p) => p.kind === "example");
  const grammar = points.filter((p) => p.kind === "grammar");
  const articles = points.filter((p) => p.kind === "article");

  // 把若干「front/back/extra」行按 list 包成 listItem 数组或段落数组。
  const rows = (lines: { front: string; back: string; extra: string }[]): JSONContent[] =>
    lines.map((l) => (asList ? item(l.front, l.back, l.extra) : paraItem(l.front, l.back, l.extra)));

  for (const a of articles) {
    const frontParas = parasOf(a.front);
    if (frontParas.length === 0) frontParas.push(para(a.front || ""));
    const backParas = a.back.split(/\n+/).map((l) => l.trim());
    const content: JSONContent[] = [];
    frontParas.forEach((p, i) => {
      content.push(p);
      const tr = backParas[i];
      if (tr) content.push(translationPara(tr));
    });
    blocks.push(callout("article", content));
  }

  if (words.length) {
    const items = words.map((w) => ({
      // 读音统一放背面（与「解释」按钮 / 「收录到闪卡」一致），正面只留原词。
      front: clean(w.front),
      // 释义里的多义项若用换行分隔，折成顿号保持同一行（转成闪卡时才不会多出一行孤立的词）；
      // 读音作为背面第二行「读音：…」跟在释义后（itemLine 折成双空格，转卡时拆回换行）。
      back: [
        clean(w.back).replace(/\s*\n+\s*/g, "、"),
        clean(w.reading) ? `读音：${clean(w.reading)}` : "",
      ]
        .filter(Boolean)
        .join("\n"),
      extra: [
        clean(w.note) ? `搭配：${clean(w.note)}` : "",
        clean(w.extra) ? `例句：${clean(w.extra)}` : "",
      ]
        .filter(Boolean)
        .join("  "),
    }));
    const nodes = rows(items);
    blocks.push(callout("word", asList ? [bulletList(nodes)] : nodes));
  }
  if (sentences.length) {
    const items = sentences.map((s) => ({
      front: clean(s.front),
      back: clean(s.back),
      extra: clean(s.extra),
    }));
    const nodes = rows(items);
    blocks.push(callout("example", asList ? [bulletList(nodes)] : nodes));
  }
  if (grammar.length) {
    const items = grammar.map((g) => ({
      front: clean(g.front),
      back: grammarBack(
        clean(g.back),
        (g.conjugations ?? []).map((c) => ({
          rule: clean(c.rule),
          example: clean(c.example),
        }))
      ),
      extra: clean(g.extra) ? `例：${clean(g.extra)}` : "",
    }));
    const nodes = rows(items);
    blocks.push(callout("grammar", asList ? [bulletList(nodes)] : nodes));
  }

  return blocks;
}

/** 把「加假名」返回的 segments（text + reading）转成段落 JSON：
 *  汉字段套 furigana mark（假名显示在汉字上方），换行分段。 */
export function furiganaSegmentsToParagraphs(
  segments: { text: string; reading: string }[]
): JSONContent[] {
  const paras: JSONContent[] = [];
  let nodes: JSONContent[] = [];
  const flush = () => {
    if (nodes.length > 0) {
      paras.push({ type: "paragraph", content: nodes });
      nodes = [];
    }
  };
  for (const seg of segments) {
    if (seg.text === "\n") {
      flush();
    } else if (seg.reading) {
      nodes.push({
        type: "text",
        text: seg.text,
        marks: [{ type: "furigana", attrs: { rt: seg.reading } }],
      });
    } else {
      nodes.push({ type: "text", text: seg.text });
    }
  }
  flush();
  return paras.length > 0 ? paras : [{ type: "paragraph" }];
}
