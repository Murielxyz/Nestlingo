// 「分列」：把页面并排分成两列（精读原文/译文左右对照），不是表格、没有标题行。
// columns 是两列容器，column 是其中一列，各自装普通块内容。

import { Node, mergeAttributes } from "@tiptap/core";

export const Columns = Node.create({
  name: "columns",
  group: "block",
  content: "column+",
  defining: true,
  parseHTML() {
    return [{ tag: 'div[data-columns]' }];
  },
  renderHTML({ HTMLAttributes }) {
    return ["div", mergeAttributes(HTMLAttributes, { "data-columns": "" }), 0];
  },
});

export const Column = Node.create({
  name: "column",
  group: "block",
  content: "block+",
  defining: true,
  parseHTML() {
    return [{ tag: 'div[data-column]' }];
  },
  renderHTML({ HTMLAttributes }) {
    return ["div", mergeAttributes(HTMLAttributes, { "data-column": "" }), 0];
  },
});
