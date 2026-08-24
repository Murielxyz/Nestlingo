// POST /api/ai/ocr —— 图片 OCR：用 Claude 视觉把图片里的文字原样读出来（不翻译、不解释），
// 供 AI 学伴「图片输入」用。返回 { text }，前端拿到后填进输入框再发给学伴。

import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { aiVision, AiError } from "@/lib/ai-client";

export const runtime = "nodejs";

const PROMPT = `请把图片里的文字原样识别出来（OCR）。只输出图片里的文字内容，保持原语言（泰语/韩语/日语/英语/中文等），按原有顺序和段落分行；不要翻译、不要解释、不要任何多余说明。如果图片里没有文字，输出空字符串。`;

export async function POST(req: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "未登录" }, { status: 401 });
  }

  let body: { imageBase64?: string; mediaType?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "无效请求" }, { status: 400 });
  }
  const imageBase64 = (body.imageBase64 ?? "").trim();
  const mediaType = (body.mediaType ?? "image/png").trim();
  if (!imageBase64) {
    return NextResponse.json({ error: "没有图片内容" }, { status: 400 });
  }
  // 限 body 里的 base64 体积（约 10MB 原图），避免被塞超大 payload 拖垮内存/花费。
  if (imageBase64.length > 14_000_000) {
    return NextResponse.json(
      { error: "图片太大（超过约 10MB），请换一张更小的图片" },
      { status: 400 }
    );
  }

  try {
    const text = await aiVision({ imageBase64, mediaType, prompt: PROMPT });
    return NextResponse.json({ text: text.trim() });
  } catch (err) {
    const status = err instanceof AiError ? err.status : 500;
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: message }, { status });
  }
}
