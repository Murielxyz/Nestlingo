// 精读笔记的「生词 / 例句 / 语法」切分：
// 编辑器里用 callout 块（或标题）写「生词」「例句」「语法」，标记下面的内容
// （每行「词 — 释义」，或粘贴的表格）都会归到对应区域。docToText 已把 callout / 标题
// 变成一行文字、表格变成 TSV，所以这里只需按标记行切分，每段再交给 parseCards 解析成卡片。

import { parseCards, type ParsedCard } from "@/lib/parse-cards";
import { HR_TEXT } from "@/lib/doc-to-text";

export type SectionKind = "word" | "example" | "grammar";

export type CardSection = {
  kind: SectionKind;
  title: string;
  cards: ParsedCard[];
};

const WORD_TITLES = new Set([
  "生词表",
  "生词",
  "词汇表",
  "词汇",
  "单词表",
  "vocabulary",
  "vocab",
]);
const EXAMPLE_TITLES = new Set(["例句表", "例句", "example", "examples"]);
const GRAMMAR_TITLES = new Set(["语法", "语法点", "文法", "grammar"]);

/** 一行文字是不是「生词/例句/语法」区域的标题（忽略开头的 # 和大小写）。 */
function sectionKind(line: string): SectionKind | null {
  const t = line.trim().replace(/^#+\s*/, "").toLowerCase();
  if (WORD_TITLES.has(t)) return "word";
  if (EXAMPLE_TITLES.has(t)) return "example";
  if (GRAMMAR_TITLES.has(t)) return "grammar";
  return null;
}

/**
 * 把整篇笔记纯文本按「生词 / 例句 / 语法」标记切成若干段，各自解析成卡片。
 * 没有任何这类标记时返回空数组（调用方退回「整篇解析」）。
 */
export function parseSections(text: string): CardSection[] {
  const lines = text.split(/\r?\n/);
  const sections: CardSection[] = [];
  let current: { kind: SectionKind; title: string; lines: string[] } | null = null;

  const flush = () => {
    if (!current) return;
    const cards = parseCards(current.lines.join("\n"));
    if (cards.length > 0) {
      sections.push({ kind: current.kind, title: current.title, cards });
    }
  };

  for (const line of lines) {
    // 分割线：结束当前区域（分割线之后的内容直到下一个标题前都不再归入任何区域）。
    if (line.trim() === HR_TEXT) {
      flush();
      current = null;
      continue;
    }
    const kind = sectionKind(line);
    if (kind) {
      flush();
      current = { kind, title: line.trim(), lines: [] };
    } else if (current) {
      current.lines.push(line);
    }
  }
  flush();

  return sections;
}
