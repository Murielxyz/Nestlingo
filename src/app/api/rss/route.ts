// POST /api/rss —— 抓取播客 RSS/Atom 订阅，返回每集的标题 + 音频直链。
// 客户端浏览器直接抓 RSS 会被 CORS 拦，所以放到服务端代理。
// 用户粘贴订阅链接后，从这里拿到节目列表，挑一集再以内嵌音频节点插入笔记。

import { NextResponse } from "next/server";
import { XMLParser } from "fast-xml-parser";
import { createClient } from "@/lib/supabase/server";
import { serverFetch } from "@/lib/server-fetch";

export const runtime = "nodejs";

const AUDIO_EXT = /\.(mp3|m4a|aac|wav|ogg|oga|opus|flac)(\?.*)?$/i;

// XML 解析出来的结构是动态的，用 any 更省事（JSON 数据本身没有静态类型）。
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type XmlValue = any;

/** 从 XML 里取一个字符串值（可能是纯字符串，也可能是带属性的对象）。 */
function asString(v: XmlValue): string {
  if (typeof v === "string") return v;
  if (v && typeof v === "object") {
    if (typeof v["#text"] === "string") return v["#text"];
    if (typeof v.text === "string") return v.text;
  }
  return "";
}

/** 从 enclosure / media:content 这类节点里挖出音频直链。 */
function urlOf(v: XmlValue): string {
  if (typeof v === "string") return v;
  if (v && typeof v === "object") {
    if (typeof v["@_url"] === "string") return v["@_url"];
    if (typeof v.url === "string") return v.url;
    if (typeof v.href === "string") return v.href;
  }
  return "";
}

/** 从一集（item/entry）里挖出音频直链。优先 enclosure / media:content，再退回链接（仅音频扩展名）。 */
function audioOf(it: XmlValue): string {
  for (const key of ["enclosure", "media:content", "media:enclosure"]) {
    const v = it?.[key];
    if (!v) continue;
    // media:content 可能是数组，取第一个有 url 的。
    const list = Array.isArray(v) ? v : [v];
    for (const entry of list) {
      const url = urlOf(entry);
      if (url && (AUDIO_EXT.test(url) || entry?.["@_type"] || entry?.type)) return url;
    }
  }
  // 有些源把音频放在 <link> 里（少见），只有明确是音频扩展名才收。
  const link = asString(it?.link);
  if (link && AUDIO_EXT.test(link)) return link;
  return "";
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
    return NextResponse.json({ error: "没有 RSS 链接" }, { status: 400 });
  }

  let xml: string;
  try {
    const res = await serverFetch(url, {
      headers: { "user-agent": "Mozilla/5.0 (compatible; Nestlingo)" },
      signal: AbortSignal.timeout(20_000),
    });
    if (!res.ok) {
      return NextResponse.json(
        { error: `抓取订阅失败（${res.status}）` },
        { status: 502 }
      );
    }
    xml = await res.text();
  } catch (err) {
    return NextResponse.json(
      { error: `抓取订阅失败：${err instanceof Error ? err.message : String(err)}` },
      { status: 502 }
    );
  }

  try {
    const parser = new XMLParser({
      ignoreAttributes: false,
      attributeNamePrefix: "@_",
      textNodeName: "#text",
    });
    const doc: XmlValue = parser.parse(xml);

    const channel: XmlValue = doc?.rss?.channel ?? doc?.feed ?? doc;
    const rawItems: XmlValue = channel?.item ?? channel?.entry ?? [];
    const arr: XmlValue[] = Array.isArray(rawItems) ? rawItems : [rawItems];

    const episodes = arr
      .map((it) => ({
        title: asString(it?.title).trim() || "未命名节目",
        audio: audioOf(it).trim(),
      }))
      .filter((e) => e.audio);

    if (episodes.length === 0) {
      return NextResponse.json(
        { error: "这个订阅里没找到可播放的音频（可能不是播客源，或用的是不支持的格式）。" },
        { status: 400 }
      );
    }

    return NextResponse.json({
      title: asString(channel?.title).trim() || "播客",
      episodes,
    });
  } catch {
    return NextResponse.json(
      { error: "解析订阅失败，可能不是有效的 RSS / Atom 源。" },
      { status: 400 }
    );
  }
}
