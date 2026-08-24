// POST /api/ai/transcribe-audio —— 语音转文字：接收浏览器录制的音频文件（multipart），
// 转录后返回 { text }。供 AI 学伴「语音输入」用。
// （与 /api/ai/transcribe 的区别：那个收媒体链接/YouTube，这个直接收上传的音频 blob。
//   与 /api/ai/transcribe-file 的区别：这个专收短录音，那个收任意文件。三者共用同一套转写逻辑。）

import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { transcribeAudio } from "@/lib/transcribe";

export const runtime = "nodejs";

export async function POST(req: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "未登录" }, { status: 401 });
  }

  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    return NextResponse.json({ error: "无效请求" }, { status: 400 });
  }
  const file = form.get("file");
  if (!(file instanceof Blob)) {
    return NextResponse.json({ error: "没有音频文件" }, { status: 400 });
  }
  // 在读进内存前先按体积拦掉：避免一次性把几百 MB 的 blob 全读进来再发现超限。
  const MAX_BYTES = 25 * 1024 * 1024;
  if (file.size > MAX_BYTES) {
    return NextResponse.json(
      { error: "音频太大（超过 25MB），请换成较短的片段后再试" },
      { status: 400 }
    );
  }

  try {
    const buf = await file.arrayBuffer();
    const text = await transcribeAudio(
      buf,
      "audio.webm",
      file.type || "audio/webm"
    );
    return NextResponse.json({ text });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : String(err) },
      { status: 500 }
    );
  }
}
