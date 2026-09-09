// POST /api/ai/cluster-cards —— 一键「AI 智能整理」：把当前用户所有生词按【含义】聚类到场景主题，
// 结果写进 cards.theme 列（词群页据此分组；删卡后该主题随之消失，无需额外清理）。

import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { aiChat, AiError } from "@/lib/ai-client";

export const runtime = "nodejs";

const THEME_KEYS = [
  "beauty",
  "game",
  "sport",
  "food",
  "travel",
  "shopping",
  "family",
  "work",
  "health",
  "feeling",
  "time",
  "weather",
  "number",
  "other",
];

const SYSTEM_PROMPT = `你是语言学习助手。下面给出一组外语生词（泰语/韩语/日语等，释义是简体中文）。请根据【含义】把每个词归到最贴切的一个场景主题。

主题 key 只能从这些里选：
beauty 美容 / game 游戏 / sport 运动 / food 食物 / travel 旅行 / shopping 购物 / family 家庭 / work 工作学习 / health 身体 / feeling 情感 / time 时间 / weather 天气 / number 数字 / other 其他

只输出一个 JSON 对象，不要 Markdown 代码块、不要任何解释。格式：
{"themes": ["food", "travel", "other", ...]}

themes 数组长度必须等于输入的词数、顺序一一对应。含义模糊、跨多个主题、或实在无法判断的，一律归 "other"。`;

function parseThemes(raw: string, count: number): string[] {
  const text = raw.trim();
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const candidate = fenced ? fenced[1] : text;
  const start = candidate.indexOf("{");
  const end = candidate.lastIndexOf("}");
  if (start === -1 || end <= start) throw new Error("模型没有返回 JSON");
  const parsed = JSON.parse(candidate.slice(start, end + 1));
  const rawArr: unknown[] = Array.isArray(parsed.themes) ? parsed.themes : [];
  const allowed = new Set<string>(THEME_KEYS);
  return rawArr
    .map((t) => String(t).trim())
    .map((t) => (allowed.has(t) ? t : "other"))
    .slice(0, count);
}

export async function POST() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "未登录" }, { status: 401 });
  }

  // 限制单次整理的生词数，防图书量无界放大串行 AI 调用的成本与时长。
  const MAX_CARDS = 500;
  const { data: cards, error: readErr } = await supabase
    .from("cards")
    .select("id, front, back")
    .eq("kind", "word")
    .order("position", { ascending: true })
    .order("created_at", { ascending: true })
    .limit(MAX_CARDS + 1);
  if (readErr) {
    return NextResponse.json({ error: `读取生词失败：${readErr.message}` }, { status: 500 });
  }
  if (!cards?.length) {
    return NextResponse.json({ classified: 0, note: "还没有生词可整理。" });
  }
  const truncated = cards.length > MAX_CARDS;
  const targets = cards.slice(0, MAX_CARDS);

  const CHUNK = 60;
  const assignments: { id: string; theme: string }[] = [];

  try {
    for (let i = 0; i < targets.length; i += CHUNK) {
      const chunk = targets.slice(i, i + CHUNK);
      const listText = chunk
        .map((c, j) => `${i + j + 1}. ${c.front} — ${c.back ?? ""}`)
        .join("\n");

      const raw = await aiChat({ system: SYSTEM_PROMPT, user: listText, maxTokens: 4000 });
      const themes = parseThemes(raw, chunk.length);
      for (let j = 0; j < chunk.length; j++) {
        assignments.push({ id: chunk[j].id, theme: themes[j] ?? "other" });
      }
    }
  } catch (err) {
    const status = err instanceof AiError ? err.status : 500;
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: message }, { status });
  }

  // 写入 cards.theme（删卡时该主题随之消失，无需清理）。
  const results = await Promise.all(
    assignments.map((a) => supabase.from("cards").update({ theme: a.theme }).eq("id", a.id))
  );
  const writeFail = results.find((r) => r.error);
  if (writeFail) {
    return NextResponse.json(
      { error: `写入失败（可能还没跑 schema 迁移加 theme 列）：${writeFail.error?.message ?? "未知错误"}` },
      { status: 500 }
    );
  }

  const counts: Record<string, number> = {};
  for (const a of assignments) counts[a.theme] = (counts[a.theme] ?? 0) + 1;

  return NextResponse.json({
    classified: assignments.length,
    themes: counts,
    note: truncated ? `生词较多，本次整理了前 ${MAX_CARDS} 张，其余可再次点击整理。` : undefined,
  });
}
