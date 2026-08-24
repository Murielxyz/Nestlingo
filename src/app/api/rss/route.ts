// POST /api/rss —— 抓取播客 RSS/Atom 订阅，返回每集的标题 + 音频直链。
// 客户端浏览器直接抓 RSS 会被 CORS 拦，所以放到服务端代理。
// 用户粘贴订阅链接后，从这里拿到节目列表，挑一集再以内嵌音频节点插入笔记。
// 输入不一定是 RSS 源：Apple Podcasts / Google 播客 / 播客主页链接会先解析成源地址再抓。

import { NextResponse } from "next/server";
import { XMLParser } from "fast-xml-parser";
import { createClient } from "@/lib/supabase/server";
import { serverFetch } from "@/lib/server-fetch";
import { resolvePodcastFeed } from "@/lib/podcast-resolve";

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

/** 单集发布日期（毫秒时间戳，用于「最新在前」排序；取不到为 0 排到最后）。 */
function episodeDate(it: XmlValue): number {
  const raw = asString(it?.pubDate) || asString(it?.updated) || asString(it?.["dc:date"]) || "";
  const t = Date.parse(raw);
  return Number.isFinite(t) ? t : 0;
}

// 单集列表上限：只列最近这些集，避免一档几百集直接刷屏。
const MAX_EPISODES = 30;

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

  // 先把粘贴的链接解析成 RSS 源（兼容 Apple / Google / 播客主页 / 直接 RSS）。
  let feedUrl: string;
  try {
    feedUrl = await resolvePodcastFeed(url);
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : String(err) },
      { status: 400 }
    );
  }

  let xml: string;
  try {
    const res = await serverFetch(feedUrl, {
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

    // 每集带时间戳，最新的排最前；不过上限，避免一档几百集直接刷屏。
    const withAudio = arr
      .map((it) => ({
        title: asString(it?.title).trim() || "未命名节目",
        audio: audioOf(it).trim(),
        ts: episodeDate(it),
      }))
      .filter((e) => e.audio)
      .sort((a, b) => b.ts - a.ts);

    if (withAudio.length === 0) {
      return NextResponse.json(
        { error: "这个订阅里没找到可播放的音频（可能不是播客源，或用的是不支持的格式）。" },
        { status: 400 }
      );
    }

    const episodes = withAudio.slice(0, MAX_EPISODES).map(({ title, audio }) => ({ title, audio }));

    return NextResponse.json({
      title: asString(channel?.title).trim() || "播客",
      episodes,
      // count / truncated 供 UI 显示「只取前 N 集（共 M 集）」。
      count: withAudio.length,
      truncated: withAudio.length > MAX_EPISODES,
    });
  } catch {
    return NextResponse.json(
      { error: "解析订阅失败，可能不是有效的 RSS / Atom 源。" },
      { status: 400 }
    );
  }
}
