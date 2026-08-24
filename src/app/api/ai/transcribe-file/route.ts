// POST /api/ai/transcribe-file —— 上传一个音频文件 → 转成文字稿，返回 { text }。
//
// 与另外两个转录端点的分工（三者共用 src/lib/transcribe.ts，Key 只留在服务端）：
//   - /api/ai/transcribe        收「媒体链接」：YouTube 抓字幕 / 音频直链转录。
//   - /api/ai/transcribe-audio  收「浏览器录音」的 blob（AI 学伴语音输入）。
//   - /api/ai/transcribe-file   收「任意客户端上传的音频文件」——Web / 手机端 / 未来的原生
//     App 都打这个端点，把一段音频转成文字稿落进笔记，保证多端同一个转录能力。
//
// 只负责转录，不做文件持久化（音频本身不存，只回文字稿）。

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
  // 用 Blob 判断（File 继承 Blob）：Node 18 没有全局 File，直接 instanceof File 会崩。
  if (!(file instanceof Blob)) {
    return NextResponse.json({ error: "没有音频文件" }, { status: 400 });
  }
  // 在读进内存前先按体积拦掉，避免一次读进几百 MB。
  const MAX_BYTES = 25 * 1024 * 1024;
  if (file.size > MAX_BYTES) {
    return NextResponse.json(
      { error: "文件太大（超过 25MB），请换成较短的音频后再试" },
      { status: 400 }
    );
  }

  try {
    const buf = await file.arrayBuffer();
    // File 有 .name，但不要直接引用全局 File 构造函数（Node 18 没有）；
    // 这里只读对象自带的 name 属性，类型上用断言即可。
    const name = (file as { name?: string }).name ?? "";
    const text = await transcribeAudio(
      buf,
      name || "audio.webm",
      file.type || "audio/webm"
    );
    return NextResponse.json({ text });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : String(err) },
      { status: 502 }
    );
  }
}
