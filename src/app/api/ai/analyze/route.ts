// POST /api/ai/analyze —— 把一段外语文字稿交给 Claude，整理成结构化精读笔记
// （生词 / 例句 / 语法 + 简体中文释义）。返回 JSON，供前端存成笔记再转闪卡。

import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import type { AiAnalysis } from "@/lib/ai-note";
import { aiChat, AiError } from "@/lib/ai-client";

export const runtime = "nodejs";

const SYSTEM_PROMPT = `你是语言学习助手。用户会给你一段外语文字稿（泰语、韩语、日语、英语等，可能夹带中文）。请把它整理成一份结构化精读笔记，用简体中文解释。

你必须只输出一个 JSON 对象，不要输出 Markdown 代码块、不要任何解释或前缀。JSON 的字段如下：
{
  "title": "给这份内容起一个简短的中文标题",
  "summary": "一两句话概括大意（可为空字符串）",
  "transcript": "整理后的原文文稿（见要求）",
  "transcriptTranslation": "原文的逐段中文翻译（见要求）",
  "words": [{"front": "要记的单词或短语（保留原文，写法须与 transcript 里一致）", "back": "简体中文释义", "extra": "常见搭配 / 例句 / 相关词（简体中文，可为空字符串；不要写词源或历史背景）"}],
  "sentences": [{"front": "值得精读的原句（保留原文）", "back": "简体中文翻译", "extra": "语法或用法说明、相关表达（简体中文，可为空字符串；不要背景介绍）"}],
  "grammar": [{"title": "语法点（原文 + 简短中文名）", "explanation": "语法说明（简体中文）", "example": "例句（可为空字符串）", "phrase": "该语法点在原文里出现的确切短语（保留原语言、原文写法，用于在原文下划线标注；找不到就留空字符串）"}]
}

要求：
- words 覆盖文字稿里重要的生词和短语，sentences 覆盖值得精读的句子；
- grammar 提炼值得记的语法点；
- 「拓展 / extra」列只放对学习有用的内容：常见搭配、例句、相关词 / 相关表达，不要写词源、历史或文化背景；
- transcript 是把原始字幕/文字稿整理成的干净原文：修正错别字（自动字幕常见的识别错误）、删掉重复和口水话（多余的「嗯」「啊」、重复出现的句子）、去掉无关碎片，并按语义分成自然段落（段落之间用 \\n 换行）；保留原语言原文、不翻译、不概括（概括只放 summary）；
- transcriptTranslation 是 transcript 的逐段中文翻译：把 transcript 每一段都翻成简体中文，段落之间用 \\n 换行，段数与 transcript 完全一致、一一对应（逐段对照，不要合并或拆分段落）；
- words 里每个 front、grammar 里每个 phrase 尽量用 transcript 里的原词/原短语写法，方便前端在原文里准确定位高亮/下划线；
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
    transcript: String(parsed.transcript ?? ""),
    transcriptTranslation: String(parsed.transcriptTranslation ?? ""),
    words: Array.isArray(parsed.words) ? parsed.words : [],
    sentences: Array.isArray(parsed.sentences) ? parsed.sentences : [],
    grammar: (Array.isArray(parsed.grammar) ? parsed.grammar : []).map((g: any) => ({
      title: String(g?.title ?? ""),
      explanation: String(g?.explanation ?? ""),
      example: String(g?.example ?? ""),
      phrase: String(g?.phrase ?? ""),
    })),
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
    return NextResponse.json({ error: "没有文字稿内容" }, { status: 400 });
  }
  if (text.length > 100_000) {
    return NextResponse.json(
      { error: "文字稿太长（超过 10 万字），请分段处理" },
      { status: 400 }
    );
  }

  try {
    const raw = await aiChat({ system: SYSTEM_PROMPT, user: text, maxTokens: 12000 });
    const analysis = parseJson(raw);
    return NextResponse.json(analysis);
  } catch (err) {
    const status = err instanceof AiError ? err.status : 500;
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: message }, { status });
  }
}
