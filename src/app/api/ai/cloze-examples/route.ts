// POST /api/ai/cloze-examples —— 给完形填空里「没有现成语境例句」的生词批量造例句。
// 每个词按它标注的语言造一句地道例句，把目标词用 ⟦ ⟧ 包起来，前端据此挖空。
// 返回 JSON：{ examples: [{ word, sentence }] }，供 ClozeSession 解析成题。

import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { aiChat, AiError } from "@/lib/ai-client";
import { LANG_LABEL, type Lang } from "@/lib/lang-detect";

export const runtime = "nodejs";

const SYSTEM_PROMPT = `你是语言学习助手。用户给你一批「生词 + 语言 + 词义」，请为每个词按它标注的语言，各造一句地道、自然、适合学习的例句，并标出要填的那个单词。

要求：
- 每个词单独造一句，句子必须包含该词，且该词的写法保留原样（不要变形，不要用近义词替代）；
- 只把「要填的那一个单词」用 ⟦ ⟧ 包起来（例如：他⟦趸卖⟧了一车菜）；
- 如果该词是短语 / 搭配（含空格或由多个词组成），句子要包含它，但只把其中最核心、最该背的那个单词用 ⟦ ⟧ 包起来（依据词义判断），不要包整个短语；
- 同时给出这句的简体中文翻译，放 translation 字段（整句翻译，不是只翻这个词）；
- 语言：thai=泰语、korean=韩语、chinese=中文、japanese=日语、other=英语；
- 只输出一个 JSON 对象，不要 Markdown 代码块、不要任何解释或前缀，格式：
{"examples":[{"word":"趸卖","sentence":"他⟦趸卖⟧了一车菜","translation":"他批发了一车菜"}]}
- examples 数量与输入一一对应；某个词实在造不出就把它跳过去（不出现在 examples 里）。`;

/** 从模型输出里抠出第一个 JSON 对象（容忍代码块围栏 / 前后杂文）。 */
function parseJson(raw: string): { examples: { word: string; sentence: string; translation: string }[] } {
  const text = raw.trim();
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const candidate = fenced ? fenced[1] : text;
  const start = candidate.indexOf("{");
  const end = candidate.lastIndexOf("}");
  if (start === -1 || end <= start) throw new Error("模型没有返回 JSON");
  const parsed = JSON.parse(candidate.slice(start, end + 1));
  const list = Array.isArray(parsed.examples) ? parsed.examples : [];
  return {
    examples: list
      .map((e: Record<string, unknown>) => ({
        word: String(e?.word ?? "").trim(),
        sentence: String(e?.sentence ?? "").trim(),
        translation: String(e?.translation ?? "").trim(),
      }))
      .filter((e: { word: string; sentence: string }) => e.word && e.sentence),
  };
}

export async function POST(req: Request) {
  // 只有登录用户能用（真正的数据安全由 RLS 兜底）。
  const supabase = await createClient();
  const {
    data: { user: authUser },
  } = await supabase.auth.getUser();
  if (!authUser) {
    return NextResponse.json({ error: "未登录" }, { status: 401 });
  }

  // 校验请求体：items 是一批 { word, lang, meaning }。限制数量与单字长度，防一次性塞海量词烧额度。
  const MAX_ITEMS = 40;
  const MAX_WORD_LEN = 100;
  let items: { word: string; lang: Lang; meaning: string }[] = [];
  try {
    const body = await req.json();
    items = (Array.isArray(body?.items) ? body.items : [])
      .map((it: Record<string, unknown>) => {
        const lang = String(it?.lang ?? "other") as Lang;
        return {
          word: String(it?.word ?? "").trim().slice(0, MAX_WORD_LEN),
          lang: lang in LANG_LABEL ? lang : ("other" as Lang),
          meaning: String(it?.meaning ?? "").trim().slice(0, MAX_WORD_LEN),
        };
      })
      .filter((it: { word: string }) => it.word)
      .slice(0, MAX_ITEMS);
  } catch {
    return NextResponse.json({ error: "请求体不是合法 JSON" }, { status: 400 });
  }
  if (items.length === 0) {
    return NextResponse.json({ error: "没有可生成例句的生词" }, { status: 400 });
  }

  const user = JSON.stringify(
    items.map((it) => ({ word: it.word, lang: LANG_LABEL[it.lang] ?? it.lang, meaning: it.meaning }))
  );

  try {
    const raw = await aiChat({ system: SYSTEM_PROMPT, user, maxTokens: 2000, temperature: 0.5 });
    const { examples } = parseJson(raw);
    return NextResponse.json({ examples });
  } catch (err) {
    const status = err instanceof AiError ? err.status : 502;
    const message =
      err instanceof Error ? err.message : "AI 生成例句失败";
    return NextResponse.json({ error: message }, { status });
  }
}
