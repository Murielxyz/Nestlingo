// 「生词 / 例句 / 语法」区块：一个带彩色标签的 callout 块（Notion 风），
// 里面的内容（词表 / 例句 / 语法说明）在「转成闪卡」时按标签自动归为对应类型。
// 用 data-kind 标记类型；docToText 把它序列化成一行「生词 / 例句 / 语法」标记，
// parse-sections 读到这行就把下面的内容归到对应区域（旧的标题写法也兼容）。
//
// 配色（浅米低饱和耐看）：生词 = 米色 / 例句 = 鼠尾草绿 / 语法 = 薰衣草紫 / 原文 = 灰。
// 编辑器与分享图共用 renderHTML（文字标签 + 来源链接），标签配色见 globals.css 的 .tiptap/.share-content 规则。

import { Node, mergeAttributes } from "@tiptap/core";
import type { Node as PMNode } from "@tiptap/pm/model";
import { calloutHasFurigana } from "./furigana-apply";

export const KIND_META: Record<string, { label: string; color: string }> = {
  word: { label: "生词", color: "#8a6b3a" },
  example: { label: "例句", color: "#4a7a5d" },
  grammar: { label: "语法", color: "#6a5fc0" },
  article: { label: "文章", color: "#a1a1aa" },
  note: { label: "", color: "#9ca3af" }, // 纯无标题备注块：label 为空 → renderHTML 不输出标签行
};

export function calloutLabel(kind: string): string {
  return KIND_META[kind]?.label ?? "生词";
}

/** 原文块里是否已生成「双语对照」（含 translation mark 的段落）。供装饰器判断要不要给「翻译」按钮上色。 */
export function calloutHasTranslation(node: PMNode): boolean {
  let found = false;
  node.descendants((n) => {
    if (n.isText && n.marks.some((m) => m.type.name === "translation")) found = true;
  });
  return found;
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
      // 原文块的来源链接（来自素材库的原始 URL）：编辑器标签旁显示「来源」，点击在原链接打开。
      source: {
        default: null,
        parseHTML: (el) => el.getAttribute("data-source") || null,
        renderHTML: (attrs) => (attrs.source ? { "data-source": attrs.source } : {}),
      },
    };
  },

  parseHTML() {
    return [{ tag: "div[data-kind]" }];
  },

  // 不再用 React NodeView：非原子 ReactNodeView 在 React 19 下与 TipTap 同步渲染冲突
  // （点工具栏插入 callout 时同步 dispatch 触发的 flushSync 会抛错 / 静默失败，导致区块不出现）。
  // 改走 renderHTML（与「分列」columns 一致），标签用 contenteditable=false 保证删不掉，
  // 正文由内容洞 0 承接，分享图 / 转成闪卡共用同一份 renderHTML。
  //
  // 「原文」callout 要在标签旁渲染操作按钮（翻译 / 精读笔记 / 加假名）。这些按钮必须由 PM 经
  // renderHTML 亲手产出（是节点 DOM 的一部分），由 callout-actions 插件在编辑器根上做委托点击。
  // 之前用 widget 装饰会渲染在 callout 块之前（跑到标签上方）；手动 appendChild 到标签又会在
  // contenteditable 里改 DOM 触发解析死循环。renderHTML 产出即无循环：分享图 / 阅读模式里这些
  // 按钮也一并输出，但会被 globals.css 的 .share-content .callout-actions 隐藏（编辑器专属）。
  renderHTML({ node, HTMLAttributes }) {
    const kind = node.attrs.kind as string;
    const meta = KIND_META[kind] ?? KIND_META.word;
    const source = node.attrs.source as string | null;

    // 「备注」纯 callout：不带标题标签，只输出正文框（内容不转卡，doc-to-text / parse-sections 跳过）。
    if (kind === "note") {
      return [
        "div",
        mergeAttributes(HTMLAttributes, { class: "callout" }),
        ["div", { class: "callout-body" }, 0],
      ];
    }

    // label 的子节点：文字标签 + 可选「来源」链接 + 可选操作按钮。
    // 每个子节点必须各自是一个合法 spec，不能把按钮塞进数组当单个子节点（PM 的 renderSpec
    // 会抛 "Invalid array passed to renderSpec"）。故用 spread 展开成兄弟子节点。
    const labelChildren: any[] = [meta.label];
    if (source) {
      labelChildren.push(["a", { href: source, target: "_blank", rel: "noreferrer", class: "callout-source" }, "来源"]);
    }
    if (node.attrs.kind === "article") {
      // 三个按钮固定输出（翻译 / 精读笔记 / 加假名）；是否显示「加假名」、是否把「翻译」涂成已译，
      // 由 callout-actions 插件的 Decoration.node 给 callout 加 no-kana / is-translated 类、CSS 决定。
      // 这样粘贴日语后能实时出现「加假名」，翻译后「翻译」按钮变已译色，而不必重跑 renderHTML。
      // 图标用等宽 unicode 符号（renderHTML 里无法安全产出 lucide SVG，见注释），样式见 globals.css。
      const has = calloutHasFurigana(node);
      const buttons: any[] = [
        ["button", { type: "button", class: "callout-action", "data-callout-action": "translate" },
          ["span", { class: "callout-action-ic", "aria-hidden": "true" }, "⇄"], "翻译"],
        ["button", { type: "button", class: "callout-action", "data-callout-action": "analyze" },
          ["span", { class: "callout-action-ic", "aria-hidden": "true" }, "✎"], "精读笔记"],
        ["button", { type: "button", class: "callout-action", "data-callout-action": "toggleFurigana" },
          ["span", { class: "callout-action-ic", "aria-hidden": "true" }, "あ"], has ? "去假名" : "加假名"],
      ];
      labelChildren.push(["span", { class: "callout-actions", contenteditable: "false" }, ...buttons]);
    }

    return [
      "div",
      mergeAttributes(HTMLAttributes, { class: "callout" }),
      ["div", { class: "callout-label", contenteditable: "false" }, ...labelChildren],
      ["div", { class: "callout-body" }, 0],
    ];
  },
});
