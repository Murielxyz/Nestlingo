// 把 TipTap 的 JSON 文档转成纯文本，供搜索和「转成闪卡」用。
// 关键点：表格节点序列化成 TSV（单元格用 \t、行用 \n），
// 这样粘贴进笔记的表格，转成闪卡时仍能被 parseCards 正确识别。

import type { JSONContent } from "@tiptap/core";

/** 编辑器里的「分割线」序列化成的纯文本标记（转成闪卡时按它切块）。 */
export const HR_TEXT = "———";

function inlineText(node: JSONContent): string {
  if (node.type === "text") return node.text ?? "";
  if (node.type === "hardBreak") return "\n";
  return (node.content ?? []).map(inlineText).join("");
}

function rowText(row: JSONContent): string {
  const cells = (row.content ?? []).filter(
    (n) => n.type === "tableCell" || n.type === "tableHeader"
  );
  return cells.map((c) => inlineText(c).trim()).join("\t");
}

function blockText(node: JSONContent): string {
  switch (node.type) {
    case "table": {
      const rows = (node.content ?? []).filter((n) => n.type === "tableRow");
      return rows.map(rowText).join("\n");
    }
    case "bulletList":
    case "orderedList":
      return (node.content ?? []).map(blockText).join("");
    case "listItem":
      return (node.content ?? []).map(blockText).join("");
    case "horizontalRule":
      return HR_TEXT + "\n";
    case "callout": {
      // callout 序列化成一行「生词/例句/语法」标记 + 里面各块，让 parse-sections 能按区域切分。
      const kind = (node.attrs?.kind as string) ?? "word";
      const label = kind === "example" ? "例句" : kind === "grammar" ? "语法" : "生词";
      return `${label}\n` + (node.content ?? []).map(blockText).join("");
    }
    case "paragraph":
    case "heading":
    case "blockquote":
    case "codeBlock":
      return inlineText(node) + "\n";
    default:
      return (node.content ?? []).map(blockText).join("");
  }
}

export function docToText(doc: JSONContent | null | undefined): string {
  if (!doc) return "";
  const parts = (doc.content ?? []).map(blockText);
  return parts.join("\n").replace(/\n{3,}/g, "\n\n").trim();
}
