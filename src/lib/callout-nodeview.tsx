"use client";

// callout 块在编辑器里的 React 视图：一个带彩色标签的卡片（生词🟩/例句🟦/语法🟪），
// 标签不可编辑（用户删不掉），正文在下面正常输入。渲染结果跟 renderHTML 输出一致，
// 这样「分享图 / 转成闪卡」看到的 HTML 与编辑器里一致。

import { NodeViewWrapper, NodeViewContent } from "@tiptap/react";

const KIND_META: Record<string, { icon: string; label: string }> = {
  word: { icon: "🟩", label: "生词" },
  example: { icon: "🟦", label: "例句" },
  grammar: { icon: "🟪", label: "语法" },
};

export function CalloutNodeView({ node }: { node: { attrs: { kind?: string } } }) {
  const kind = node.attrs.kind ?? "word";
  const meta = KIND_META[kind] ?? KIND_META.word;
  return (
    <NodeViewWrapper className="callout" data-kind={kind}>
      <div className="callout-label" contentEditable={false}>
        {meta.icon} {meta.label}
      </div>
      <NodeViewContent className="callout-body" />
    </NodeViewWrapper>
  );
}
