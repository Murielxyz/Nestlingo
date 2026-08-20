// 「生词 / 例句 / 语法」区块：一个带彩色标签的 callout 块（Notion 风），
// 里面的内容（词表 / 例句 / 语法说明）在「转成闪卡」时按标签自动归为对应类型。
// 用 data-kind 标记类型；docToText 把它序列化成一行「生词 / 例句 / 语法」标记，
// parse-sections 读到这行就把下面的内容归到对应区域（旧的标题写法也兼容）。
//
// 配色（跟随 STYLE_GUIDE）：生词 = 天蓝 / 例句 = 草绿 / 语法 = 紫。
// 编辑器视图用 lucide 图标（见 callout-nodeview），renderHTML 只输出文字标签给分享图。

import { Node, mergeAttributes } from "@tiptap/core";
import { ReactNodeViewRenderer } from "@tiptap/react";
import { CalloutNodeView } from "./callout-nodeview";

export const KIND_META: Record<string, { label: string; color: string }> = {
  word: { label: "生词", color: "#38bdf8" },
  example: { label: "例句", color: "#4ade80" },
  grammar: { label: "语法", color: "#c084fc" },
  article: { label: "原文", color: "#a1a1aa" },
};

export function calloutLabel(kind: string): string {
  return KIND_META[kind]?.label ?? "生词";
}

export const Callout = Node.create({
  name: "callout",
  group: "block",
  content: "block+",
  defining: true,

  addAttributes() {
    return {
      kind: {
        default: "word",
        parseHTML: (el) => el.getAttribute("data-kind") || "word",
        renderHTML: (attrs) => ({ "data-kind": attrs.kind }),
      },
    };
  },

  parseHTML() {
    return [{ tag: "div[data-kind]" }];
  },

  // 编辑器里用 React NodeView 渲染标签（稳定、可点选、标签删不掉）；
  // renderHTML 仍然保留给 generateHTML（分享图 / 转成闪卡），两者输出结构一致。
  addNodeView() {
    return ReactNodeViewRenderer(CalloutNodeView);
  },

  renderHTML({ node, HTMLAttributes }) {
    const meta = KIND_META[node.attrs.kind as string] ?? KIND_META.word;
    return [
      "div",
      mergeAttributes(HTMLAttributes, { class: "callout" }),
      ["div", { class: "callout-label", contenteditable: "false" }, meta.label],
      ["div", { class: "callout-body" }, 0],
    ];
  },
});
