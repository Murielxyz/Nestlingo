// POST /api/ai/explain —— 精读「高亮即解释」：给定选中的词/短语，返回
// 词典原形（作闪卡正面）+ 音标/注音 + 词性 + 释义 + 常用词组 + 例句（例句里保留文章的变形形式）。
// 解决韩语/日语等「变形词 → 原形」的收录问题（행복한 → 행복하다）。

import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { aiChat, AiError } from "@/lib/ai-client";

export const runtime = "nodejs";

export type ExplainResult = {
  baseForm: string;
  phonetic: string;
  partOfSpeech: string;
  meaning: string;
  collocations: string;
  example: string;
};

const SYSTEM_PROMPT = `你是语言学习助手。用户从外语文章里选中了一个词或短语（泰语、韩语、日语、英语等），请你解释它。

你必须只输出一个 JSON 对象，不要 Markdown 代码块、不要任何解释或前缀。JSON 字段如下：
{
  "baseForm": "词典原形（韩语把 -하다/-한/-는 等变形还原成词典形，日语动词还原成基本形，泰语/英语保持原样；作为闪卡正面）",
  "phonetic": "注音（英语给国际音标 IPA；泰语给罗马音并带声调符号，如 ก๋วยเตี๋ยว → gŭuay-dtĭieow；韩语给韩文实际发音——仅当有音变、实际发音与拼写不同时（如 연락→열락）才写，发音与拼写相同时留空；日语给罗马字；没有可留空字符串）",
  "partOfSpeech": "词性（用中文，如 名词/动词/形容词/副词 等，没有可留空字符串）",
  "meaning": "简体中文释义（简洁）",
  "collocations": "常用搭配/词组（合并为「搭配」），1~3 个，每个搭配独占一行、格式「原文 中文释义」，不同搭配用换行分隔；严禁用 +、/、顿号把多个搭配连成一行，没有可留空字符串",
  "example": "一个例句（原文 + 中文翻译），尽量保留用户选中的那个变形形式，没有可留空字符串"
}

要求：
- baseForm 一定要给词典原形；若选中的本来就是原形则保持原样。
- 释义、词组、例句都用简体中文辅助说明，原文保留。
- collocations 里不同搭配用换行分隔，每个搭配一行「原文 中文释义」，严禁用 +、/、顿号把多个搭配挤成一行。
- 只输出 JSON，不要任何多余文字。`;

/** 从模型输出里抠出第一个 JSON 对象（容忍代码块围栏 / 前后杂文）。 */
function parseJson(raw: string): ExplainResult {
  const text = raw.trim();
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const candidate = fenced ? fenced[1] : text;
  const start = candidate.indexOf("{");
  const end = candidate.lastIndexOf("}");
  if (start === -1 || end <= start) throw new Error("模型没有返回 JSON");
  const parsed = JSON.parse(candidate.slice(start, end + 1));
  return {
    baseForm: String(parsed.baseForm ?? "").trim(),
    phonetic: String(parsed.phonetic ?? "").trim(),
    partOfSpeech: String(parsed.partOfSpeech ?? "").trim(),
    meaning: String(parsed.meaning ?? "").trim(),
    collocations: String(parsed.collocations ?? "").trim(),
    example: String(parsed.example ?? "").trim(),
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

  let body: { text?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "无效请求" }, { status: 400 });
  }
  const text = (body.text ?? "").trim();
  if (!text) {
    return NextResponse.json({ error: "没有要解释的内容" }, { status: 400 });
  }
  if (text.length > 200) {
    return NextResponse.json(
      { error: "选中的内容太长，请只选中一个词或短语" },
      { status: 400 }
    );
  }

  try {
    const raw = await aiChat({ system: SYSTEM_PROMPT, user: text, maxTokens: 1000 });
    const result = parseJson(raw);
    if (!result.baseForm || !result.meaning) {
      return NextResponse.json({ error: "解释结果为空，请重试" }, { status: 502 });
    }
    return NextResponse.json(result);
  } catch (err) {
    const status = err instanceof AiError ? err.status : 500;
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: message }, { status });
  }
}
