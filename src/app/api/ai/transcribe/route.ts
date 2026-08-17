// POST /api/ai/transcribe —— 把一段音频（直链 mp3/m4a/aac/wav/ogg/opus/flac）转成文字稿。
// 用 OpenAI Whisper。音频在服务端下载后转给 OpenAI，浏览器不直接接触 API Key。

import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

export const runtime = "nodejs";

const MAX_BYTES = 25 * 1024 * 1024; // 25MB，够播客一集了
const AUDIO_EXT = /^https?:\/\/.+\.(mp3|m4a|aac|wav|ogg|oga|opus|flac)(\?.*)?$/i;

export async function POST(req: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "未登录" }, { status: 401 });
  }

  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    return NextResponse.json(
      { error: "未配置 OPENAI_API_KEY（在 .env.local 里填 OpenAI 的 API Key，用于语音转录）" },
      { status: 400 }
    );
  }

  let body: { url?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "无效请求" }, { status: 400 });
  }
  const url = (body.url ?? "").trim();
  if (!url) {
    return NextResponse.json({ error: "没有音频链接" }, { status: 400 });
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
    const res = await fetch(url, { signal: AbortSignal.timeout(60_000) });
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
    const form = new FormData();
    form.append("model", "whisper-1");
    // 从 URL 猜扩展名，Whisper 依赖文件名判断格式（可选，但更稳）。
    const extMatch = url.match(/\.([a-z0-9]+)(?:\?.*)?$/i);
    const ext = extMatch?.[1]?.toLowerCase() ?? "mp3";
    const mime = `audio/${ext === "oga" ? "ogg" : ext}`;
    // 用 Blob 而非 File：Node 18 就有全局 Blob，兼容性更好。
    form.append("file", new Blob([audioBuffer], { type: mime }), `audio.${ext}`);

    const res = await fetch("https://api.openai.com/v1/audio/transcriptions", {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}` },
      body: form,
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
