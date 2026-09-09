// POST /api/ai/assistant —— AI 学伴：用户自由提问（查词 / 问语法 / 要例句 / 翻译 / 写场景短文），
// 返回一段对话式回答 + 结构化「知识点」数组（生词 / 例句 / 语法 / 原文）。
// 前端把知识点做成可勾选列表，支持「加入笔记」（pointsToNoteContent 转成 callout 块）或「转成闪卡」。
// 复用 ai-client 的 aiChat（按 AI_PROVIDER 路由），不引 SDK。

import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { aiChat, AiError } from "@/lib/ai-client";
import type { AssistantPoint } from "@/lib/ai-note";

export const runtime = "nodejs";

const SYSTEM_PROMPT = `你是语巢（Nestlingo）里的 AI 学习助手，帮用户学泰语、韩语、日语、英语等外语。用户会自由地提问：查词、问语法、要例句、翻译一句话，或让你写一篇场景短文。你要同时做两件事，并在一个 JSON 对象里返回：

1. "reply"：用简体中文自然、友好地直接回答用户（可带 Markdown 列表；原文、例句、短文保留原语言，不翻译成中文——译文放进 points）。
2. "points"：把回答里「值得用户收藏学习」的内容整理成结构化知识点数组，供用户一键存进笔记或转成闪卡。

只输出一个 JSON 对象，不要 Markdown 代码块、不要任何解释或前缀。结构如下：
{
  "reply": "对用户的回答（简体中文）",
  "points": [
    {"kind": "word", "front": "要记的单词/短语（原语言）", "back": "简体中文释义（词典风格，可含词性，如 [名词]）；多个义项用顿号「、」隔开写在同一行，不要用换行分隔", "reading": "读音（泰语罗马音带声调 / 韩语罗马转写 / 英语音标；日语、中文不填，没有就空字符串）", "extra": "一个用原语言写的完整例句，格式为「例句（简体中文翻译）」——括号里必须是这句的中文翻译，严禁把原句再抄一遍，没有就空字符串", "note": "搭配：常用搭配、词组，合并写在一起，没有就空字符串"},
    {"kind": "example", "front": "值得精读的句子（原语言）", "back": "简体中文翻译", "extra": "语法/用法说明，没有就空字符串"},
    {"kind": "grammar", "front": "该语法点最典型的一条原语言例子（如泰语礼貌词写「ครับ / ค่ะ」、日语て形写「食べて」），必须用目标语言写、不要写成中文语法名", "back": "语法说明（简体中文）", "conjugations": [{"rule": "接续规则（如「動詞て形」「名詞＋の」）", "example": "这条接续规则的一个例句（原语言）"}], "extra": "一个例句，没有就空字符串"},
    {"kind": "article", "front": "短文/原文正文（原语言，多段用换行分隔）", "back": "逐段中文翻译（段数与 front 一致、用换行分隔，没有就空字符串）", "extra": ""}
  ]
}

规则：
- 用户查一个或几个词 → points 给对应数量的 word；问语法 → grammar；要例句 → example。
- 生词（word）的 extra 里若写例句，必须是完整、自然的原语言句子，后面用全角括号「（）」附这句的简体中文翻译（格式「例句（译文）」），括号里严禁重复原句或留空；不要写成用法说明或解释（如不要写「用于打招呼」「表示礼貌」这类）；常用搭配、词组统一写进 note（搭配），不要单独分「搭配」「相关」等标签；只有需要特别解释的用法说明才写进 note，没有就留空。
- 生词（word）的 back 释义里若有多个义项，用顿号「、」隔开写在同一行，严禁用换行分隔（换行会被当成另一块内容，导致背面多出一行孤立的词）。
- 生词（word）的 reading（读音）按目标语言给：泰语=罗马音并带声调符号（如 ก๋วยเตี๋ยว → gŭuay-dtĭieow）、韩语=罗马转写、英语=音标；日语不填（正面词本身已带假名）、中文不填（无需音标）；不必每个词都填读音，没有可靠读音就留空字符串；只有生词才填 reading，其余类型一律留空字符串。
- 每个字段没有内容就留空字符串，不要为了凑字段硬写。
- 用户让你写短文/文章 → 正文放进一个 article（front=原文、back=逐段译文），再把里面的生词、例句、语法拆成对应的 word/example/grammar 点。
- 日语语法点（grammar）必须给 conjugations（接续规则）：按词性分别列出接续规则、每条配一个例句——rule 简洁写接什么（动词哪个形：辞書形 / て形 / た形 / ない形 / ます形去掉ます / 普通形 等；名词/形容词接法：名詞＋の / い形容詞＋い / な形容詞＋な 等），用原语言形式写；example 是该接续规则的一个例句（原语言）。没有不同接续就只给一条；非日语语法点留空数组 []。
- 语法点（grammar）的 front 必须是「用目标语言写的典型表达或例子」，不要写中文语法名；中文语法说明放 back、例句放 extra。像「泰语礼貌词」这类，front 直接写ครับ / ค่ะ 等原语言形式，让生成的闪卡正面带得到泰语、不纯是中文解释。
- 没有值得收藏的内容时 points 可以是空数组 []。
- 所有释义、翻译、说明都用简体中文。
- kind 只能取 word / example / grammar / article 四个值之一。`;

/** 目标语言 → 中文名（学伴「语言」下拉用）。 */
const LANG_LABELS: Record<string, string> = {
  ko: "韩语",
  th: "泰语",
  ja: "日语",
  en: "英语",
  es: "西班牙语",
};

/** 选了目标语言时，往系统提示里加一句「目标语言」上下文：
 *  贴中文 → 翻译成该语言（译文作 example 点）；「场景对话 / 写美文 / 查词 / 问语法」等指令 → 按指令用该语言执行。
 *  （不用硬 wrap，避免把「写美文 / 场景对话」这类指令也误翻一遍。） */
function langHint(lang: string): string {
  const label = LANG_LABELS[lang] ?? lang;
  return `\n\n用户当前的目标语言是${label}。若用户发来一段要翻译的中文，直接翻译成地道、自然的${label}（不要逐字直译，要像母语者那样说），并把译文作为一条 kind="example" 的知识点放进 points（front=译文、back=中文原文）；若用户发来「场景对话 / 写美文 / 查词 / 问语法」等指令，按指令用${label}执行。`;
}

/** 语伴多轮会话历史：取最近若干轮（用户+助手），拼成 text 追加进 system，让「全能助手」能接上文。
 *  角色转中文：user=用户、assistant=AI。内容截到 400 字/条，防历史撑爆上下文。 */
function historyHint(history: { role: string; content: string }[]): string {
  const lines = history
    .slice(-12)
    .map((h) => {
      const role = h.role === "user" ? "用户" : "AI";
      const body = (h.content ?? "").slice(0, 400);
      return body ? `${role}：${body}` : "";
    })
    .filter(Boolean);
  if (lines.length === 0) return "";
  return `\n\n以下是之前的对话记录（供你接上下文，不必复述）：\n${lines.join("\n")}`;
}

/** 当前笔记里已有的知识点（生词/例句/语法）上下文：用户要「补全」时，针对这些内容输出对应类型的点（front 原文不变、back 丰富释义、extra 例句）。 */
function notePointsHint(points: { kind: string; front: string; back: string }[]): string {
  if (points.length === 0) return "";
  const KIND_LABEL: Record<string, string> = { word: "生词", example: "例句", grammar: "语法" };
  const lines = points
    .map((p) => `[${KIND_LABEL[p.kind] ?? "生词"}] ${p.front}${p.back ? `：${p.back}` : ""}`)
    .join("\n");
  return `\n\n用户当前笔记里已有的知识点如下（「[类型] 词：现有释义」，释义可能很薄或为空）：\n${lines}\n\n当用户要求「补全 / 丰富 / 完善这些生词、例句、语法的释义，或给它们加例句」时，请针对这些内容输出对应类型的点，规则如下：\n- 生词：kind="word"，front 保持原词一字不改，back 输出更完整、词典风格的中文释义，extra 输出一个用原语言写的例句（格式「例句（简体中文翻译）」，括号里严禁重复原句），note 输出搭配（常用搭配、词组等，可空）。\n- 例句：kind="example"，front 保持原句一字不改，back 只输出准确的中文翻译，extra 留空。\n- 语法：kind="grammar"，front 保持原语法点一字不改，back 输出更完整的语法说明（接续规则用 conjugations 列），extra 输出一个用原语言写的例句（可附中文翻译）。\n与笔记无关的其它提问请忽略这些知识点。`;
}

function parseReply(raw: string): { reply: string; points: AssistantPoint[] } {
  const text = raw.trim();
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const candidate = fenced ? fenced[1] : text;
  const start = candidate.indexOf("{");
  const end = candidate.lastIndexOf("}");
  if (start === -1 || end <= start) throw new Error("模型没有返回 JSON");
  const parsed = JSON.parse(candidate.slice(start, end + 1));

  const KINDS = ["word", "example", "grammar", "article"] as const;
  const rawPoints: unknown[] = Array.isArray(parsed.points) ? parsed.points : [];
  const points: AssistantPoint[] = rawPoints
    .map((p) => {
      const o = (p ?? {}) as Record<string, unknown>;
      const kind = KINDS.includes(o.kind as AssistantPoint["kind"])
        ? (o.kind as AssistantPoint["kind"])
        : "word";
      return {
        kind,
        front: String(o.front ?? "").trim(),
        back: String(o.back ?? "").trim(),
        reading: String(o.reading ?? "").trim(),
        extra: String(o.extra ?? "").trim(),
        note: String(o.note ?? "").trim(),
        conjugations: (Array.isArray(o.conjugations) ? o.conjugations : [])
          .map((c) => {
            const cc = (c ?? {}) as Record<string, unknown>;
            return {
              rule: String(cc.rule ?? "").trim(),
              example: String(cc.example ?? "").trim(),
            };
          })
          .filter((c) => c.rule),
      };
    })
    .filter((p) => p.front || p.back);

  return {
    reply: String(parsed.reply ?? "").trim(),
    points,
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

  let body: { message?: string; lang?: string; notePoints?: unknown; history?: { role: string; content: string }[] };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "无效请求" }, { status: 400 });
  }
  const message = (body.message ?? "").trim();
  if (!message) {
    return NextResponse.json({ error: "没有要问的内容" }, { status: 400 });
  }
  if (message.length > 8000) {
    return NextResponse.json({ error: "内容太长，请分段提问" }, { status: 400 });
  }
  // 目标语言（翻译 / 场景对话 / 写美文 共用）：作为系统提示上下文，不做硬 wrap。
  const lang = typeof body.lang === "string" ? body.lang.trim() : "";
  // 当前笔记里的知识点（补全生词/例句/语法用）：最多 60 个，每个只留 kind + front + 现有 back，防超长。
  const notePoints: { kind: string; front: string; back: string }[] = Array.isArray(body.notePoints)
    ? body.notePoints
        .slice(0, 60)
        .map((w) => {
          const o = (w ?? {}) as Record<string, unknown>;
          const kind =
            o.kind === "example" || o.kind === "grammar" ? String(o.kind) : "word";
          return { kind, front: String(o.front ?? "").trim(), back: String(o.back ?? "").trim() };
        })
        .filter((w) => w.front)
    : [];
  const history: { role: string; content: string }[] = Array.isArray(body.history)
    ? body.history
        .filter((h) => h && (h.role === "user" || h.role === "assistant"))
        .map((h) => ({ role: h.role, content: String(h.content ?? "") }))
    : [];
  const system =
    (lang ? SYSTEM_PROMPT + langHint(lang) : SYSTEM_PROMPT) +
    notePointsHint(notePoints) +
    historyHint(history);

  try {
    const raw = await aiChat({ system, user: message, maxTokens: 4000 });
    const { reply, points } = parseReply(raw);
    if (!reply) {
      return NextResponse.json({ error: "模型没有返回回答，请重试" }, { status: 502 });
    }
    return NextResponse.json({ reply, points });
  } catch (err) {
    const status = err instanceof AiError ? err.status : 500;
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: message }, { status });
  }
}
