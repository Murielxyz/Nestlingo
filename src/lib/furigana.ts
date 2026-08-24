// 日语「振り仮名」标注：给文本里的汉字（kanji）标平假名读音，返回 segments（text + reading）。
// 供 /api/ai/furigana（手动加假名）与 /api/ai/analyze（日语精读自动加假名）共用。

import { aiChat } from "@/lib/ai-client";

export const FURIGANA_SYSTEM_PROMPT = `你是日语「振り仮名」标注助手。给日语文本里的汉字（kanji）标注平假名读音。

只输出一个 JSON 对象（不要 Markdown 代码块、不要任何解释或前缀）：
{ "segments": [ { "text": "今日", "reading": "きょう" }, { "text": "は", "reading": "" } ] }

规则：
- segments 按原文顺序逐段切分，所有 text 按顺序拼接必须严格等于原文（换行作为一个单独的 { "text": "\\n", "reading": "" } 段）。
- 只给「汉字」标注平假名读音（reading 填平假名）；平假名、片假名、数字、英文字母、标点、空格、换行一律 reading 为空字符串。
- 一个 text 段尽量是一个汉字或一串连读汉字（按常见读音）；不要用括号（），读音只放 reading 字段。
- 遇到多音字按最常见读音标注。`;

export type FuriganaSegment = { text: string; reading: string };

/** 从模型输出里抠出 segments（容忍代码块围栏 / 前后杂文）。 */
export function parseSegments(raw: string): FuriganaSegment[] {
  const text = raw.trim();
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const candidate = fenced ? fenced[1] : text;
  const start = candidate.indexOf("{");
  const end = candidate.lastIndexOf("}");
  if (start === -1 || end <= start) throw new Error("模型没有返回 JSON");
  const parsed = JSON.parse(candidate.slice(start, end + 1));
  const arr: unknown[] = Array.isArray(parsed.segments) ? parsed.segments : [];
  return arr
    .map((s) => {
      const o = (s ?? {}) as Record<string, unknown>;
      return { text: String(o.text ?? ""), reading: String(o.reading ?? "") };
    })
    .filter((s) => s.text.length > 0);
}

/** 给一段日语文本标假名，返回 segments。 */
export async function furiganaSegments(text: string): Promise<FuriganaSegment[]> {
  const raw = await aiChat({ system: FURIGANA_SYSTEM_PROMPT, user: text, maxTokens: 4000 });
  return parseSegments(raw);
}
