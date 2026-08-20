// 「译文」标记：精读「原文」块里，跟在每段原文下方的淡灰小字中文翻译。
// 渲染成 <span class="translation">，颜色/字号由 globals.css 里的 .translation 控制。
// docToText 会忽略 mark 只取文字，所以翻译不会混进「转成闪卡」的解析。

import { Mark, mergeAttributes } from "@tiptap/core";

export const Translation = Mark.create({
  name: "translation",

  addAttributes() {
    return {
      class: {
        default: "translation",
        parseHTML: (element) => element.getAttribute("class"),
        renderHTML: (attributes) => ({ class: attributes.class }),
      },
    };
  },

  parseHTML() {
    return [{ tag: "span.translation" }];
  },

  renderHTML({ HTMLAttributes }) {
    return ["span", mergeAttributes(HTMLAttributes), 0];
  },
});
