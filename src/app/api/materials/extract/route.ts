// POST /api/materials/extract —— 抓一个网页，把正文抽成纯文本。
// 素材「文章」观看页的「提取正文」按钮用：抽出来的原文可导入笔记，再走 AI 精读 / 转卡。
// 不引第三方 readability（能轻则轻）：用正则剥离脚本/样式/导航，优先取 <article>/<main> 文本。
// 出网走 serverFetch（带代理），返回 { title, text }。

import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { serverFetch } from "@/lib/server-fetch";

export const runtime = "nodejs";

// 最大抓取正文长度（防止抽出整站导航这种超长垃圾）。
const MAX_TEXT = 120_000;

/** 从 <title> 抠出标题。 */
function titleOf(html: string): string {
  const m = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  const t = m ? decode(m[1]).trim() : "";
  return t.length > 0 && t.length <= 200 ? t : "";
}

/** HTML 里常见的命名实体 → 字符。 */
function decode(s: string): string {
  return s
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/&ldquo;|&rdquo;|&lsquo;|&rsquo;/g, "'")
    .replace(/&mdash;|&ndash;/g, "-")
    .replace(/&#(\d+);/g, (_, n) => (typeof n === "string" ? String.fromCodePoint(Number(n)) : ""))
    .replace(/&#x([0-9a-f]+);/gi, (_, n) => (typeof n === "string" ? String.fromCodePoint(parseInt(n, 16)) : ""))
    .replace(/&[a-z]+;/gi, " ");
}

/** 抽正文：去掉脚本/样式/导航等噪音，按块级标签取文本。 */
function extractText(html: string): string {
  const doc = html
    // 只保留主要区域，优先 article / main / section / body（去掉 header/footer/nav/aside/form）。
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<noscript[\s\S]*?<\/noscript>/gi, " ")
    .replace(/<(head|header|footer|nav|aside|form|iframe|canvas|svg|button|select)[^>]*>[\s\S]*?<\/\1>/gi, " ");

  let region = doc.match(/<article[\s\S]*?<\/article>/i)?.[0];
  if (!region) region = doc.match(/<main[\s\S]*?<\/main>/i)?.[0];
  if (!region) region = doc;

  region = region
    // 块级结束标签换成换行。
    .replace(/<\/(p|div|h[1-6]|li|section|br|tr|article|main|blockquote|pre)>/gi, "\n")
    // 行内标签剥掉。
    .replace(/<[^>]+>/g, " ")
    // 多个空格/换行折叠。
    .replace(/[ \t]+/g, " ")
    .replace(/\n\s*\n+/g, "\n")
    .replace(/\n\s+/g, "\n")
    .trim();

  const lines = region
    .split("\n")
    .map((l) => decode(l).trim())
    .filter((l) => l.length > 1 && !/^(广告|分享|订阅|登录|注册|©|版权|related|read more|${})$/i.test(l));

  const text = lines.join("\n").trim();
  return text.length > MAX_TEXT ? text.slice(0, MAX_TEXT) : text;
}

export async function POST(req: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "未登录" }, { status: 401 });
  }

  let body: { url?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "无效请求" }, { status: 400 });
  }
  const url = (body.url ?? "").trim();
  if (!url) {
    return NextResponse.json({ error: "没有链接" }, { status: 400 });
  }

  let html: string;
  try {
    const res = await serverFetch(url, {
      headers: {
        "user-agent":
          "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124 Safari/537.36",
      },
      signal: AbortSignal.timeout(20_000),
    });
    if (!res.ok) {
      return NextResponse.json({ error: `抓取页面失败（${res.status}）` }, { status: 502 });
    }
    html = await res.text();
  } catch (err) {
    return NextResponse.json(
      { error: `抓取页面失败：${err instanceof Error ? err.message : String(err)}` },
      { status: 502 }
    );
  }

  const text = extractText(html);
  if (!text) {
    return NextResponse.json(
      { error: "没抽到正文——可能是动态渲染的页面，或不在 <article>/<main> 里。可保存后打开原文查看。" },
      { status: 422 }
    );
  }

  return NextResponse.json({ title: titleOf(html), text });
}
