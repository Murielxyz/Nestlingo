// POST /api/ai/card-explain —— 给单张闪卡「AI 解释」：像精读那样自由地完善背面，
// 不套固定字段模板。AI 看正面 + 现有背面，把背面补成一份更完整、更清晰的中文解释。
// 按卡片类型（kind）分流 prompt——生词补读音/释义/搭配/例句，例句补译文/解析，语法补说明/接续/例句。
// 输出采取「标签：内容」分行格式，前端用 CardBack 渲染成左轴排版（没有标签的行原样展示）。
// 文字任务，走 aiChat（用户可设置里换成 DeepSeek）。

import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { aiChat, AiError } from "@/lib/ai-client";
import { detectLang, LANG_LABEL } from "@/lib/lang-detect";

export const runtime = "nodejs";

/** 每种卡片类型要补的内容标签与要求（只补缺的，不重复已有）。 */
const KIND_PROMPTS: Record<string, string> = {
  // 生词卡：读音/词性/释义/搭配/相关词/例句
  word: `补充背面里缺失的、对学习有用的东西：
- 读音（${"{lang}"}的读音建议：泰语/韩语给拉丁转写、日语给假名+罗马字、中文给拼音、英语给音标）
- 词性 + 几个核心含义（释义按词典风格写精简洁，先给词性，再给 2~4 个最常用的意思，用分号或顿号隔开）
- 常用搭配（2~3 个，含中文意思，可缺省）
- 相关词（2~4 个，含中文意思，可缺省）
- 一个用原语言写的例句（并附中文翻译，可缺省）`,
  // 例句卡：原句译文/长难句解析/句子里的生词/用法
  example: `把它当例句解释清楚，补充背面里缺失的、对学习有用的东西：
- 整句中文翻译
- 长难句解析（句子结构、主谓宾、修饰关系）
- 句子里的关键生词（逐词给释义）
- 这句子的用法或情境注意点`,
  // 语法卡：语法说明/接续规则/例句/用法注意
  grammar: `把它当语法点解释清楚，补充背面里缺失的、对学习有用的东西：
- 语法说明（这个语法的含义、怎么用，简体中文）
- 接续规则（接什么样的词 / 动词哪个形 / 名词形容词接法，可多条）
- 一个用原语言写的例句（并附中文翻译）
- 用法或语气上的注意点`,
};

function systemPrompt(langLabel: string, kind: string): string {
  const content = KIND_PROMPTS[kind] || KIND_PROMPTS.word;
  const filled = content.replace("{lang}", langLabel);
  return `你是语言学习助手。用户给你一张闪卡：正面是「要记的词 / 短语 / 例句 / 语法点」，背面是这张卡现有的内容（可能是释义，也可能为空，还可能已有一部分）。

请你把这张卡的背面理解成「解释」，并把它完善成一份更完整、更清晰、更适合背下来的文字。要求：
- 用简体中文；
- 保留背面里已有的、正确的内容，不要删掉或覆盖用户写对的信息；
- ${filled}；
- 背面里如果已经有哪一项，就不要再重复写一遍；
- 按「标签：内容」分行输出，一段一行（例如「读音：…」「释义：…」「搭配：…」「例句：…」），方便直接在背面里读；
- 不要输出代码块、不要加「以下是解释」「补充如下」这类标题或客套话，只输出完善后的背面正文。`;
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

  let front = "";
  let back = "";
  let kind: string | null = null;
  try {
    const body = await req.json();
    front = String(body?.front ?? "").trim();
    back = String(body?.back ?? "").trim();
    kind = body?.kind ? String(body.kind) : null;
  } catch {
    return NextResponse.json({ error: "请求体不是合法 JSON" }, { status: 400 });
  }
  if (!front) {
    return NextResponse.json({ error: "没有正面内容，无法解释" }, { status: 400 });
  }

  const langLabel = LANG_LABEL[detectLang(front)] ?? "该语言";

  try {
    const raw = await aiChat({
      system: systemPrompt(langLabel, kind ?? "word"),
      user: `正面：${front}\n类型：${kind ?? "生词"}\n背面：${back || "（空）"}`,
      maxTokens: 1200,
      temperature: 0.4,
    });
    // 去掉可能的代码块围栏 / 首尾空行，得到纯文本解释。
    const fenced = raw.match(/```(?:[\s\S]*?)```/);
    const text = fenced ? fenced[0].replace(/^```[^\n]*\n?/, "").replace(/```$/, "") : raw;
    const explanation = text.trim();
    if (!explanation) {
      return NextResponse.json({ error: "AI 没有返回解释" }, { status: 502 });
    }
    return NextResponse.json({ explanation });
  } catch (err) {
    const status = err instanceof AiError ? err.status : 502;
    const message = err instanceof Error ? err.message : "AI 解释失败";
    return NextResponse.json({ error: message }, { status });
  }
}
