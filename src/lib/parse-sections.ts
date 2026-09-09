// 精读笔记的「生词 / 例句 / 语法」切分 + 结构化内容识别。
// 编辑器里用 callout 块（或标题）写「生词」「例句」「语法」，标记下面的内容
// （每行「词 — 释义」，或粘贴的表格）都会归到对应区域。docToText 已把 callout / 标题
// 变成一行文字、表格变成 TSV，所以这里只需按标记行切分。
// 同一类的多个区块（比如两个「生词」callout）会合并成一段，避免转成闪卡时被拆成多组。
//
// parseNote 还会把「callout 之外」的表格 / 分隔符行识别成「生词」（普通段落跳过），
// 这样一篇笔记里既有表格、又有文字、还有生词 callout 时，转成闪卡能合并在一起。

import { parseCards, type ParsedCard } from "@/lib/parse-cards";
import { HR_TEXT } from "@/lib/doc-to-text";
import type { RecognitionRules } from "@/lib/types";

export type SectionKind = "word" | "example" | "grammar";

export type CardSection = {
  kind: SectionKind;
  title: string;
  cards: ParsedCard[];
};

export type ParseResult = {
  /** 生词/例句/语法 callout 区域。 */
  sections: CardSection[];
  /** callout 之外识别出的结构化卡片（表格 / 「词—释义」行）；普通段落不在这里。 */
  rest: ParsedCard[];
};

export const WORD_TITLES = new Set([
  "生词表",
  "生词",
  "词汇表",
  "词汇",
  "单词表",
  "vocabulary",
  "vocab",
]);
export const EXAMPLE_TITLES = new Set(["例句表", "例句", "example", "examples"]);
export const GRAMMAR_TITLES = new Set(["语法", "语法点", "文法", "grammar"]);
const SKIP_TITLES = new Set(["原文", "原文稿", "文章", "文稿", "transcript", "article", "备注"]);

/** 一行文字是不是「生词/例句/语法」区域的标题（忽略开头的 # 和大小写）。 */
function sectionKind(line: string): SectionKind | null {
  const t = line.trim().replace(/^#+\s*/, "").toLowerCase();
  if (WORD_TITLES.has(t)) return "word";
  if (EXAMPLE_TITLES.has(t)) return "example";
  if (GRAMMAR_TITLES.has(t)) return "grammar";
  return null;
}

/** 一行文字是不是「原文 / 文章 / 备注」标题（这类区域只读，转成闪卡时整段跳过）。 */
function isSkipTitle(line: string): boolean {
  const t = line.trim().replace(/^#+\s*/, "").toLowerCase();
  return SKIP_TITLES.has(t);
}

/**
 * 把整篇笔记纯文本切成「生词 / 例句 / 语法」区域，并把区域之外的表格/分隔符行也识别出来。
 * - callout 内：每行都算卡片（裸行也收），因为用户明确把它框进了生词区块。
 * - callout 外：只收结构化内容（表格 / 分隔符行），普通正文段落跳过，避免整篇文章被误转成卡。
 */
export function parseNote(text: string, rules?: RecognitionRules | null): ParseResult {
  const lines = text.split(/\r?\n/);
  const sections: CardSection[] = [];
  const restLines: string[] = [];
  let current: { kind: SectionKind; title: string; lines: string[] } | null = null;

  const flush = () => {
    if (!current) return;
    const cards = parseCards(current.lines.join("\n"), rules, { bareToCard: true, scope: "callout" });
    if (cards.length === 0) return;
    // 同类合并：多个「生词」callout → 归到同一个生词组。
    const existing = sections.find((s) => s.kind === current!.kind);
    if (existing) existing.cards.push(...cards);
    else sections.push({ kind: current.kind, title: current.title, cards });
  };

  let skipping = false; // 「原文 / 文章」区域：只读，下面的内容不转成闪卡。
  for (const line of lines) {
    // 分割线：结束当前区域（分割线之后的内容直到下一个标题前都不再归入任何区域）。
    if (line.trim() === HR_TEXT) {
      flush();
      current = null;
      skipping = false;
      continue;
    }
    if (isSkipTitle(line)) {
      flush();
      current = null;
      skipping = true;
      continue;
    }
    const kind = sectionKind(line);
    if (kind) {
      flush();
      current = { kind, title: line.trim(), lines: [] };
      skipping = false;
    } else if (skipping) {
      // 原文区域里的内容：直接丢弃。
    } else if (current) {
      current.lines.push(line);
    } else {
      restLines.push(line);
    }
  }
  flush();

  const rest = parseCards(restLines.join("\n"), rules, { bareToCard: false, scope: "plain" });
  return { sections, rest };
}
