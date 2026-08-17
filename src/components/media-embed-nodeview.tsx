"use client";

// 内嵌媒体节点在编辑器里的 React 视图：真 iframe / <audio controls> + 下方动作栏
// （生成文字稿 / AI 精读 / 删除）。文字稿、精读内容都插到节点正下方。

import { useState } from "react";
import { NodeViewWrapper } from "@tiptap/react";
import type { NodeViewProps } from "@tiptap/react";
import type { Editor } from "@tiptap/core";
import { AudioLines, Sparkles, Trash2 } from "lucide-react";
import { analysisToNoteContent, type AiAnalysis } from "@/lib/ai-note";
import type { MediaEmbedAttrs } from "@/lib/media-embed-extension";

/** 收集媒体节点之后、到下一个 分割线/标题/媒体 为止的纯文本（AI 精读用）。 */
function followingText(editor: Editor, from: number): { text: string; end: number } {
  const doc = editor.state.doc;
  let end = doc.content.size;
  let stop = false;
  doc.nodesBetween(from, end, (n, p) => {
    if (stop) return false;
    if (p <= from) return;
    if (
      n.type.name === "horizontalRule" ||
      n.type.name === "heading" ||
      n.type.name === "mediaEmbed"
    ) {
      end = p;
      stop = true;
      return false;
    }
  });
  return { text: doc.textBetween(from, end, "\n").trim(), end };
}

export function MediaEmbedNodeView(props: NodeViewProps) {
  const { node, editor, getPos, deleteNode } = props;
  const attrs = node.attrs as MediaEmbedAttrs;
  const [busy, setBusy] = useState<"transcribe" | "analyze" | null>(null);
  const [error, setError] = useState<string | null>(null);

  const pos = getPos() as number;
  const insertAfter = pos + node.nodeSize;

  async function transcribe() {
    setBusy("transcribe");
    setError(null);
    try {
      const res = await fetch("/api/ai/transcribe", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ url: attrs.src }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data?.error ?? "转录失败");
        return;
      }
      const text = typeof data?.text === "string" ? data.text.trim() : "";
      if (!text) {
        setError("转录结果为空");
        return;
      }
      editor
        .chain()
        .insertContentAt(insertAfter, {
          type: "paragraph",
          content: [{ type: "text", text }],
        })
        .run();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  }

  async function analyze() {
    const range = followingText(editor, insertAfter);
    if (!range.text) {
      setError("这个媒体下方还没有文字稿，请先生成文字稿或粘贴文字。");
      return;
    }
    setBusy("analyze");
    setError(null);
    try {
      const res = await fetch("/api/ai/analyze", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ text: range.text }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data?.error ?? "AI 分析失败");
        return;
      }
      const analysis = data as AiAnalysis;
      const content = analysisToNoteContent(analysis).content ?? [];
      editor.chain().insertContentAt(range.end, content).run();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  }

  return (
    <NodeViewWrapper data-media-embed="true" data-kind={attrs.kind} className="media-embed">
      {/* 嵌入播放器 */}
      <div className="overflow-hidden rounded-xl border border-zinc-200 bg-black/5">
        {attrs.kind === "youtube" ? (
          <div className="aspect-video w-full">
            <iframe
              src={attrs.src}
              title={attrs.title || "视频"}
              className="h-full w-full"
              allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
              allowFullScreen
            />
          </div>
        ) : (
          <div className="px-3 py-3">
            <audio controls src={attrs.src} className="w-full" />
          </div>
        )}
      </div>

      {/* 动作栏 */}
      <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
        {attrs.kind === "audio" && (
          <button
            type="button"
            onClick={transcribe}
            disabled={busy !== null}
            className="inline-flex items-center gap-1 rounded-lg border border-zinc-200 bg-white px-2.5 py-1 text-xs font-medium text-zinc-600 transition-colors hover:bg-zinc-50 disabled:opacity-50"
          >
            <AudioLines className="h-3.5 w-3.5" />
            {busy === "transcribe" ? "转录中…" : "生成文字稿"}
          </button>
        )}
        <button
          type="button"
          onClick={analyze}
          disabled={busy !== null}
          className="inline-flex items-center gap-1 rounded-lg border border-zinc-200 bg-white px-2.5 py-1 text-xs font-medium text-zinc-600 transition-colors hover:bg-zinc-50 disabled:opacity-50"
        >
          <Sparkles className="h-3.5 w-3.5" />
          {busy === "analyze" ? "分析中…" : "AI 精读"}
        </button>
        <button
          type="button"
          onClick={() => deleteNode()}
          className="inline-flex items-center gap-1 rounded-lg px-2 py-1 text-xs font-medium text-zinc-400 transition-colors hover:bg-red-50 hover:text-red-600"
          title="删除媒体"
        >
          <Trash2 className="h-3.5 w-3.5" />
          删除
        </button>
      </div>

      {error && <p className="mt-1 text-xs text-red-600">{error}</p>}
    </NodeViewWrapper>
  );
}
