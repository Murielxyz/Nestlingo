// POST /api/materials/generate —— 按「主题 + 语言」让 AI 整理一份可学习的素材正文
// （如「整理日语 N3 的所有语法知识点」），供前端存成一条 type=generated 的素材，
// 进入观看页后可再导入笔记精读/转卡。返回 { title, content }，由客户端入库。

import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { aiChat, AiError } from "@/lib/ai-client";
import { LANG_LABEL, type Lang } from "@/lib/lang-detect";

export const runtime = "nodejs";

const SYSTEM_PROMPT = `你是语言学习教材编写助手。用户会给你一个主题和一门语言，请把它整理成一份可直接阅读、可用来记词汇和语法的学习素材。

要求：
- 用简体中文说明，但要学的目标词句用原语言保留原文写法；
- 内容要成体系、分层：先一句话概括，再按知识点分成若干小节，每小节有标题；
- 每节里尽量用「条目」形式，一条一条列（标题 + 说明 + 原语言例句）；
- 适合做成闪卡的词 / 搭配 / 语法点清楚标出，方便之后提取；
- 结构清晰，用纯文本，不要 Markdown 代码块、不要前后解释性的话；
- 篇幅适中（约 800~2000 字），宁可精炼不要注水；若主题超出范围就说明并给出最接近的整理。`;

/** 把模型输出清理成干净正文：去掉围栏标记，只保留标题与正文。 */
function cleanBody(raw: string): string {
  const t = raw.trim();
  const fenced = t.match(/```(?:text|markdown|md)?\s*([\s\S]*?)```/i);
  return (fenced ? fenced[1] : t).trim();
}

export async function POST(req: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "未登录" }, { status: 401 });
  }

  let body: { topic?: string; lang?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "无效请求" }, { status: 400 });
  }
  const topic = (body.topic ?? "").trim();
  if (!topic) {
    return NextResponse.json({ error: "请输入要整理的题材。" }, { status: 400 });
  }
  if (topic.length > 500) {
    return NextResponse.json({ error: "题材太长了，请缩短。" }, { status: 400 });
  }
  const lang = (body.lang ?? "other") as Lang;

  const userText = `主题：${topic}\n语言：${LANG_LABEL[lang] ?? "其他"}\n请按上面要求整理成这份学习素材。`;
  try {
    const content = cleanBody(await aiChat({ system: SYSTEM_PROMPT, user: userText, maxTokens: 6000 }));
    if (!content) {
      return NextResponse.json({ error: "AI 没返回内容，请换个题材再试。" }, { status: 502 });
    }
    // 标题：取正文第一行（往往就是素材名），否则用主题。
    const firstLine = content.split(/\n+/).map((l) => l.trim()).find(Boolean) ?? "";
    const title = (firstLine.length > 0 && firstLine.length <= 60 ? firstLine : `AI 生成：${topic}`)
      .replace(/^[#\s]+/, "")
      .trim();
    return NextResponse.json({ title: title || `AI 生成：${topic}`, content });
  } catch (err) {
    const status = err instanceof AiError ? err.status : 500;
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: message }, { status });
  }
}
