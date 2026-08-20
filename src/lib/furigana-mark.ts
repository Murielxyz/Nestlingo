// 日语「振り仮名」mark：给片假名文本在上方标平假名读音，渲染成 <ruby>…<rt>…</rt></ruby>。
// 纯显示标注：docToText 只取正文（片假名），不取 rt 读音，所以不影响「转成闪卡 / 搜索」。

import { Mark, mergeAttributes } from "@tiptap/core";

export const Furigana = Mark.create({
  name: "furigana",

  addAttributes() {
    return {
      rt: {
        default: "",
        parseHTML: (el) => el.querySelector("rt")?.textContent ?? "",
        renderHTML: (attrs) => ({ "data-rt": attrs.rt }),
      },
    };
  },

  parseHTML() {
    return [{ tag: "ruby" }];
  },

  renderHTML({ HTMLAttributes }) {
    const reading = (HTMLAttributes["data-rt"] as string) ?? "";
    return [
      "ruby",
      mergeAttributes(HTMLAttributes, { class: "furigana" }),
      0,
      ["rt", { class: "furigana-rt", contenteditable: "false" }, reading],
    ];
  },
});
