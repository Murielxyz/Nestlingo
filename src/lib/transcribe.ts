// 服务端「语音转文字」的统一封装：把所有音频 Buffer 交给 Whisper 兼容 API。
// 设计目标：多端一致 —— Web、手机端、未来的原生 App 都走同一套服务端逻辑，
// 只要各自把音频文件 POST 给某个 /api/ai/transcribe-* 端点即可，Key 从不离开服务端。
//
// 提供商选择（免费优先）：
//   - 配了 GROQ_API_KEY  → Groq 的 whisper-large-v3（免费额度大，OpenAI 兼容，换个 URL 就用）
//   否则配了 OPENAI_API_KEY → OpenAI whisper-1
//   都没配 → 抛中文错误，提示去 .env.local 填 Groq（推荐，免费）。
//
// 两种提供商都走 OpenAI 兼容的 /audio/transcriptions 协议，参数几乎一致，所以可以复用。

import { FormData as UndiciFormData } from "undici";
import { serverFetch } from "@/lib/server-fetch";
import { getUserAiProviders } from "@/lib/supabase/queries";

const MAX_BYTES = 25 * 1024 * 1024; // 25MB，Groq/OpenAI 音频上限一致

type Provider = {
  url: string;
  model: string;
  key: string;
  label: string;
};

const PROVIDERS: Record<"groq" | "openai", Omit<Provider, "key">> = {
  groq: {
    url: "https://api.groq.com/openai/v1/audio/transcriptions",
    model: "whisper-large-v3",
    label: "Groq",
  },
  openai: {
    url: "https://api.openai.com/v1/audio/transcriptions",
    model: "whisper-1",
    label: "OpenAI",
  },
};

function byProvider(name: "groq" | "openai"): Provider | null {
  const env = name === "groq" ? "GROQ_API_KEY" : "OPENAI_API_KEY";
  const key = process.env[env]?.trim();
  if (!key) return null;
  return { ...PROVIDERS[name], key };
}

/** 读出当前用户为「语音」任务选的 provider；没选/出错返回 null（落回自动/环境默认）。 */
async function userSpeechProvider(): Promise<"groq" | "openai" | null> {
  try {
    const p = await getUserAiProviders();
    return p.speech === "groq" ? "groq" : p.speech === "openai" ? "openai" : null;
  } catch {
    return null;
  }
}

/** 选提供商：优先用户指定的那个（缺 Key 则退回默认优先级 Groq → OpenAI）。 */
function pickProvider(prefer?: "groq" | "openai" | null): Provider | null {
  if (prefer) {
    const p = byProvider(prefer);
    if (p) return p;
  }
  return byProvider("groq") ?? byProvider("openai");
}

/**
 * 把一段音频转成纯文字。抛 Error（中文提示），不 return null。
 * @param buf      音频字节
 * @param filename 带扩展名的文件名（帮 API 判断格式，可传 "audio.webm" 之类）
 * @param mime     MIME 类型（如 audio/webm / audio/mp3）
 * @param prefer   可选：指定用 Groq 还是 OpenAI；缺省按用户设置 → 自动（Groq 优先）
 */
export async function transcribeAudio(
  buf: ArrayBuffer,
  filename: string,
  mime: string,
  prefer?: "groq" | "openai"
): Promise<string> {
  const provider = pickProvider(prefer ?? (await userSpeechProvider()));
  if (!provider) {
    throw new Error(
      "未配置转录 Key——在 .env.local 里填 GROQ_API_KEY（推荐，免费）或 OPENAI_API_KEY"
    );
  }
  if (buf.byteLength > MAX_BYTES) {
    throw new Error("音频太大（超过 25MB），请换成较短的片段或压缩后再试");
  }

  // 用 undici 的 FormData（跟 serverFetch 内部的 undici fetch 是同一份）；
  // 全局 FormData 会被 undici fetch 当成普通对象序列化，导致 multipart 传不上去。
  const form = new UndiciFormData();
  form.append("model", provider.model);
  form.append(
    "file",
    new Blob([buf], { type: mime || "audio/webm" }),
    filename || `audio.${extFromMime(mime)}`
  );

  const res = await serverFetch(provider.url, {
    method: "POST",
    signal: AbortSignal.timeout(60_000),
    headers: { Authorization: `Bearer ${provider.key}` },
    body: form as unknown as BodyInit,
  });

  if (!res.ok) {
    const errText = await res.text();
    // 上游错误体详情只落服务端日志，不回传给前端。
    console.error(`[transcribe] ${provider.label} ${res.status}`, errText.slice(0, 1000));
    throw new Error(`转录失败（${provider.label} ${res.status}），请稍后重试`);
  }

  const data = await res.json();
  const text = typeof data?.text === "string" ? data.text.trim() : "";
  if (!text) throw new Error("转录结果为空");
  return text;
}

/** 从 MIME 猜扩展名（Whisper 依赖文件名判断格式；大多时候用不上，纯兜底）。 */
function extFromMime(mime: string): string {
  const m = mime.toLowerCase();
  if (m.includes("mp3")) return "mp3";
  if (m.includes("mp4") || m.includes("m4a")) return "m4a";
  if (m.includes("wav")) return "wav";
  if (m.includes("ogg") || m.includes("opus")) return "ogg";
  if (m.includes("flac")) return "flac";
  if (m.includes("aac")) return "aac";
  return "webm";
}
