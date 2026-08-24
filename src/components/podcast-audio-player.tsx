"use client";

// 播客风音频播放器：封面 + 标题 + 可拖进度条 + 播放/暂停 + ±15/30s + 倍速 + 静音。
// 替代原生 <audio>，素材观看页跟笔记内嵌的音频共用一套，观感一致。

import { useEffect, useRef, useState } from "react";
import { Play, Pause, RotateCcw, RotateCw, Volume2, VolumeX, Music, ExternalLink } from "lucide-react";

/** 播客风或通用音频播放器（src 换时自动复位；进度条可拖；±15/30s；倍速 1/1.25/1.5/2；静音）。
 *  openHref：原始链接，给「打开原始 App / 原文」入口（手机上可直接跳去原始播客 App）。 */
export function PodcastAudioPlayer({
  src,
  title,
  subtitle,
  cover,
  openHref,
}: {
  src: string;
  title: string;
  subtitle?: string | null;
  cover?: string | null;
  openHref?: string | null;
}) {
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const [playing, setPlaying] = useState(false);
  const [current, setCurrent] = useState(0);
  const [duration, setDuration] = useState(0);
  const [rate, setRate] = useState(1);
  const [muted, setMuted] = useState(false);

  // 换 src 时复位。
  useEffect(() => {
    setPlaying(false);
    setCurrent(0);
    setDuration(0);
  }, [src]);

  function toggle() {
    const a = audioRef.current;
    if (!a) return;
    if (a.paused) void a.play();
    else a.pause();
  }
  function seek(sec: number) {
    const a = audioRef.current;
    if (!a) return;
    a.currentTime = Math.min(Math.max(sec, 0), a.duration || 0);
    setCurrent(a.currentTime);
  }
  function skip(delta: number) {
    const a = audioRef.current;
    if (!a) return;
    seek(a.currentTime + delta);
  }
  function cycleRate() {
    const rates = [1, 1.25, 1.5, 2];
    const next = rates[(rates.indexOf(rate) + 1) % rates.length] ?? 1;
    setRate(next);
    if (audioRef.current) audioRef.current.playbackRate = next;
  }
  function toggleMute() {
    const m = !muted;
    setMuted(m);
    if (audioRef.current) audioRef.current.muted = m;
  }

  const fmt = (s: number) => {
    if (!Number.isFinite(s) || s < 0) s = 0;
    const h = Math.floor(s / 3600);
    const m = Math.floor((s % 3600) / 60);
    const sec = Math.floor(s % 60);
    const mm = h > 0 ? String(m).padStart(2, "0") : String(m);
    return `${h > 0 ? h + ":" : ""}${mm}:${String(sec).padStart(2, "0")}`;
  };

  const btn =
    "flex h-9 w-9 items-center justify-center rounded-full text-zinc-300 transition-colors hover:bg-zinc-800 hover:text-white";

  return (
    <div className="flex flex-col gap-5 bg-zinc-900 px-5 py-8 sm:flex-row sm:items-center sm:gap-6 sm:px-8">
      {/* 封面 */}
      <div className="mx-auto shrink-0 sm:mx-0">
        {cover ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={cover} alt="" className="h-32 w-32 rounded-2xl object-cover shadow-xl" loading="lazy" />
        ) : (
          <div className="flex h-32 w-32 items-center justify-center rounded-2xl bg-zinc-800 text-zinc-500">
            <Music className="h-12 w-12" />
          </div>
        )}
      </div>

      <div className="min-w-0 flex-1">
        <div className="flex items-start justify-between gap-2">
          <p className="truncate text-base font-semibold text-white" title={title}>
            {title}
          </p>
          {openHref && (
            <a
              href={openHref}
              target="_blank"
              rel="noreferrer"
              className="inline-flex shrink-0 items-center gap-1 rounded-full bg-zinc-800 px-2.5 py-1 text-xs text-zinc-300 transition-colors hover:bg-zinc-700 hover:text-white"
              title="打开原始链接（手机上可跳去原始 App）"
            >
              <ExternalLink className="h-3.5 w-3.5" />
              原始链接
            </a>
          )}
        </div>
        {subtitle && <p className="mt-0.5 truncate text-xs text-zinc-400">{subtitle}</p>}

        {/* 进度条：可拖到任意位置 */}
        <div className="mt-4 flex items-center gap-2 text-xs tabular-nums text-zinc-400">
          <span className="shrink-0">{fmt(current)}</span>
          <input
            type="range"
            min={0}
            max={duration || 0}
            step={0.1}
            value={Math.min(current, duration || 0)}
            onChange={(e) => seek(Number(e.target.value))}
            disabled={!duration}
            className="h-1.5 flex-1 cursor-pointer appearance-none rounded-full bg-zinc-700 accent-teal-500"
            aria-label="播放进度"
          />
          <span className="shrink-0">{fmt(duration)}</span>
        </div>

        {/* 控制行 */}
        <div className="mt-3 flex items-center gap-1">
          <button onClick={cycleRate} className="inline-flex h-9 min-w-9 items-center justify-center rounded-full px-2 text-xs font-semibold text-zinc-300 hover:bg-zinc-800 hover:text-white" title="倍速">
            {rate}x
          </button>
          <button onClick={() => skip(-15)} className={btn} title="回退 15 秒" aria-label="回退 15 秒">
            <span className="relative">
              <RotateCcw className="h-5 w-5" />
              <span className="absolute inset-0 flex items-center justify-center text-[8px] font-bold text-zinc-300">15</span>
            </span>
          </button>
          <button
            onClick={toggle}
            className="mx-1 flex h-14 w-14 items-center justify-center rounded-full bg-teal-600 text-white shadow-lg transition-colors hover:bg-teal-700"
            aria-label={playing ? "暂停" : "播放"}
          >
            {playing ? <Pause className="h-7 w-7" /> : <Play className="ml-0.5 h-7 w-7" />}
          </button>
          <button onClick={() => skip(30)} className={btn} title="快进 30 秒" aria-label="快进 30 秒">
            <span className="relative">
              <RotateCw className="h-5 w-5" />
              <span className="absolute inset-0 flex items-center justify-center text-[8px] font-bold text-zinc-300">30</span>
            </span>
          </button>
          <button onClick={toggleMute} className={btn} title="静音" aria-label="静音">
            {muted ? <VolumeX className="h-5 w-5" /> : <Volume2 className="h-5 w-5" />}
          </button>
        </div>
      </div>

      <audio
        ref={audioRef}
        src={src}
        preload="metadata"
        className="hidden"
        onPlay={() => setPlaying(true)}
        onPlaying={() => setPlaying(true)}
        onPause={() => setPlaying(false)}
        onEnded={() => setPlaying(false)}
        onTimeUpdate={(e) => setCurrent(e.currentTarget.currentTime)}
        onLoadedMetadata={(e) => setDuration(e.currentTarget.duration)}
        onDurationChange={(e) => {
          const d = e.currentTarget.duration;
          if (Number.isFinite(d)) setDuration(d);
        }}
      />
    </div>
  );
}
