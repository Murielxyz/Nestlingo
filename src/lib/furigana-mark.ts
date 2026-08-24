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
    // 注意：ProseMirror 规定 renderHTML 里的内容占位符 0 必须是其父节点的唯一子节点，
    // 所以不能写 ["ruby", attrs, 0, ["rt", ...]]（0 和 rt 并排会抛
    // "Content hole must be the only child of its parent node"）。
    // 把正文包一层 <span>，让 0 成为 span 的唯一子节点，<rt> 作为 ruby 的兄弟节点紧随其后，
    // 浏览器仍会把 <rt> 渲染到正文上方。
    return [
      "ruby",
      mergeAttributes(HTMLAttributes, { class: "furigana" }),
      ["span", { class: "furigana-base" }, 0],
      ["rt", { class: "furigana-rt", contenteditable: "false" }, reading],
    ];
  },
});
