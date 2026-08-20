"use client";

// 内嵌媒体节点在编辑器里的 React 视图：真 iframe / <audio controls> + 下方动作栏
// （生成文字稿 / AI 精读 / 悬浮播放 / 删除）。文字稿、精读内容都插到节点正下方。
// 「悬浮播放」把播放器钉到右下角，滚动长文稿时也能边看边听。

import { useRef, useState } from "react";
import type { PointerEvent as ReactPointerEvent } from "react";
import { createPortal } from "react-dom";
import { NodeViewWrapper } from "@tiptap/react";
import type { NodeViewProps } from "@tiptap/react";
import type { Editor } from "@tiptap/core";
import { AudioLines, Sparkles, Trash2, PictureInPicture2, Minus, X, ZoomIn, ZoomOut } from "lucide-react";
import { analysisToNoteContent, transcriptCallout, type AiAnalysis } from "@/lib/ai-note";
import type { MediaEmbedAttrs } from "@/lib/media-embed-extension";

/** 悬浮窗估算尺寸（初始定位 + 拖拽边界用）。 */
const FLOAT_W = 340;
const FLOAT_H = 240;

/** Spotify 内嵌高度：歌单/专辑用大卡片，单曲/播客用紧凑条。 */
function spotifyHeight(src: string): number {
  return /\/(album|playlist)\//.test(src) ? 380 : 152;
}

/** 收集媒体节点之后、到下一个 分割线/标题/媒体/生词等 callout 为止的纯文本（AI 精读用）。 */
function followingText(editor: Editor, from: number): { text: string; end: number } {
  const doc = editor.state.doc;
  let end = doc.content.size;
  let stop = false;
  doc.nodesBetween(from, end, (n, p) => {
    if (stop) return false;
    if (p <= from) return;
    // 原文(article) callout 是要分析的文字稿本体，要读进去；生词/例句/语法 callout 说明已经分析过，到这就停。
    if (
      n.type.name === "horizontalRule" ||
      n.type.name === "heading" ||
      n.type.name === "mediaEmbed" ||
      (n.type.name === "callout" && (n.attrs?.kind ?? "word") !== "article")
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
  const [floating, setFloating] = useState(false);
  const [minimized, setMinimized] = useState(false);
  const [floatPos, setFloatPos] = useState<{ x: number; y: number } | null>(null);
  const [zoom, setZoom] = useState(1);
  const dragRef = useRef<{
    startX: number;
    startY: number;
    origX: number;
    origY: number;
  } | null>(null);

  const pos = getPos() as number;
  const insertAfter = pos + node.nodeSize;

  async function transcribe() {
    setBusy("transcribe");
    setError(null);
    try {
      // 带超时：音频要下载 + Whisper，给足 3 分钟；避免一直卡在「转录中」。
      const res = await fetch("/api/ai/transcribe", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ url: attrs.src }),
        signal: AbortSignal.timeout(180_000),
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
      // 文字稿包进「原文」callout，转成闪卡时会自动跳过，不会被当成卡片。
      editor.chain().insertContentAt(insertAfter, transcriptCallout(text)).run();
    } catch (e) {
      setError(
        e instanceof DOMException && e.name === "TimeoutError"
          ? "转录超时，请稍后再试或缩短音频。"
          : e instanceof Error
            ? e.message
            : String(e)
      );
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
        signal: AbortSignal.timeout(120_000),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data?.error ?? "AI 分析失败");
        return;
      }
      const analysis = data as AiAnalysis;
      const content = analysisToNoteContent(analysis, range.text).content ?? [];
      // 用「原文 + 解析」替换原始文字稿：原文自动包进只读区块（转成闪卡跳过），解析块跟在后面。
      editor.chain().deleteRange({ from: insertAfter, to: range.end }).insertContentAt(insertAfter, content).run();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  }

  const title =
    attrs.title || (attrs.kind === "youtube" ? "视频" : attrs.kind === "spotify" ? "音乐" : "音频");

  const player =
    attrs.kind === "youtube" ? (
      <iframe
        src={attrs.src}
        title={title}
        className="h-full w-full"
        allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
        allowFullScreen
      />
    ) : attrs.kind === "spotify" ? (
      <iframe
        src={attrs.src}
        title={title}
        className="w-full"
        height={spotifyHeight(attrs.src)}
        frameBorder="0"
        allow="encrypted-media"
      />
    ) : (
      <audio controls src={attrs.src} className="w-full" />
    );

  // 打开悬浮播放：首次给一个右下角的初始位置，之后记住用户拖到的位置。
  function startFloating() {
    if (floatPos === null) {
      setFloatPos({
        x: Math.max(16, window.innerWidth - FLOAT_W - 16),
        y: Math.max(16, window.innerHeight - FLOAT_H - 16),
      });
    }
    setMinimized(false);
    setFloating(true);
  }

  function onDragStart(e: ReactPointerEvent<HTMLDivElement>) {
    if (!floatPos) return;
    dragRef.current = {
      startX: e.clientX,
      startY: e.clientY,
      origX: floatPos.x,
      origY: floatPos.y,
    };
    e.currentTarget.setPointerCapture(e.pointerId);
  }

  function onDragMove(e: ReactPointerEvent<HTMLDivElement>) {
    if (!dragRef.current) return;
    const dx = e.clientX - dragRef.current.startX;
    const dy = e.clientY - dragRef.current.startY;
    // 轻量钳制：至少留一条边在屏幕内，避免拖丢。
    setFloatPos({
      x: Math.min(Math.max(dragRef.current.origX + dx, 48 - FLOAT_W), window.innerWidth - 48),
      y: Math.min(Math.max(dragRef.current.origY + dy, 0), window.innerHeight - 48),
    });
  }

  function onDragEnd() {
    dragRef.current = null;
  }

  function zoomIn() {
    setZoom((z) => Math.min(1.6, Math.round((z + 0.2) * 10) / 10));
  }

  function zoomOut() {
    setZoom((z) => Math.max(0.7, Math.round((z - 0.2) * 10) / 10));
  }

  return (
    <NodeViewWrapper data-media-embed="true" data-kind={attrs.kind} className="media-embed">
      {/* 内嵌播放器（悬浮时隐藏，由右下角悬浮窗接管） */}
      {!floating && (
        <div className="overflow-hidden rounded-xl border border-zinc-200 bg-black/5">
          {attrs.kind === "youtube" ? (
            <div className="aspect-video w-full">{player}</div>
          ) : (
            <div className="px-3 py-3">{player}</div>
          )}
        </div>
      )}

      {/* 动作栏 */}
      <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
        <button
          type="button"
          onClick={() => (floating ? setFloating(false) : startFloating())}
          className="inline-flex items-center gap-1 rounded-lg border border-teal-200 bg-white px-2.5 py-1 text-xs font-medium text-teal-600 transition-colors hover:bg-teal-50"
        >
          <PictureInPicture2 className="h-3.5 w-3.5" />
          {floating ? "收起悬浮" : "悬浮播放"}
        </button>
        {attrs.kind !== "spotify" && (
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

      {/* 悬浮播放：可拖拽（标题栏），可最小化成小圆钮，滚动笔记时边看边听、不挡下方文字稿。 */}
      {floating &&
        floatPos &&
        createPortal(
          minimized ? (
            <button
              type="button"
              onClick={() => setMinimized(false)}
              style={{ left: floatPos.x, top: floatPos.y }}
              className="fixed z-50 flex h-12 w-12 items-center justify-center rounded-full bg-teal-600 text-white shadow-lg transition-transform hover:scale-105"
              aria-label="展开悬浮播放"
            >
              <PictureInPicture2 className="h-5 w-5" />
            </button>
          ) : (
            <div
              style={{ left: floatPos.x, top: floatPos.y, width: Math.round(FLOAT_W * zoom) }}
              className="fixed z-50 max-w-[calc(100vw-2rem)] overflow-hidden rounded-xl border border-zinc-200 bg-white shadow-2xl"
            >
              <div
                onPointerDown={onDragStart}
                onPointerMove={onDragMove}
                onPointerUp={onDragEnd}
                onPointerCancel={onDragEnd}
                className="flex cursor-grab touch-none select-none items-center justify-between gap-2 border-b border-zinc-100 px-3 py-2 active:cursor-grabbing"
              >
                <span className="truncate text-xs font-medium text-zinc-600">{title}</span>
                <div className="flex shrink-0 items-center gap-0.5">
                  {attrs.kind === "youtube" && (
                    <>
                      <button
                        type="button"
                        onPointerDown={(e) => e.stopPropagation()}
                        onClick={zoomOut}
                        className="rounded-md p-1 text-zinc-400 hover:bg-zinc-100 hover:text-zinc-700"
                        aria-label="缩小"
                      >
                        <ZoomOut className="h-4 w-4" />
                      </button>
                      <button
                        type="button"
                        onPointerDown={(e) => e.stopPropagation()}
                        onClick={zoomIn}
                        className="rounded-md p-1 text-zinc-400 hover:bg-zinc-100 hover:text-zinc-700"
                        aria-label="放大"
                      >
                        <ZoomIn className="h-4 w-4" />
                      </button>
                    </>
                  )}
                  <button
                    type="button"
                    onPointerDown={(e) => e.stopPropagation()}
                    onClick={() => setMinimized(true)}
                    className="rounded-md p-1 text-zinc-400 hover:bg-zinc-100 hover:text-zinc-700"
                    aria-label="最小化"
                  >
                    <Minus className="h-4 w-4" />
                  </button>
                  <button
                    type="button"
                    onPointerDown={(e) => e.stopPropagation()}
                    onClick={() => setFloating(false)}
                    className="rounded-md p-1 text-zinc-400 hover:bg-zinc-100 hover:text-zinc-700"
                    aria-label="关闭悬浮播放"
                  >
                    <X className="h-4 w-4" />
                  </button>
                </div>
              </div>
              <div className="bg-black/5">
                {attrs.kind === "youtube" ? (
                  <div className="aspect-video w-full">{player}</div>
                ) : (
                  <div className="px-3 py-3">{player}</div>
                )}
              </div>
            </div>
          ),
          document.body
        )}
    </NodeViewWrapper>
  );
}
