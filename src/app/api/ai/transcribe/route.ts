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
import { FormData as UndiciFormData } from "undici";
import { createClient } from "@/lib/supabase/server";
import { serverFetch } from "@/lib/server-fetch";

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

/** 抓取 YouTube 字幕并拼成纯文字。失败会抛出带中文提示的错误。 */
async function fetchYouTubeTranscript(videoId: string): Promise<string> {
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
    /* 读文件异常就走下面的报错分支 */
  }
  rmSync(tmpDir, { recursive: true, force: true });

  // 区分「被 YouTube 拦截 / 代理问题」和「真没字幕」。
  const blocked = /bot|sign in|precondition|challenge|proxy|connect|timed out|failed|SSL|EOF|violation/i.test(stderr);
  throw new Error(
    blocked
      ? "被 YouTube 拦截了——它要求登录态。请确认本机 Chrome 已登录 YouTube、.env.local 里 HTTPS_PROXY 已配置，然后重启 dev 再试。"
      : "没能抓到字幕——这个视频可能没开字幕，或只有不在常用语言里的自动字幕。你可以到视频页手动复制字幕/文字稿，粘贴到笔记里视频下方，再点「AI 精读」。"
  );
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

  // ===== YouTube：抓字幕（无需 OpenAI Key） =====
  const yt = url.match(YT_ID_RE);
  if (yt?.[1]) {
    try {
      const text = await fetchYouTubeTranscript(yt[1]);
      return NextResponse.json({ text });
    } catch (err) {
      return NextResponse.json(
        { error: err instanceof Error ? err.message : "字幕抓取失败" },
        { status: 404 }
      );
    }
  }

  // ===== 音频：Whisper 转录 =====
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    return NextResponse.json(
      { error: "未配置 OPENAI_API_KEY（在 .env.local 里填 OpenAI 的 API Key，用于语音转录）" },
      { status: 400 }
    );
  }
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
    // 用 undici 的 FormData（跟 serverFetch 内部的 undici fetch 是同一份），
    // 全局 FormData 会被 undici fetch 当成普通对象序列化，导致 multipart 传不上去。
    const form = new UndiciFormData();
    form.append("model", "whisper-1");
    // 从 URL 猜扩展名，Whisper 依赖文件名判断格式（可选，但更稳）。
    const extMatch = url.match(/\.([a-z0-9]+)(?:\?.*)?$/i);
    const ext = extMatch?.[1]?.toLowerCase() ?? "mp3";
    const mime = `audio/${ext === "oga" ? "ogg" : ext}`;
    // 用 Blob 而非 File：Node 18 就有全局 Blob，兼容性更好。
    form.append("file", new Blob([audioBuffer], { type: mime }), `audio.${ext}`);

    const res = await serverFetch("https://api.openai.com/v1/audio/transcriptions", {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}` },
      body: form as unknown as BodyInit,
    });

    if (!res.ok) {
      const errText = await res.text();
      return NextResponse.json(
        { error: `转录失败（${res.status}）：${errText.slice(0, 300)}` },
        { status: 502 }
      );
    }

    const data = await res.json();
    const text = typeof data?.text === "string" ? data.text.trim() : "";
    if (!text) {
      return NextResponse.json({ error: "转录结果为空" }, { status: 502 });
    }
    return NextResponse.json({ text });
  } catch (err) {
    return NextResponse.json(
      { error: `转录异常：${err instanceof Error ? err.message : String(err)}` },
      { status: 500 }
    );
  }
}
