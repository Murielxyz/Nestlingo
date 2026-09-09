// POST /api/ai/translate —— 把「原文」callout 里的文章逐段翻成简体中文（双语对照用）。
// 输入是一个段落数组，逐段独立翻译（并发 3），返回 translations 数组与输入一一对应。
// 前端把译文段插回原文段下方（translation mark），做成双语对照；标题翻译也走这里（单段数组）。

import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { aiChat, AiError } from "@/lib/ai-client";

export const runtime = "nodejs";

const SYSTEM_PROMPT = `你是语言学习助手。把下面这段外语原文（泰语、韩语、日语、英语等，可能夹带中文）翻译成地道、自然的简体中文。

要求：
- 只输出这段的译文本身，不要输出原文、不要加任何解释、编号、前缀或 Markdown；
- 保留原语言里的专有名词（人名、地名、品牌）可适当意译，但语气和意思要准确；
- 原文几句就翻几句，不要合并、展开或补充原文没有的内容。`;

/** 并发上限 3 的 map：逐段翻译不能全量并发（长文会打爆上游限流），也不逐段串行（太慢）。 */
async function mapWithConcurrency<T, R>(
  items: T[],
  limit: number,
  fn: (item: T, index: number) => Promise<R>
): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let next = 0;
  async function worker() {
    while (next < items.length) {
      const i = next++;
      results[i] = await fn(items[i], i);
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, () => worker()));
  return results;
}

export async function POST(req: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "未登录" }, { status: 401 });
  }

  let body: { paragraphs?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "无效请求" }, { status: 400 });
  }
  if (!Array.isArray(body.paragraphs)) {
    return NextResponse.json({ error: "无效请求" }, { status: 400 });
  }
  const paragraphs = body.paragraphs
    .map((p) => (typeof p === "string" ? p.trim() : ""))
    .filter((p) => p.length > 0);
  if (paragraphs.length === 0) {
    return NextResponse.json({ error: "没有要翻译的内容" }, { status: 400 });
  }
  const totalLen = paragraphs.reduce((s, p) => s + p.length, 0);
  if (totalLen > 60_000) {
    return NextResponse.json({ error: "内容太长，请分段翻译" }, { status: 400 });
  }

  try {
    const translations = await mapWithConcurrency(paragraphs, 3, async (p) => {
      const t = await aiChat({ system: SYSTEM_PROMPT, user: p, maxTokens: 2000 });
      return t.trim();
    });
    if (translations.every((t) => !t)) {
      return NextResponse.json({ error: "模型没有返回译文，请重试" }, { status: 502 });
    }
    return NextResponse.json({ translations });
  } catch (err) {
    const status = err instanceof AiError ? err.status : 500;
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: message }, { status });
  }
}
