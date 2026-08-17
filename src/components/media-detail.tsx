"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import {
  analysisToNoteContent,
  analysisToNoteText,
  type AiAnalysis,
} from "@/lib/ai-note";
import type { MediaItem } from "@/lib/types";

/**
 * 单个媒体的详情页：嵌入播放（视频 / 音频）+ 文字稿 + 转录 + 生成精读笔记。
 * 生成的笔记是普通笔记（会出现在笔记列表），转成闪卡走既有流程。
 */
export function MediaDetail({ item }: { item: MediaItem }) {
  const router = useRouter();
  const isAudio = item.kind === "audio";

  const [title, setTitle] = useState(item.title);
  const [transcript, setTranscript] = useState(item.transcript ?? "");
  const [busy, setBusy] = useState<null | "transcribe" | "analyze" | "save" | "delete">(null);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  async function persistTranscript(text: string) {
    const supabase = createClient();
    await supabase.from("media_items").update({ transcript: text }).eq("id", item.id);
  }

  async function saveTitle() {
    setBusy("save");
    setError(null);
    const supabase = createClient();
    await supabase.from("media_items").update({ title }).eq("id", item.id);
    setBusy(null);
    router.refresh();
  }

  async function saveTranscript() {
    setBusy("save");
    setError(null);
    setSaved(false);
    await persistTranscript(transcript);
    setBusy(null);
    setSaved(true);
    router.refresh();
  }

  /** 音频 → Whisper 转录成文字稿。 */
  async function transcribe() {
    setBusy("transcribe");
    setError(null);
    const res = await fetch("/api/ai/transcribe", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ url: item.source_url }),
    });
    const data = await res.json();
    if (!res.ok) {
      setError(data?.error ?? "转录失败。");
      setBusy(null);
      return;
    }
    setTranscript(data.text);
    await persistTranscript(data.text);
    setBusy(null);
    router.refresh();
  }

  /** 文字稿 → Claude 生成精读笔记 → 存成笔记 → 跳转到笔记页。 */
  async function analyzeAndGenerate() {
    const text = transcript.trim();
    if (!text) {
      setError("先准备文字稿（转录或粘贴），再生成精读笔记。");
      return;
    }
    setBusy("analyze");
    setError(null);
    const res = await fetch("/api/ai/analyze", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ text }),
    });
    const analysis = (await res.json()) as AiAnalysis & { error?: string };
    if (!res.ok || analysis.error) {
      setError(analysis.error ?? "生成失败。");
      setBusy(null);
      return;
    }

    const supabase = createClient();
    const { data: note, error: noteErr } = await supabase
      .from("notes")
      .insert({
        title: analysis.title || item.title || "媒体精读",
        content: analysisToNoteContent(analysis),
        content_text: analysisToNoteText(analysis),
      })
      .select("id")
      .single();
    if (noteErr || !note) {
      setError(noteErr?.message ?? "创建笔记失败。");
      setBusy(null);
      return;
    }
    await supabase.from("media_items").update({ note_id: note.id }).eq("id", item.id);
    router.push(`/notes/${note.id}`);
  }

  async function remove() {
    if (!confirm("删除这条媒体？")) return;
    setBusy("delete");
    const supabase = createClient();
    await supabase.from("media_items").delete().eq("id", item.id);
    router.replace("/media");
    router.refresh();
  }

  return (
    <div>
      {/* 顶栏 */}
      <header className="mb-5 flex items-start justify-between gap-3">
        <div className="flex items-start gap-3">
          <Link
            href="/media"
            className="mt-0.5 rounded-lg p-1.5 text-zinc-500 hover:bg-zinc-100 hover:text-zinc-900"
            aria-label="返回媒体列表"
          >
            ←
          </Link>
          <div className="min-w-0 flex-1">
            <input
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              onBlur={saveTitle}
              className="w-full rounded-lg border border-transparent bg-transparent text-xl font-bold text-zinc-900 focus:border-zinc-200 focus:bg-white focus:px-2 focus:py-1"
            />
            <p className="mt-0.5 truncate text-xs text-zinc-400">
              <a href={item.source_url} target="_blank" rel="noreferrer" className="hover:underline">
                {item.source_url}
              </a>
            </p>
          </div>
        </div>
        <button
          onClick={remove}
          disabled={busy === "delete"}
          className="rounded-lg px-2.5 py-1.5 text-xs text-zinc-400 hover:bg-red-50 hover:text-red-600"
        >
          {busy === "delete" ? "删除中…" : "删除"}
        </button>
      </header>

      {/* 嵌入播放 */}
      <div className="overflow-hidden rounded-2xl border border-zinc-200 bg-black">
        {item.kind === "youtube" && item.embed_url ? (
          <div className="aspect-video w-full">
            <iframe
              src={item.embed_url}
              title={title}
              className="h-full w-full"
              allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
              allowFullScreen
            />
          </div>
        ) : item.embed_url ? (
          <div className="flex items-center justify-center bg-zinc-900 px-4 py-10">
            <audio controls src={item.embed_url} className="w-full max-w-xl" />
          </div>
        ) : (
          <div className="flex items-center justify-center py-10 text-sm text-zinc-500">
            无法嵌入这个链接
          </div>
        )}
      </div>

      {/* 已生成笔记入口 */}
      {item.note_id && (
        <Link
          href={`/notes/${item.note_id}`}
          className="mt-4 flex items-center justify-between rounded-xl border border-teal-200 bg-teal-50 px-4 py-3 text-sm font-medium text-teal-700 hover:bg-teal-100"
        >
          <span>📝 已生成精读笔记</span>
          <span className="text-teal-500">打开 →</span>
        </Link>
      )}

      {/* 文字稿 */}
      <section className="mt-5">
        <div className="mb-2 flex items-center justify-between">
          <h2 className="text-sm font-semibold text-zinc-900">文字稿</h2>
          <div className="flex gap-2">
            {isAudio && (
              <button
                onClick={transcribe}
                disabled={busy !== null}
                className="rounded-lg border border-zinc-200 px-3 py-1.5 text-xs font-medium text-zinc-600 hover:bg-zinc-50 disabled:opacity-60"
              >
                {busy === "transcribe" ? "转录中…" : "🎙️ 语音转录"}
              </button>
            )}
            <button
              onClick={saveTranscript}
              disabled={busy !== null}
              className="rounded-lg border border-zinc-200 px-3 py-1.5 text-xs font-medium text-zinc-600 hover:bg-zinc-50 disabled:opacity-60"
            >
              {saved ? "已保存 ✓" : busy === "save" ? "保存中…" : "保存文字稿"}
            </button>
          </div>
        </div>

        {isAudio && !transcript && (
          <p className="mb-2 rounded-lg border border-zinc-100 bg-zinc-50 px-3 py-2 text-xs text-zinc-500">
            点「🎙️ 语音转录」自动转成文字；也可以直接粘贴（比如 YouTube 的「显示文字稿」复制过来）。
          </p>
        )}

        <textarea
          value={transcript}
          onChange={(e) => {
            setTranscript(e.target.value);
            setSaved(false);
          }}
          rows={10}
          placeholder="这里放文字稿：转录得到，或手动粘贴。生成精读笔记时会用到它。"
          className="w-full rounded-xl border border-zinc-200 bg-white px-3 py-2.5 text-sm leading-relaxed text-zinc-800 focus:border-teal-500 focus:outline-none"
        />
      </section>

      {/* 生成精读笔记 */}
      <div className="mt-4">
        <button
          onClick={analyzeAndGenerate}
          disabled={busy !== null}
          className="w-full rounded-xl bg-teal-600 px-4 py-3 text-sm font-semibold text-white transition-colors hover:bg-teal-700 disabled:opacity-60"
        >
          {busy === "analyze" ? "AI 生成中…" : "✨ 用 AI 生成精读笔记"}
        </button>
        <p className="mt-2 text-center text-xs text-zinc-400">
          AI 会把文字稿整理成「生词 / 例句 / 语法」笔记，之后在笔记里点「转成闪卡」即可开始记忆。
        </p>
      </div>

      {error && (
        <div className="mt-3 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          {error}
        </div>
      )}
    </div>
  );
}
