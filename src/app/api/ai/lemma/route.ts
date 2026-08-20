// POST /api/ai/lemma —— 把用户手动输入/粘贴的词还原成词典原形。
// 解决韩语/日语等「变形词 → 原形」的收录问题（행복한 → 행복하다）。
// 与 /api/ai/explain 的「原形还原」思路一致，但这里只返回原形，不生成释义/例句。

import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { aiChat, AiError } from "@/lib/ai-client";

export const runtime = "nodejs";

const SYSTEM_PROMPT = `你是语言学习助手。用户给了你一个外语词（泰语、韩语、日语、英语等），请你还原成词典原形。

你必须只输出一个 JSON 对象，不要 Markdown 代码块、不要任何解释或前缀。JSON 字段如下：
{
  "baseForm": "词典原形（韩语把 -하다/-한/-는 等变形还原成词典形，日语动词还原成基本形，泰语/英语保持原样）"
}

要求：
- 若用户给的本来就是原形，原样返回即可。
- 只输出 JSON，不要任何多余文字。`;

/** 从模型输出里抠出第一个 JSON 对象（容忍代码块围栏 / 前后杂文）。 */
function parseBaseForm(raw: string): string {
  const text = raw.trim();
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const candidate = fenced ? fenced[1] : text;
  const start = candidate.indexOf("{");
  const end = candidate.lastIndexOf("}");
  if (start === -1 || end <= start) throw new Error("模型没有返回 JSON");
  const parsed = JSON.parse(candidate.slice(start, end + 1));
  return String(parsed.baseForm ?? "").trim();
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

  let body: { text?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "无效请求" }, { status: 400 });
  }
  const text = (body.text ?? "").trim();
  if (!text) {
    return NextResponse.json({ error: "没有要还原的内容" }, { status: 400 });
  }
  if (text.length > 50) {
    return NextResponse.json({ error: "请只输入一个词" }, { status: 400 });
  }

  try {
    const raw = await aiChat({ system: SYSTEM_PROMPT, user: text, maxTokens: 200 });
    const baseForm = parseBaseForm(raw);
    if (!baseForm) {
      return NextResponse.json({ error: "还原结果为空，请重试" }, { status: 502 });
    }
    return NextResponse.json({ baseForm });
  } catch (err) {
    const status = err instanceof AiError ? err.status : 500;
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: message }, { status });
  }
}
