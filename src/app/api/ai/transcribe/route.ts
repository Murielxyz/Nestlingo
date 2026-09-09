// POST /api/ai/transcribe —— 把媒体转成文字稿。
// - 音频直链（mp3/m4a/aac/wav/ogg/opus/flac）：下载后用 OpenAI Whisper 转录。
// - YouTube 视频：用 yt-dlp + 本机 Chrome 登录态抓字幕（含自动字幕）。
//   YouTube 现在对「数据中心 IP + 无登录态」的请求直接 bot 拦截（"Precondition
//   check failed"），裸请求的 youtube-transcript 已失效；带浏览器 cookie 才能过。

import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { serverFetch } from "@/lib/server-fetch";
import { transcribeAudio } from "@/lib/transcribe";
import { YTDLP_DISABLED } from "@/lib/feature-flags";

export const runtime = "nodejs";

const MAX_BYTES = 25 * 1024 * 1024; // 25MB，够播客一集了
const AUDIO_EXT = /^https?:\/\/.+\.(mp3|m4a|aac|wav|ogg|oga|opus|flac)(\?.*)?$/i;
const YT_ID_RE =
  /(?:youtube\.com\/(?:watch\?(?:[^#]*&)?v=|shorts\/|live\/|embed\/)|youtu\.be\/)([\w-]{11})/i;

// 目标语言（泰/中/韩/日/英）。抓字幕时先抓「原始语言轨」（-orig）：每个视频只有一个
// -orig（视频本身的语言），这样韩语视频出韩语、英语视频出英语，而不是一律优先英语
// （此前 en 排在 ko/ja/th 前面，非英语视频会误抓英文翻译字幕）。
const TARGET_LANGS = ["en", "th", "zh-Hans", "zh-Hant", "zh", "ja", "ko"];
const LANG_PREF = [...TARGET_LANGS.map((l) => `${l}-orig`), ...TARGET_LANGS];

const execFileAsync = promisify(execFile);

/** 读代理地址（与 server-fetch 一致）；yt-dlp 不会自动读大写的 HTTPS_PROXY。 */
function proxyUrl(): string | undefined {
  const p = process.env.HTTPS_PROXY || process.env.HTTP_PROXY || process.env.ALL_PROXY;
  return p?.trim() || undefined;
}

/** 把 yt-dlp 下的 .vtt 转成纯文字：只取「整行快照」，跳过逐字滚动的 <c> 行，避免重复。 */
function parseVtt(vtt: string): string {
  const out: string[] = [];
  for (const block of vtt.split(/\n[ \t]*\n/)) {
    if (block.includes("<c>")) continue; // 逐字滚动行是冗余的，跳过
    const text = block
      .split("\n")
      .filter((l) => !l.includes("-->"))
      .filter((l) => !/^(WEBVTT|Kind:|Language:|NOTE|STYLE)/.test(l.trim()))
      .map((l) => l.replace(/<[^>]*>/g, "").trim())
      .filter(Boolean)
      .join(" ");
    if (text) out.push(text);
  }
  return out.join(" ").replace(/\s+/g, " ").trim();
}

/**
 * 抓取 YouTube 字幕并拼成纯文字。
 * - 有字幕（含自动）→ 返回文字；
 * - 操作成功但真没字幕 → 返回 null（交给调用方切换「听声转录」）；
 * - yt-dlp 被拦 / 执行报错 → 抛出带中文提示的错误（环境问题，试听声也没意义）。
 */
async function fetchYouTubeSubtitles(videoId: string): Promise<string | null> {
  // 用 yt-dlp + Chrome 登录态抓字幕（含自动字幕）。YouTube 对无登录态请求直接
  // bot 拦截，youtube-transcript 那种裸请求已失效；带浏览器 cookie 才能过。
  const tmpDir = mkdtempSync(join(tmpdir(), "yt-subs-"));
  const outBase = join(tmpDir, "subs");
  const args = [
    "-m", "yt_dlp",
    "--cookies-from-browser", "chrome",
    "--skip-download",
    "--ignore-no-formats-error", // 无 JS 运行时拿不到媒体流，但字幕不受影响，忽略该错
    "--write-subs", "--write-auto-subs",
    "--sub-langs", LANG_PREF.join(","),
    "--sub-format", "vtt",
    "--no-warnings",
    "--output", outBase,
  ];
  const proxy = proxyUrl();
  if (proxy) args.push("--proxy", proxy);
  args.push(`https://www.youtube.com/watch?v=${videoId}`);

  let stderr = "";
  try {
    await execFileAsync("python3", args, { timeout: 90_000, maxBuffer: 10 * 1024 * 1024 });
  } catch (err) {
    stderr = (err as { stderr?: string }).stderr ?? String(err);
  }

  // 按偏好顺序读下载到的 .vtt。
  try {
    const files = readdirSync(tmpDir).filter((f) => f.endsWith(".vtt"));
    for (const lang of LANG_PREF) {
      const hit = files.find((f) => f === `subs.${lang}.vtt`);
      if (!hit) continue;
      const text = parseVtt(readFileSync(join(tmpDir, hit), "utf8"));
      if (text) {
        rmSync(tmpDir, { recursive: true, force: true });
        return text;
      }
    }
  } catch {
    /* 读文件异常就走下面 */
  }
  rmSync(tmpDir, { recursive: true, force: true });

  // 区分「被 YouTube 拦截 / 代理问题」和「真没字幕」。
  const blocked = /bot|sign in|precondition|challenge|proxy|connect|timed out|failed|SSL|EOF|violation/i.test(stderr);
  if (blocked) {
    throw new Error(
      "被 YouTube 拦截了——它要求登录态。请确认本机 Chrome 已登录 YouTube、.env.local 里 HTTPS_PROXY 已配置，然后重启 dev 再试。"
    );
  }
  return null; // 真没字幕 → 调用方切到「听声转录」
}

/** 常见音频扩展名 → Whisper 可识别的 MIME。 */
const AUDIO_MIME: Record<string, string> = {
  m4a: "audio/mp4",
  mp4: "audio/mp4",
  webm: "audio/webm",
  opus: "audio/ogg",
  ogg: "audio/ogg",
  oga: "audio/ogg",
  mp3: "audio/mpeg",
  aac: "audio/aac",
  mpeg: "audio/mpeg",
  wav: "audio/wav",
  flac: "audio/flac",
};

/**
 * 无字幕视频的「听声转录」：用 yt-dlp 下载纯音频（bestaudio 原生格式，不转码、免 ffmpeg），
 * 交给 Whisper 转写成文字。仅当字幕抓不到时才走到这一步，成本较高，适合较短视频。
 */
async function fetchYouTubeAudioTranscript(videoId: string): Promise<string> {
  const tmpDir = mkdtempSync(join(tmpdir(), "yt-audio-"));
  const outBase = join(tmpDir, "audio");
  const args = [
    "-m", "yt_dlp",
    "--cookies-from-browser", "chrome",
    "-f", "bestaudio",
    "--max-filesize", "25m", // 下载阶段就限制大小，避免长视频整块下进内存后才被 25MB 检查拒掉
    "--no-playlist",
    "--no-warnings",
    "--output", outBase,
  ];
  const proxy = proxyUrl();
  if (proxy) args.push("--proxy", proxy);
  args.push(`https://www.youtube.com/watch?v=${videoId}`);

  let stderr = "";
  try {
    await execFileAsync("python3", args, { timeout: 180_000, maxBuffer: 30 * 1024 * 1024 });
  } catch (err) {
    stderr = (err as { stderr?: string }).stderr ?? String(err);
  }

  // 找到真正下载到的音频文件（排除 .part/.vtt 等中间产物）。
  let file: string | undefined;
  try {
    file = readdirSync(tmpDir).find((f) =>
      /\.(m4a|webm|mp3|ogg|opus|aac|mpeg|mp4|wav|flac)$/i.test(f)
    );
  } catch {
    /* 读不了目录 → 下面走报错 */
  }

  if (!file) {
    rmSync(tmpDir, { recursive: true, force: true });
    throw new Error(
      "没能下载到这个视频的音频（可能被 YouTube 拦截，或视频没有音频轨）。" +
        (stderr ? ` 详情：${stderr.slice(0, 300)}` : "")
    );
  }

  const buf = readFileSync(join(tmpDir, file));
  rmSync(tmpDir, { recursive: true, force: true });

  if (buf.byteLength > MAX_BYTES) {
    throw new Error(
      "这段音频超过 25MB（视频可能太长）——Whisper 转录会比较贵。建议换更短的片段或先剪辑再试。"
    );
  }

  // Buffer 可能只是底层大缓冲的 view，切出精确的 ArrayBuffer 再交给 Whisper。
  const buffer = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) as ArrayBuffer;
  const ext = (file.match(/\.([a-z0-9]+)$/i)?.[1] ?? "webm").toLowerCase();
  return transcribeAudio(buffer, `audio.${ext}`, AUDIO_MIME[ext] ?? "audio/webm");
}

export async function POST(req: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "未登录" }, { status: 401 });
  }

  let body: { url?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "无效请求" }, { status: 400 });
  }
  const url = (body.url ?? "").trim();
  if (!url) {
    return NextResponse.json({ error: "没有媒体链接" }, { status: 400 });
  }

  // ===== YouTube：先抓字幕；没字幕就「听声转录」（下载音频交给 Whisper） =====
  const yt = url.match(YT_ID_RE);
  if (yt?.[1]) {
    if (YTDLP_DISABLED) {
      return NextResponse.json({ error: "此功能暂未启用" }, { status: 503 });
    }
    try {
      const subText = await fetchYouTubeSubtitles(yt[1]);
      if (subText) return NextResponse.json({ text: subText });
      // 真没字幕 → 听到什么转什么。
      const text = await fetchYouTubeAudioTranscript(yt[1]);
      return NextResponse.json({ text, via: "audio" });
    } catch (err) {
      return NextResponse.json(
        { error: err instanceof Error ? err.message : "文字稿生成失败" },
        { status: 502 }
      );
    }
  }

  // ===== 音频：转录（收音频直链，下载后交给共享的转写逻辑） =====
  if (!AUDIO_EXT.test(url)) {
    return NextResponse.json(
      { error: "这个链接不是可识别的音频文件（支持 mp3 / m4a / aac / wav / ogg / opus / flac 直链）" },
      { status: 400 }
    );
  }

  let audioBuffer: ArrayBuffer;
  try {
    // 带超时下载（AbortSignal.timeout 在 Node 18+ 可用）。
    const res = await serverFetch(url, { signal: AbortSignal.timeout(60_000) });
    if (!res.ok) {
      return NextResponse.json(
        { error: `下载音频失败（${res.status}）` },
        { status: 502 }
      );
    }
    const buf = await res.arrayBuffer();
    if (buf.byteLength > MAX_BYTES) {
      return NextResponse.json(
        { error: "音频太大（超过 25MB），请换成较短的片段或压缩后再试" },
        { status: 400 }
      );
    }
    audioBuffer = buf;
  } catch (err) {
    return NextResponse.json(
      { error: `下载音频失败：${err instanceof Error ? err.message : String(err)}` },
      { status: 502 }
    );
  }

  try {
    // 从 URL 猜扩展名，Whisper 依赖文件名判断格式（可选，但更稳）。
    const extMatch = url.match(/\.([a-z0-9]+)(?:\?.*)?$/i);
    const ext = extMatch?.[1]?.toLowerCase() ?? "mp3";
    const mime = `audio/${ext === "oga" ? "ogg" : ext}`;
    const text = await transcribeAudio(audioBuffer, `audio.${ext}`, mime);
    return NextResponse.json({ text });
  } catch (err) {
    return NextResponse.json(
      { error: `转录异常：${err instanceof Error ? err.message : String(err)}` },
      { status: 500 }
    );
  }
}
