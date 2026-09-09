// 统一的大模型调用入口：按 AI_PROVIDER 在 Claude（原生格式）与
// DeepSeek / OpenAI / Groq / Gemini（OpenAI 兼容格式）之间切换。
// 三个「文本」AI 路由共用这里（AI 精读 / 词群智能整理 / 分类补关键词）；
// 语音转录走 transcribe.ts，不在此列。只用 raw fetch，不额外引 SDK。

import { serverFetch } from "@/lib/server-fetch";
import { getUserAiProviders } from "@/lib/supabase/queries";

export type AiProviderText = "claude" | "deepseek" | "openai" | "groq" | "gemini";
export type AiProviderVision = "claude" | "openai";

export type AiChatOptions = {
  system: string;
  user: string;
  maxTokens?: number;
  temperature?: number;
  /** 指定本次文本调用的提供商；缺省按用户设置 → .env 的 AI_PROVIDER。 */
  provider?: AiProviderText;
};

/** AI 调用错误，带上 HTTP 状态码，路由可直接拿来当响应状态。 */
export class AiError extends Error {
  status: number;
  constructor(message: string, status = 502) {
    super(message);
    this.name = "AiError";
    this.status = status;
  }
}

/** 读出当前用户为「文本」任务选的 provider；没选/出错返回 null（落回环境默认）。 */
async function userTextProvider(): Promise<AiProviderText | null> {
  try {
    const text = (await getUserAiProviders()).text;
    if (
      text === "deepseek" ||
      text === "openai" ||
      text === "claude" ||
      text === "groq" ||
      text === "gemini"
    ) {
      return text;
    }
    return null;
  } catch {
    return null;
  }
}

/** 发一段 system + user 文本，拿回模型返回的纯文本。
 *  路由优先：调用方显式 provider → 用户设置 → .env 的 AI_PROVIDER。 */
export async function aiChat(opts: AiChatOptions): Promise<string> {
  const provider = (
    opts.provider ??
    (await userTextProvider()) ??
    process.env.AI_PROVIDER ??
    "anthropic"
  )
    .trim()
    .toLowerCase();
  if (provider === "deepseek") return deepseekChat(opts);
  if (provider === "openai") return openaiChat(opts);
  if (provider === "groq") return groqChat(opts);
  if (provider === "gemini") return geminiChat(opts);
  return anthropicChat(opts);
}

async function anthropicChat({
  system,
  user,
  maxTokens = 4000,
}: AiChatOptions): Promise<string> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    throw new AiError(
      "未配置 ANTHROPIC_API_KEY（在 .env.local 里填 Anthropic 的 API Key）",
      400
    );
  }
  const res = await serverFetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    signal: AbortSignal.timeout(60_000),
    headers: {
      "content-type": "application/json",
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model: process.env.ANTHROPIC_MODEL ?? "claude-opus-5",
      max_tokens: maxTokens,
      system,
      messages: [{ role: "user", content: user }],
    }),
  });
  if (!res.ok) {
    const errText = await res.text();
    // 上游错误体详情只落服务端日志，不回传给前端（避免泄漏 provider 错误体 / 请求细节）。
    console.error(`[ai] anthropic ${res.status}`, errText.slice(0, 1000));
    throw new AiError(`AI 调用失败（${res.status}），请稍后重试`, 502);
  }
  const data = await res.json();
  return (data.content ?? [])
    .filter((c: { type?: string }) => c.type === "text")
    .map((c: { text?: string }) => c.text ?? "")
    .join("");
}

/** 把 OpenAI 兼容 provider 的上游错误体转成对用户友好的中文提示，保留原始状态码方便排查。
 *  原始错误体不回传前端，只落服务端日志。 */
function friendlyProviderError(label: string, status: number, errText: string): string {
  let code = ""; // 上游 JSON 里可能自带更精确的错误码（如 Gemini 429）
  try {
    const j = JSON.parse(errText);
    const c = j?.error?.code ?? j?.code;
    if (typeof c === "number") code = String(c);
    else if (typeof c === "string") code = c;
  } catch {
    /* 非 JSON 错误体，忽略 */
  }
  console.error(`[ai] ${label} ${status}`, errText.slice(0, 1000));
  const key = code || String(status);
  if (key === "429") {
    return `${label} 调用已达配额上限（429），本次没成功。请到 ${label === "Gemini" ? "Google AI Studio" : "该服务控制台"} 检查 API 配额或开通计费后再试。`;
  }
  if (key === "402") {
    return `${label} 需要充值 / 开通按量计费（402），本次没成功。`;
  }
  if (key === "401" || key === "403") {
    return `${label} API Key 无效或无权限（${key}），请检查 .env.local 里的 ${label.toUpperCase()}_API_KEY。`;
  }
  if (key === "404") {
    return `${label} 配置的模型不存在或已下线（404），请换一个可用模型。`;
  }
  if (key === "400") {
    return `${label} 拒绝了本次请求（400），请检查输入后重试`;
  }
  return `AI 调用失败（${label} ${status}），请稍后重试`;
}

/** OpenAI 兼容的 chat/completions 请求（DeepSeek / OpenAI / Groq / Gemini 都走这套格式，
 *  只是换 URL + 模型 + Key + 标签）。 */
async function openaiCompatChat(
  { system, user, maxTokens = 4000, temperature = 0.3 }: AiChatOptions,
  cfg: { url: string; model: string; key: string; label: string }
): Promise<string> {
  const res = await serverFetch(cfg.url, {
    method: "POST",
    signal: AbortSignal.timeout(60_000),
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${cfg.key}`,
    },
    body: JSON.stringify({
      model: cfg.model,
      messages: [
        { role: "system", content: system },
        { role: "user", content: user },
      ],
      temperature,
      max_tokens: maxTokens,
    }),
  });
  if (!res.ok) {
    const errText = await res.text();
    throw new AiError(friendlyProviderError(cfg.label, res.status, errText), res.status);
  }
  const data = await res.json();
  const text = data?.choices?.[0]?.message?.content ?? "";
  return typeof text === "string" ? text : "";
}

async function deepseekChat(opts: AiChatOptions): Promise<string> {
  const apiKey = process.env.DEEPSEEK_API_KEY;
  if (!apiKey) throw new AiError("未配置 DEEPSEEK_API_KEY（文字任务选 DeepSeek 需要）", 400);
  return openaiCompatChat(opts, {
    url: "https://api.deepseek.com/v1/chat/completions",
    model: process.env.DEEPSEEK_MODEL ?? "deepseek-chat",
    key: apiKey,
    label: "DeepSeek",
  });
}

async function openaiChat(opts: AiChatOptions): Promise<string> {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) throw new AiError("未配置 OPENAI_API_KEY（文字任务选 OpenAI 需要）", 400);
  return openaiCompatChat(opts, {
    url: "https://api.openai.com/v1/chat/completions",
    model: process.env.OPENAI_MODEL ?? "gpt-4o-mini",
    key: apiKey,
    label: "OpenAI",
  });
}

async function groqChat(opts: AiChatOptions): Promise<string> {
  const apiKey = process.env.GROQ_API_KEY;
  if (!apiKey) throw new AiError("未配置 GROQ_API_KEY（文字任务选 Groq 需要）", 400);
  return openaiCompatChat(opts, {
    url: "https://api.groq.com/openai/v1/chat/completions",
    model: process.env.GROQ_MODEL ?? "llama-3.3-70b-versatile",
    key: apiKey,
    label: "Groq",
  });
}

async function geminiChat(opts: AiChatOptions): Promise<string> {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) throw new AiError("未配置 GEMINI_API_KEY（文字任务选 Gemini 需要）", 400);
  return openaiCompatChat(opts, {
    // Gemini 走它的 OpenAI 兼容端点（原生 generateContent 也能用，这里统一 OpenAI 格式）。
    url: "https://generativelanguage.googleapis.com/v1beta/openai/chat/completions",
    model: process.env.GEMINI_MODEL ?? "gemini-3.6-flash",
    key: apiKey,
    label: "Gemini",
  });
}

export type AiVisionOptions = {
  /** 图片 base64（不含 data: 前缀）。 */
  imageBase64: string;
  /** 图片 MIME，如 image/png / image/jpeg。 */
  mediaType: string;
  prompt: string;
  maxTokens?: number;
  /** 指定本次图片识别的提供商；缺省按用户设置（无则 Claude）。 */
  provider?: AiProviderVision;
};

/** 读出当前用户为「图片」任务选的 provider；没选/出错返回 null（落回 Claude）。 */
async function userVisionProvider(): Promise<AiProviderVision | null> {
  try {
    const p = await getUserAiProviders();
    return p.vision === "openai" ? "openai" : p.vision === "claude" ? "claude" : null;
  } catch {
    return null;
  }
}

/** 视觉：读图取文字 / 内容（OCR 用）。text 任务 DeepSeek 无视觉，故只在 Claude / OpenAI 间选。 */
export async function aiVision(opts: AiVisionOptions): Promise<string> {
  const provider = opts.provider ?? (await userVisionProvider()) ?? "claude";
  if (provider === "openai") return openaiVision(opts);
  return anthropicVision(opts);
}

async function openaiVision(opts: AiVisionOptions): Promise<string> {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    throw new AiError("未配置 OPENAI_API_KEY（图片识别选 OpenAI 需要）", 400);
  }
  const res = await serverFetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    signal: AbortSignal.timeout(60_000),
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: process.env.OPENAI_VISION_MODEL ?? "gpt-4o-mini",
      max_tokens: opts.maxTokens ?? 2000,
      messages: [
        {
          role: "user",
          content: [
            { type: "text", text: opts.prompt },
            {
              type: "image_url",
              image_url: {
                url: `data:${opts.mediaType};base64,${opts.imageBase64}`,
              },
            },
          ],
        },
      ],
    }),
  });
  if (!res.ok) {
    const errText = await res.text();
    console.error(`[ai] openai-vision ${res.status}`, errText.slice(0, 1000));
    throw new AiError(`图片识别失败（OpenAI ${res.status}），请稍后重试`, 502);
  }
  const data = await res.json();
  return typeof data?.choices?.[0]?.message?.content === "string"
    ? data.choices[0].message.content
    : "";
}

async function anthropicVision(opts: AiVisionOptions): Promise<string> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    throw new AiError("未配置 ANTHROPIC_API_KEY（图片识别需要 Anthropic 的 Key）", 400);
  }
  const res = await serverFetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    signal: AbortSignal.timeout(60_000),
    headers: {
      "content-type": "application/json",
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model: process.env.ANTHROPIC_MODEL ?? "claude-opus-5",
      max_tokens: opts.maxTokens ?? 4000,
      messages: [
        {
          role: "user",
          content: [
            {
              type: "image",
              source: {
                type: "base64",
                media_type: opts.mediaType,
                data: opts.imageBase64,
              },
            },
            { type: "text", text: opts.prompt },
          ],
        },
      ],
    }),
  });
  if (!res.ok) {
    const errText = await res.text();
    console.error(`[ai] anthropic-vision ${res.status}`, errText.slice(0, 1000));
    throw new AiError(`图片识别失败（${res.status}），请稍后重试`, 502);
  }
  const data = await res.json();
  return (data.content ?? [])
    .filter((c: { type?: string }) => c.type === "text")
    .map((c: { text?: string }) => c.text ?? "")
    .join("");
}
