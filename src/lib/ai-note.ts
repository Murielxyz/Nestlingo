// 把 AI 分析结果转成 TipTap 文档（JSON）+ 纯文本，直接存进 notes 表。
// 生成的结构和用户手写精读笔记一致：标题用「生词 / 例句 / 语法」+ 表格（原文|译文|拓展），
// 这样「转成闪卡」的 parse-sections 能按区域自动切出 word / example / grammar 三类卡。

import type { JSONContent } from "@tiptap/core";
import { docToText } from "@/lib/doc-to-text";

/** AI 分析返回的结构（analyze 路由的 JSON 输出）。 */
export type AiAnalysis = {
  title: string;
  summary: string;
  words: { front: string; back: string; extra: string }[];
  sentences: { front: string; back: string; extra: string }[];
  grammar: { title: string; explanation: string; example: string }[];
};

function text(s: string): JSONContent {
  return { type: "text", text: s };
}

function para(s: string): JSONContent {
  return { type: "paragraph", content: [text(s)] };
}

function heading(level: 2, s: string): JSONContent {
  return { type: "heading", attrs: { level }, content: [text(s)] };
}

function cell(type: "tableHeader" | "tableCell", s: string): JSONContent {
  return { type, content: [para(s)] };
}

function row(cells: string[], header = false): JSONContent {
  return {
    type: "tableRow",
    content: cells.map((c) => cell(header ? "tableHeader" : "tableCell", c)),
  };
}

function table(rows: string[][]): JSONContent {
  return { type: "table", content: rows.map((r, i) => row(r, i === 0)) };
}

function clean(v: unknown): string {
  return typeof v === "string" ? v.trim() : "";
}

/** 分析结果 → TipTap 文档 JSON。 */
export function analysisToNoteContent(a: AiAnalysis): JSONContent {
  const content: JSONContent[] = [];

  const summary = clean(a.summary);
  if (summary) content.push(para(summary));

  const words = (a.words ?? []).filter((w) => clean(w.front) || clean(w.back));
  if (words.length > 0) {
    content.push(heading(2, "生词"));
    content.push(
      table([
        ["原文", "译文", "拓展"],
        ...words.map((w) => [clean(w.front), clean(w.back), clean(w.extra)]),
      ])
    );
  }

  const sentences = (a.sentences ?? []).filter(
    (s) => clean(s.front) || clean(s.back)
  );
  if (sentences.length > 0) {
    content.push(heading(2, "例句"));
    content.push(
      table([
        ["原文", "译文", "拓展"],
        ...sentences.map((s) => [clean(s.front), clean(s.back), clean(s.extra)]),
      ])
    );
  }

  const grammar = (a.grammar ?? []).filter(
    (g) => clean(g.title) || clean(g.explanation)
  );
  if (grammar.length > 0) {
    content.push(heading(2, "语法"));
    for (const g of grammar) {
      const example = clean(g.example);
      const body =
        `${clean(g.title)}：${clean(g.explanation)}` +
        (example ? `（例：${example}）` : "");
      content.push(para(body));
    }
  }

  return { type: "doc", content };
}

/** 分析结果 → 笔记纯文本（存 content_text，供搜索 / 转成闪卡）。 */
export function analysisToNoteText(a: AiAnalysis): string {
  return docToText(analysisToNoteContent(a));
}
