"use client";

// callout 块在编辑器里的 React 视图：一个带彩色标签的卡片（生词=奶油金/例句=鼠尾草绿/语法=薰衣草紫/原文=灰），
// 标签不可编辑（用户删不掉），正文在下面正常输入。渲染结果跟 renderHTML 输出一致，
// 这样「分享图 / 转成闪卡」看到的 HTML 与编辑器里一致。
// 「原文」区块的标签旁有个「加假名」按钮：给这段日文正文的汉字标假名（上方对照），原地替换。

import { useState } from "react";
import { NodeViewWrapper, NodeViewContent, type NodeViewProps } from "@tiptap/react";
import {
  Sprout,
  MessageSquare,
  Puzzle,
  ScrollText,
  Loader2,
  SpellCheck2,
  Sparkles,
  ExternalLink,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { KIND_META } from "./callout-extension";
import { addFuriganaToCallout, calloutHasFurigana, removeFuriganaFromCallout } from "./furigana-apply";
import { analysisToNoteContent, type AiAnalysis } from "./ai-note";
import { hasKana } from "./kana";

const KIND_ICON: Record<string, LucideIcon> = {
  word: Sprout,
  example: MessageSquare,
  grammar: Puzzle,
  article: ScrollText,
};

export function CalloutNodeView(props: NodeViewProps) {
  const { node, editor, getPos } = props;
  const kind = node.attrs.kind ?? "word";
  const meta = KIND_META[kind] ?? KIND_META.word;
  const Icon = KIND_ICON[kind] ?? Sprout;
  // 原文块携带的来源链接（来自素材库的原始 URL）→ 标签旁显示「来源」，点击在原链接打开。
  const source = (node.attrs.source as string | null) ?? null;
  // 「加假名 / 去假名」只对含日语假名的「原文」区块显示，其它语言不打扰。
  const showFurigana = kind === "article" && hasKana(node.textContent);
  // 已经标过假名 → 按钮变「去假名」，再点一下恢复纯原文（方便编辑）。
  const hasFurigana = showFurigana && calloutHasFurigana(node);

  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function onToggleFurigana() {
    const pos = getPos();
    if (pos == null) return;
    setBusy(true);
    setErr(null);
    try {
      if (calloutHasFurigana(node)) removeFuriganaFromCallout(editor, pos);
      else await addFuriganaToCallout(editor, pos);
      setBusy(false);
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
      setBusy(false);
    }
  }

  const [analyzing, setAnalyzing] = useState(false);
  const [analyzeErr, setAnalyzeErr] = useState<string | null>(null);

  // 「精读笔记」：把这段原文交给 AI，替换成「带高亮/下划线/假名/译文的原文 + 生词/例句/语法」块。
  async function onAnalyze() {
    const pos = getPos();
    if (pos == null) return;
    const text = node.textContent.trim();
    if (!text) {
      setAnalyzeErr("这段原文还没有内容");
      return;
    }
    setAnalyzing(true);
    setAnalyzeErr(null);
    try {
      const res = await fetch("/api/ai/analyze", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ text }),
        signal: AbortSignal.timeout(120_000),
      });
      const data = await res.json();
      if (!res.ok) {
        setAnalyzeErr(data?.error ?? "AI 精读失败");
        return;
      }
      const analysis = data as AiAnalysis;
      // 继承原「原文」块的来源链接，重建后「来源」标识不丢。
      const content = analysisToNoteContent(analysis, text, node.attrs.source as string | null).content ?? [];
      editor
        .chain()
        .deleteRange({ from: pos, to: pos + node.nodeSize })
        .insertContentAt(pos, content)
        .run();
    } catch (e) {
      setAnalyzeErr(e instanceof Error ? e.message : String(e));
    } finally {
      setAnalyzing(false);
    }
  }

  return (
    <NodeViewWrapper className="callout" data-kind={kind}>
      <div
        className="callout-label flex items-center gap-1"
        contentEditable={false}
        style={{ color: meta.color }}
      >
        <Icon className="h-3.5 w-3.5" />
        {meta.label}
        {kind === "article" && source && (
          <a
            href={source}
            target="_blank"
            rel="noreferrer"
            title="在原始链接打开原文"
            className="ml-1 inline-flex items-center gap-0.5 rounded px-1.5 py-0.5 text-[11px] font-medium text-zinc-400 transition-colors hover:bg-zinc-100 hover:text-teal-600"
          >
            <ExternalLink className="h-3 w-3" />
            来源
          </a>
        )}
        {kind === "article" && (
          <button
            type="button"
            onClick={onAnalyze}
            disabled={analyzing}
            title="精读笔记：提取生词 / 例句 / 语法（替换这段原文，结果插在下面）"
            className="ml-1 inline-flex items-center gap-0.5 rounded px-1.5 py-0.5 text-[11px] font-medium text-zinc-400 transition-colors hover:bg-zinc-100 hover:text-teal-600 disabled:opacity-50"
          >
            {analyzing ? (
              <Loader2 className="h-3 w-3 animate-spin" />
            ) : (
              <Sparkles className="h-3 w-3" />
            )}
            精读笔记
          </button>
        )}
        {showFurigana && (
          <button
            type="button"
            onClick={onToggleFurigana}
            disabled={busy}
            title={hasFurigana ? "去掉上方假名，恢复原文" : "给这段日文原文的汉字标注假名（上方对照）"}
            className="ml-1 inline-flex items-center gap-0.5 rounded px-1.5 py-0.5 text-[11px] font-medium text-zinc-400 transition-colors hover:bg-zinc-100 hover:text-teal-600 disabled:opacity-50"
          >
            {busy ? (
              <Loader2 className="h-3 w-3 animate-spin" />
            ) : (
              <SpellCheck2 className="h-3 w-3" />
            )}
            {hasFurigana ? "去假名" : "加假名"}
          </button>
        )}
      </div>
      {err && <div className="px-2 pb-1 text-[11px] text-red-500">{err}</div>}
      {analyzeErr && <div className="px-2 pb-1 text-[11px] text-red-500">{analyzeErr}</div>}
      <NodeViewContent className="callout-body" />
    </NodeViewWrapper>
  );
}
