// 统一的大模型调用入口：按 AI_PROVIDER 在 Anthropic（Claude，原生格式）和
// DeepSeek（OpenAI 兼容格式）之间切换。三个「文本」AI 路由共用这里
// （AI 精读 / 词群智能整理 / 分类补关键词）；语音转录走 OpenAI Whisper，不在此列。
// 只用 raw fetch，不额外引 SDK。

import { serverFetch } from "@/lib/server-fetch";

export type AiChatOptions = {
  system: string;
  user: string;
  maxTokens?: number;
  temperature?: number;
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

/** 发一段 system + user 文本，拿回模型返回的纯文本。 */
export async function aiChat(opts: AiChatOptions): Promise<string> {
  const provider = (process.env.AI_PROVIDER ?? "anthropic").trim().toLowerCase();
  if (provider === "deepseek") return deepseekChat(opts);
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
    throw new AiError(`AI 调用失败（${res.status}）：${errText.slice(0, 300)}`, 502);
  }
  const data = await res.json();
  return (data.content ?? [])
    .filter((c: { type?: string }) => c.type === "text")
    .map((c: { text?: string }) => c.text ?? "")
    .join("");
}

async function deepseekChat({
  system,
  user,
  maxTokens = 4000,
  temperature = 0.3,
}: AiChatOptions): Promise<string> {
  const apiKey = process.env.DEEPSEEK_API_KEY;
  if (!apiKey) {
    throw new AiError(
      "未配置 DEEPSEEK_API_KEY（在 .env.local 里填 DeepSeek 的 API Key，并把 AI_PROVIDER 设为 deepseek）",
      400
    );
  }
  const res = await serverFetch("https://api.deepseek.com/v1/chat/completions", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: process.env.DEEPSEEK_MODEL ?? "deepseek-chat",
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
    throw new AiError(`AI 调用失败（${res.status}）：${errText.slice(0, 300)}`, 502);
  }
  const data = await res.json();
  const text = data?.choices?.[0]?.message?.content ?? "";
  return typeof text === "string" ? text : "";
}
