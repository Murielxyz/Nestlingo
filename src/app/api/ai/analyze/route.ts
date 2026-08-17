// POST /api/ai/analyze —— 把一段外语文字稿交给 Claude，整理成结构化精读笔记
// （生词 / 例句 / 语法 + 简体中文释义）。返回 JSON，供前端存成笔记再转闪卡。

import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import type { AiAnalysis } from "@/lib/ai-note";

export const runtime = "nodejs";

const SYSTEM_PROMPT = `你是语言学习助手。用户会给你一段外语文字稿（泰语、韩语、日语、英语等，可能夹带中文）。请把它整理成一份结构化精读笔记，用简体中文解释。

你必须只输出一个 JSON 对象，不要输出 Markdown 代码块、不要任何解释或前缀。JSON 的字段如下：
{
  "title": "给这份内容起一个简短的中文标题",
  "summary": "一两句话概括大意（可为空字符串）",
  "words": [{"front": "要记的单词或短语（保留原文）", "back": "简体中文释义", "extra": "例句或用法说明（可为空字符串）"}],
  "sentences": [{"front": "值得精读的原句（保留原文）", "back": "简体中文翻译", "extra": "语法或用法说明（可为空字符串）"}],
  "grammar": [{"title": "语法点（原文 + 简短中文名）", "explanation": "语法说明（简体中文）", "example": "例句（可为空字符串）"}]
}

要求：
- words 覆盖文字稿里重要的生词和短语，sentences 覆盖值得精读的句子；
- grammar 提炼值得记的语法点；
- 所有释义、翻译、说明都用简体中文；
- 若某类内容很少，对应数组可以为空数组；但尽量充实。`;

/** 从模型输出里抠出第一个 JSON 对象（容忍代码块围栏 / 前后杂文）。 */
function parseJson(raw: string): AiAnalysis {
  const text = raw.trim();
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const candidate = fenced ? fenced[1] : text;
  const start = candidate.indexOf("{");
  const end = candidate.lastIndexOf("}");
  if (start === -1 || end <= start) throw new Error("模型没有返回 JSON");
  const parsed = JSON.parse(candidate.slice(start, end + 1));
  return {
    title: String(parsed.title ?? ""),
    summary: String(parsed.summary ?? ""),
    words: Array.isArray(parsed.words) ? parsed.words : [],
    sentences: Array.isArray(parsed.sentences) ? parsed.sentences : [],
    grammar: Array.isArray(parsed.grammar) ? parsed.grammar : [],
  };
}

export async function POST(req: Request) {
  // 只有登录用户能用（真正的数据安全由 RLS 兜底）。
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "未登录" }, { status: 401 });
  }

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    return NextResponse.json(
      { error: "未配置 ANTHROPIC_API_KEY（在 .env.local 里填 Anthropic 的 API Key）" },
      { status: 400 }
    );
  }

  let body: { text?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "无效请求" }, { status: 400 });
  }
  const text = (body.text ?? "").trim();
  if (!text) {
    return NextResponse.json({ error: "没有文字稿内容" }, { status: 400 });
  }
  if (text.length > 100_000) {
    return NextResponse.json(
      { error: "文字稿太长（超过 10 万字），请分段处理" },
      { status: 400 }
    );
  }

  try {
    const res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: process.env.ANTHROPIC_MODEL ?? "claude-opus-5",
        max_tokens: 4000,
        system: SYSTEM_PROMPT,
        messages: [{ role: "user", content: text }],
      }),
    });

    if (!res.ok) {
      const errText = await res.text();
      return NextResponse.json(
        { error: `AI 调用失败（${res.status}）：${errText.slice(0, 300)}` },
        { status: 502 }
      );
    }

    const data = await res.json();
    const raw =
      (data.content ?? [])
        .filter((c: { type?: string }) => c.type === "text")
        .map((c: { text?: string }) => c.text ?? "")
        .join("") ?? "";

    const analysis = parseJson(raw);
    return NextResponse.json(analysis);
  } catch (err) {
    return NextResponse.json(
      { error: `AI 调用异常：${err instanceof Error ? err.message : String(err)}` },
      { status: 500 }
    );
  }
}
