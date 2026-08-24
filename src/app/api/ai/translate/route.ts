// POST /api/ai/translate —— 把「原文」callout 里的文章逐段翻成简体中文（双语对照用）。
// 输入文本按 \n 分段，输出 translation 用 \n 分隔、段数与输入一一对应。
// 前端把译文段插回原文段下方（translation mark），做成双语对照。

import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { aiChat, AiError } from "@/lib/ai-client";

export const runtime = "nodejs";

const SYSTEM_PROMPT = `你是语言学习助手。用户会给你一篇外语文章（泰语、韩语、日语、英语等，可能夹带中文），段落之间用换行分隔。请把它逐段翻译成地道、自然的简体中文。

要求：
- 逐段翻译，段数与原文完全一致、一一对应，段落之间用换行（\\n）分隔，不要合并或拆分段落；
- 只输出译文本身，不要输出原文、不要加任何解释、编号、前缀或 Markdown；
- 保留原语言里的专有名词（人名、地名、品牌）可适当意译，但语气和意思要准确；
- 如果某一段是空行，也对应输出一个空行，保证段数对齐。`;

export async function POST(req: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "未登录" }, { status: 401 });
  }

  let body: { text?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "无效请求" }, { status: 400 });
  }
  const text = (body.text ?? "").trim();
  if (!text) {
    return NextResponse.json({ error: "没有要翻译的内容" }, { status: 400 });
  }
  if (text.length > 60_000) {
    return NextResponse.json({ error: "内容太长，请分段翻译" }, { status: 400 });
  }

  try {
    const translation = await aiChat({ system: SYSTEM_PROMPT, user: text, maxTokens: 8000 });
    if (!translation.trim()) {
      return NextResponse.json({ error: "模型没有返回译文，请重试" }, { status: 502 });
    }
    return NextResponse.json({ translation });
  } catch (err) {
    const status = err instanceof AiError ? err.status : 500;
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: message }, { status });
  }
}
