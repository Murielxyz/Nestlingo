"use client";

// callout 块在编辑器里的 React 视图：一个带彩色标签的卡片（生词=天蓝/例句=草绿/语法=紫），
// 标签不可编辑（用户删不掉），正文在下面正常输入。渲染结果跟 renderHTML 输出一致，
// 这样「分享图 / 转成闪卡」看到的 HTML 与编辑器里一致。

import { NodeViewWrapper, NodeViewContent } from "@tiptap/react";
import { Sprout, MessageSquare, Puzzle, ScrollText } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { KIND_META } from "./callout-extension";

const KIND_ICON: Record<string, LucideIcon> = {
  word: Sprout,
  example: MessageSquare,
  grammar: Puzzle,
  article: ScrollText,
};

export function CalloutNodeView({ node }: { node: { attrs: { kind?: string } } }) {
  const kind = node.attrs.kind ?? "word";
  const meta = KIND_META[kind] ?? KIND_META.word;
  const Icon = KIND_ICON[kind] ?? Sprout;
  return (
    <NodeViewWrapper className="callout" data-kind={kind}>
      <div
        className="callout-label flex items-center gap-1"
        contentEditable={false}
        style={{ color: meta.color }}
      >
        <Icon className="h-3.5 w-3.5" />
        {meta.label}
      </div>
      <NodeViewContent className="callout-body" />
    </NodeViewWrapper>
  );
}
