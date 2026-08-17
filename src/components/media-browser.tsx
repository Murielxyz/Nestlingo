"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { parseMediaUrl, KIND_LABEL } from "@/lib/media";
import type { MediaItem } from "@/lib/types";

/**
 * 媒体页主体：把收藏的 YouTube 视频 / 播客音频列成卡片，
 * 右上角「＋ 添加媒体」粘贴链接（自动识别是视频还是音频）。
 */
export function MediaBrowser({ items }: { items: MediaItem[] }) {
  const [open, setOpen] = useState(false);

  return (
    <div>
      <header className="mb-6 flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-zinc-900">媒体</h1>
          <p className="mt-1 text-sm text-zinc-500">
            把视频 / 播客转成文字稿，再精读、转闪卡。
          </p>
        </div>
        <button
          onClick={() => setOpen(true)}
          className="rounded-lg bg-teal-600 px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-teal-700"
        >
          ＋ 添加媒体
        </button>
      </header>

      {items.length === 0 ? (
        <div className="flex flex-col items-center justify-center rounded-2xl border-2 border-dashed border-zinc-200 bg-white/60 px-6 py-16 text-center">
          <div className="mb-3 text-4xl">🎬</div>
          <h2 className="text-base font-semibold text-zinc-800">还没有媒体</h2>
          <p className="mt-1 max-w-xs text-sm text-zinc-500">
            粘贴一个 YouTube 视频或播客音频链接，就能嵌入、转录、精读。
          </p>
        </div>
      ) : (
        <ul className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {items.map((m) => (
            <li key={m.id}>
              <Link
                href={`/media/${m.id}`}
                className="group flex h-full flex-col overflow-hidden rounded-2xl border border-zinc-200 bg-white transition-colors hover:border-teal-300 hover:shadow-sm"
              >
                {/* 缩略图 / 音频占位 */}
                <div className="relative aspect-video w-full bg-zinc-100">
                  {m.kind === "youtube" && m.thumbnail ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={m.thumbnail}
                      alt=""
                      className="h-full w-full object-cover"
                      loading="lazy"
                    />
                  ) : (
                    <div className="flex h-full w-full items-center justify-center text-4xl text-zinc-300">
                      🎧
                    </div>
                  )}
                  <span className="absolute left-2 top-2 rounded-full bg-black/60 px-2 py-0.5 text-[11px] font-medium text-white">
                    {KIND_LABEL[m.kind as keyof typeof KIND_LABEL] ?? m.kind}
                  </span>
                </div>

                <div className="flex flex-1 flex-col p-3">
                  <p className="line-clamp-2 min-h-[2.5rem] text-sm font-medium leading-snug text-zinc-800">
                    {m.title || "无标题"}
                  </p>
                  <div className="mt-2 flex items-center gap-2 text-xs text-zinc-400">
                    {m.transcript ? (
                      <span className="rounded-full bg-teal-50 px-2 py-0.5 font-medium text-teal-600">
                        已有文字稿
                      </span>
                    ) : (
                      <span>未转录</span>
                    )}
                    {m.note_id && (
                      <span className="rounded-full bg-zinc-100 px-2 py-0.5 font-medium text-zinc-500">
                        已生成笔记
                      </span>
                    )}
                  </div>
                </div>
              </Link>
            </li>
          ))}
        </ul>
      )}

      {open && <AddMediaModal onClose={() => setOpen(false)} />}
    </div>
  );
}

function AddMediaModal({ onClose }: { onClose: () => void }) {
  const router = useRouter();
  const [url, setUrl] = useState("");
  const [title, setTitle] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const parsed = parseMediaUrl(url);

  async function save() {
    if (!parsed) {
      setError("这个链接识别不了，请粘贴 YouTube 视频或音频直链（mp3/m4a/…）。");
      return;
    }
    setSaving(true);
    setError(null);
    const supabase = createClient();
    const { data, error: insertErr } = await supabase
      .from("media_items")
      .insert({
        title: title.trim() || parsed.title,
        source_url: url.trim(),
        kind: parsed.kind,
        embed_url: parsed.embedUrl,
        thumbnail: parsed.thumbnail,
      })
      .select("id")
      .single();
    setSaving(false);
    if (insertErr || !data) {
      setError(insertErr?.message ?? "添加失败。");
      return;
    }
    router.push(`/media/${data.id}`);
    router.refresh();
  }

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 sm:items-center sm:p-4">
      <div className="w-full rounded-t-2xl bg-white shadow-xl sm:max-w-md sm:rounded-2xl">
        <header className="flex items-start justify-between border-b border-zinc-100 px-4 py-3">
          <div>
            <h2 className="text-base font-semibold text-zinc-900">添加媒体</h2>
            <p className="mt-0.5 text-xs text-zinc-500">
              粘贴视频或音频链接，自动识别类型。
            </p>
          </div>
          <button
            onClick={onClose}
            className="rounded-lg px-2 py-1 text-zinc-400 hover:bg-zinc-100 hover:text-zinc-700"
            aria-label="关闭"
          >
            ✕
          </button>
        </header>

        <div className="space-y-3 px-4 py-3">
          <input
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            placeholder="https://www.youtube.com/watch?v=…  或  https://…/podcast.mp3"
            className="w-full rounded-lg border border-zinc-200 px-3 py-2 text-sm text-zinc-800 focus:border-teal-500 focus:outline-none"
          />
          <input
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="标题（可留空，自动填）"
            className="w-full rounded-lg border border-zinc-200 px-3 py-2 text-sm text-zinc-800 focus:border-teal-500 focus:outline-none"
          />
          {parsed && (
            <p className="text-xs text-teal-600">
              已识别为 {KIND_LABEL[parsed.kind]}
              {parsed.kind === "youtube" ? "（可嵌入播放）" : "（可转录成文字）"}
            </p>
          )}
        </div>

        <footer className="flex gap-2 border-t border-zinc-100 px-4 py-3">
          <button
            onClick={onClose}
            className="flex-1 rounded-lg border border-zinc-200 px-4 py-2 text-sm text-zinc-600 hover:bg-zinc-50"
          >
            取消
          </button>
          <button
            onClick={save}
            disabled={saving || !parsed}
            className="flex-1 rounded-lg bg-teal-600 px-4 py-2 text-sm font-semibold text-white hover:bg-teal-700 disabled:opacity-60"
          >
            {saving ? "添加中…" : "添加"}
          </button>
        </footer>

        {error && <p className="px-4 pb-3 text-sm text-red-600">{error}</p>}
      </div>
    </div>
  );
}
