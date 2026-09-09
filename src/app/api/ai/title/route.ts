// POST /api/ai/title —— 给一段学习内容取一个简短的主题标题。
// 用于「生成闪卡 / 导入笔记」时自动识别主题作为合集 / 笔记标题（不再用用户的原始提问当标题）。
// 复用 ai-client 的 aiChat（按 AI_PROVIDER 路由），不引 SDK。

import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { aiChat, AiError } from "@/lib/ai-client";

export const runtime = "nodejs";

const SYSTEM_PROMPT = `你是语巢（Nestlingo）的标题助手。给下面这段外语学习内容起一个简短的中文主题标题（不超过 12 个字），概括主题即可。只输出标题本身，不要引号、不要解释、不要句号或其它标点结尾。`;

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
    return NextResponse.json({ error: "没有要起标题的内容" }, { status: 400 });
  }

  try {
    const raw = await aiChat({
      system: SYSTEM_PROMPT,
      user: text.slice(0, 3000),
      maxTokens: 60,
      temperature: 0.3,
    });
    // 去掉模型偶尔带上的引号 / 括号 / 首尾空白。
    const title = raw
      .trim()
      .replace(/^["'「『【（(\s]+|["'」』】）)\s]+$/g, "")
      .replace(/[。.!！?？\s]+$/, "")
      .trim();
    return NextResponse.json({ title: title || "" });
  } catch (err) {
    const status = err instanceof AiError ? err.status : 500;
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: message }, { status });
  }
}
