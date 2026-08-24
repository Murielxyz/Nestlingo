// POST /api/ai/furigana —— 给日语文本加「振り仮名」：只给汉字（kanji）标注平假名读音，
// 返回分段 segments（text + reading），前端把汉字段套成 <ruby> 上标（假名显示在汉字上方）。
// 供「原文」区块的「加假名」按钮用；/api/ai/analyze 的日语精读也会复用同一套逻辑。

import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { AiError } from "@/lib/ai-client";
import { furiganaSegments } from "@/lib/furigana";

export const runtime = "nodejs";

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
    return NextResponse.json({ error: "没有要标注的文本" }, { status: 400 });
  }
  if (text.length > 4000) {
    return NextResponse.json({ error: "文本太长，请分段标注" }, { status: 400 });
  }

  try {
    const segments = await furiganaSegments(text);
    if (segments.length === 0) {
      return NextResponse.json({ error: "标注结果为空，请重试" }, { status: 502 });
    }
    return NextResponse.json({ segments });
  } catch (err) {
    const status = err instanceof AiError ? err.status : 500;
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: message }, { status });
  }
}
