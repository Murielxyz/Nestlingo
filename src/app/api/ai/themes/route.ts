// POST /api/ai/themes —— 给定一个词群分类名，让 Claude 返回一组建议关键词，
// 用于自动把相关生词收录进该分类（匹配正面原文 + 背面中文释义）。

import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { aiChat, AiError } from "@/lib/ai-client";

export const runtime = "nodejs";

const SYSTEM_PROMPT = `你是语言学习助手。用户想建一个「生词主题分类」，用来把相关的外语生词（泰语、韩语、日语、英语等，释义是简体中文）自动归类。请根据分类名，给出一组用于匹配的关键词。

你必须只输出一个 JSON 对象，不要输出 Markdown 代码块、不要任何解释或前缀。格式：
{"keywords": ["关键词1", "关键词2", "..."]}

要求：
- 关键词用简体中文（也可含少量该主题常见的外语原文词），是会在「单词释义或原文」里出现的关键字；
- 给出 8~15 个关键词，覆盖这个主题最常见的几个子话题；
- 关键词要具体（如「口红」「粉底」而不是「化妆品」），避免太宽泛导致误归类。`;

function parseKeywords(raw: string): string[] {
  const text = raw.trim();
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const candidate = fenced ? fenced[1] : text;
  const start = candidate.indexOf("{");
  const end = candidate.lastIndexOf("}");
  if (start === -1 || end <= start) throw new Error("模型没有返回 JSON");
  const parsed = JSON.parse(candidate.slice(start, end + 1));
  const kw = Array.isArray(parsed.keywords) ? parsed.keywords : [];
  return kw.map((k: unknown) => String(k).trim()).filter(Boolean).slice(0, 20);
}

export async function POST(req: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "未登录" }, { status: 401 });
  }

  let body: { name?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "无效请求" }, { status: 400 });
  }
  const name = (body.name ?? "").trim();
  if (!name) {
    return NextResponse.json({ error: "请先填分类名" }, { status: 400 });
  }

  try {
    const raw = await aiChat({
      system: SYSTEM_PROMPT,
      user: `分类名：${name}`,
      maxTokens: 1000,
    });
    return NextResponse.json({ keywords: parseKeywords(raw) });
  } catch (err) {
    const status = err instanceof AiError ? err.status : 500;
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: message }, { status });
  }
}
