// POST /api/ai/story —— 把几张生词卡拼成一段连贯短文（生词用【】包起来），供复习页「故事模式」用。
// 返回 JSON：{ "story": "正文（每个生词用【】括起来）", "translation": "中文翻译" }，前端据此把生词渲染成可点击。

import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { aiChat, AiError } from "@/lib/ai-client";

export const runtime = "nodejs";

const SYSTEM_PROMPT = `你是语言学习助手。用户会给你几个外语生词/短语（带中文释义），请用它们写一段简短、连贯、自然的短文（5~8 句话），把这些词自然地用进去。

要求：
- 正文用这些生词本身的语言写（泰语/韩语/日语/英语等，跟生词一致），不要用中文写正文；
- 每个给出的生词都要至少出现一次，并且必须用【】把它原样括起来（例如【안녕하세요】），这样前端能把它做成可点击的；
- 再写一份准确、通顺的中文翻译，放在 translation 字段；
- 只输出一个 JSON 对象，不要 Markdown 代码块、不要任何解释。字段：{"story": "短文正文（每个生词用【】括起来）", "translation": "中文翻译"}`;

/** 从模型输出里抠出 story + translation 字段（容忍代码块围栏 / 前后杂文）。 */
function parseStory(raw: string): { story: string; translation: string } {
  const text = raw.trim();
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const candidate = fenced ? fenced[1] : text;
  const start = candidate.indexOf("{");
  const end = candidate.lastIndexOf("}");
  if (start === -1 || end <= start) throw new Error("模型没有返回 JSON");
  const parsed = JSON.parse(candidate.slice(start, end + 1));
  return {
    story: String(parsed.story ?? "").trim(),
    translation: String(parsed.translation ?? "").trim(),
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

  let body: { cards?: { front: string; back?: string }[] };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "无效请求" }, { status: 400 });
  }
  // 限制生词数量与单卡长度，防一次性塞几百张词把 prompt 撑爆。
  const MAX_CARDS = 40;
  const MAX_LEN = 200;
  const cards = (body.cards ?? [])
    .map((c) => ({
      front: String(c?.front ?? "").trim().slice(0, MAX_LEN),
      back: String(c?.back ?? "").trim().slice(0, MAX_LEN),
    }))
    .filter((c) => c.front)
    .slice(0, MAX_CARDS);
  if (cards.length === 0) {
    return NextResponse.json({ error: "没有可用的生词" }, { status: 400 });
  }

  const list = cards
    .map((c) => `- ${c.front}${c.back ? `（${c.back}）` : ""}`)
    .join("\n");

  try {
    const raw = await aiChat({
      system: SYSTEM_PROMPT,
      user: `生词：\n${list}`,
      maxTokens: 2000,
    });
    const { story, translation } = parseStory(raw);
    if (!story) throw new Error("模型没有生成故事");
    return NextResponse.json({ story, translation });
  } catch (err) {
    const status = err instanceof AiError ? err.status : 500;
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: message }, { status });
  }
}
