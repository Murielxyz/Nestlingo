// POST /api/materials/meta —— 抓素材链接的元数据（标题/缩略图/来源/语言/类型）。
// 素材库「收藏素材」用。浏览器直接抓 YouTube/Spotify/网页会被 CORS 拦或拿不到 og 标签，
// 所以挪到服务端代理。优先级：
//   1. parseMediaUrl → YouTube / Spotify / 音频直链（YouTube/Spotify 再用 oEmbed 补真实标题/作者）。
//   2. 明显是播客（RSS 源 / Apple / Google / PodBean / Buzzsprout / anchor）→ resolvePodcastFeed + 解析频道标题/封面。
//   3. 其它 → 抓网页，用 Open Graph / Twitter Card / <title> 抠标题缩略图。
// 出网全走 serverFetch（代理感知）；不返回任何密钥。

import { NextResponse } from "next/server";
import { XMLParser } from "fast-xml-parser";
import { createClient } from "@/lib/supabase/server";
import { serverFetch } from "@/lib/server-fetch";
import { parseMediaUrl, isRssUrl, type ParsedMedia } from "@/lib/media";
import { resolvePodcastFeed } from "@/lib/podcast-resolve";
import { extractOgMeta } from "@/lib/og-meta";
import { detectLang } from "@/lib/lang-detect";

export const runtime = "nodejs";

const UA = "Mozilla/5.0 (compatible; Nestlingo; +https://nestlingo.app)";
// 播客平台域名：这些页面/源是「播客」，而不是普通文章。锚点 feed 已被 isRssUrl 覆盖。
const PODCAST_HOST_RE =
  /podcasts\.apple\.com|itunes\.apple\.com|podcasts\.google\.com|podbean\.com|buzzsprout\.com|anchor\.fm/i;

// XML 解析出来的结构是动态的，用 any 更省事（照 /api/rss 的写法）。
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type XmlValue = any;

/** 从 XML 里取一个字符串值（可能是纯字符串，也可能是带 #text/text 的对象）。 */
function asString(v: XmlValue): string {
  if (typeof v === "string") return v;
  if (v && typeof v === "object") {
    if (typeof v["#text"] === "string") return v["#text"];
    if (typeof v.text === "string") return v.text;
  }
  return "";
}

function hostnameOf(url: string): string {
  try {
    return new URL(url).hostname;
  } catch {
    return "";
  }
}

/** 音频直链的默认标题：取文件名（去扩展名，解码），失败用「音频」。 */
function audioTitle(url: string): string {
  try {
    const path = new URL(url).pathname;
    const base = path.split("/").pop() ?? "";
    const name = decodeURIComponent(base.replace(/\.[a-z0-9]+$/i, "").trim());
    return name || "音频";
  } catch {
    return "音频";
  }
}

// ------ 播客单集解析（只导入那一集，不列整档） ------

/**
 * Apple「单集」链接（节目页带 `?i=<集id>`）→ 只解析出这一集。
 * 那串 `?i=` 数字就是 Apple 的「单集 id」（trackId），不是 RSS 里的 guid；多数订阅源根本不把这串数
 * 写进 guid，靠 guid 匹配注定失败。改用 Apple lookup 的 `entity=podcastEpisode`（公开无 Key）直接列
 * 该节目全部单集，按 `trackId` 命中那一集，顺手拿到音频直链 / 标题 / 来源 / 封面。
 */
async function appleSingleEpisode(url: string): Promise<{
  audio: string;
  title: string;
  source: string;
  thumbnail: string | null;
}> {
  const showMatch = url.match(/\/id(\d+)/i);
  const epMatch = url.match(/[?&]i=(\d+)/i);
  if (!showMatch || !epMatch) {
    throw new Error("不是单集链接（缺少节目 / 集数编号）。");
  }
  const epId = Number(epMatch[1]);

  const res = await serverFetch(
    `https://itunes.apple.com/lookup?id=${showMatch[1]}&entity=podcastEpisode&limit=200`,
    { headers: { "user-agent": UA }, signal: AbortSignal.timeout(15_000) }
  );
  if (!res.ok) throw new Error(`查询单集失败（${res.status}）`);
  const data = await res.json();
  const results: XmlValue[] = data?.results ?? [];
  // 取第一档（kind=podcast 的 collectionId 对应节目）下的单集。
  const ep = results.find(
    (r) => Number(r?.trackId) === epId && r?.episodeUrl
  );
  if (!ep) {
    throw new Error("没在这档节目里找到这一集（这集可能比较早、超出了可查范围）。");
  }
  return {
    audio: String(ep.episodeUrl),
    title: String(ep.trackName ?? "").trim() || "播客单集",
    source: String(ep.collectionName ?? "").trim() || "播客",
    thumbnail: String(ep.artworkUrl600 ?? "").trim() || null,
  };
}

/** YouTube 用 oEmbed 补真实标题 / 作者 / 缩略图（失败回退 parseMediaUrl 的占位值）。 */
async function youtubeOEmbed(m: ParsedMedia): Promise<{
  title: string;
  source: string;
  thumbnail: string | null;
}> {
  const id = m.embedUrl.split("/").pop() ?? "";
  const watch = `https://www.youtube.com/watch?v=${id}`;
  try {
    const res = await serverFetch(
      `https://www.youtube.com/oembed?url=${encodeURIComponent(watch)}&format=json`,
      { headers: { "user-agent": UA }, signal: AbortSignal.timeout(15_000) }
    );
    if (res.ok) {
      const data = await res.json();
      return {
        title: (data?.title as string)?.trim() || m.title,
        source: (data?.author_name as string)?.trim() ?? "",
        thumbnail: (data?.thumbnail_url as string) ?? m.thumbnail,
      };
    }
  } catch {
    // oEmbed 失败就沿用占位值
  }
  return { title: m.title, source: hostnameOf(m.embedUrl), thumbnail: m.thumbnail };
}

/** Spotify 用 oEmbed 补标题 / 封面 / 作者（发布者）。 */
async function spotifyOEmbed(url: string, m: ParsedMedia): Promise<{
  title: string;
  source: string;
  thumbnail: string | null;
}> {
  try {
    const res = await serverFetch(
      `https://open.spotify.com/oembed?url=${encodeURIComponent(url)}`,
      { headers: { "user-agent": UA }, signal: AbortSignal.timeout(15_000) }
    );
    if (res.ok) {
      const data = await res.json();
      return {
        title: (data?.title as string)?.trim() || m.title,
        source: (data?.author_name as string)?.trim() ?? "",
        thumbnail: (data?.thumbnail_url as string) ?? null,
      };
    }
  } catch {
    // oEmbed 失败就沿用占位值
  }
  return { title: m.title, source: hostnameOf(url), thumbnail: null };
}

/** 播客：解析源 → 抓 XML → 取频道标题 / 封面（itunes:image 的 href，或 <image><url>）。 */
async function podcastMeta(url: string): Promise<{
  title: string;
  source: string;
  thumbnail: string | null;
}> {
  const feedUrl = await resolvePodcastFeed(url);
  const res = await serverFetch(feedUrl, {
    headers: { "user-agent": UA },
    signal: AbortSignal.timeout(20_000),
  });
  if (!res.ok) throw new Error(`抓取订阅失败（${res.status}）`);
  const xml = await res.text();

  const parser = new XMLParser({
    ignoreAttributes: false,
    attributeNamePrefix: "@_",
    textNodeName: "#text",
  });
  const doc = parser.parse(xml) as XmlValue;
  const channel = doc?.rss?.channel ?? doc?.feed ?? doc;
  const title = asString(channel?.title).trim() || "播客";
  const itunesImage = channel?.["itunes:image"];
  const image =
    asString(channel?.image?.url) ||
    (typeof itunesImage === "object" ? asString(itunesImage?.["@_href"]) : "") ||
    "";
  return { title, source: title, thumbnail: image || null };
}

/** 通用网页：抓 HTML → Open Graph / Twitter Card / <title>。 */
async function articleMeta(url: string): Promise<{
  title: string;
  source: string;
  thumbnail: string | null;
  type: string;
}> {
  const res = await serverFetch(url, {
    headers: { "user-agent": UA },
    signal: AbortSignal.timeout(20_000),
  });
  if (!res.ok) throw new Error(`抓取网页失败（${res.status}）`);
  const html = await res.text();
  const og = extractOgMeta(html, url);
  const host = hostnameOf(url);
  return {
    title: og.title || host,
    source: og.siteName || host,
    thumbnail: og.image,
    type: og.type,
  };
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
  const raw = (body.url ?? "").trim();
  if (!raw) {
    return NextResponse.json({ error: "没有链接" }, { status: 400 });
  }
  let url: string;
  try {
    url = new URL(raw).href;
  } catch {
    return NextResponse.json({ error: "这个链接不合法。" }, { status: 400 });
  }

  try {
    let kind = "link";
    let title = "";
    let source = "";
    let thumbnail: string | null = null;
    let embedUrl: string | null = null;
    let audioUrl: string | null = null;

    const media = parseMediaUrl(url);
    if (media) {
      kind = media.kind;
      embedUrl = media.embedUrl;
      if (media.kind === "youtube") {
        const en = await youtubeOEmbed(media);
        title = en.title;
        source = en.source;
        thumbnail = en.thumbnail;
      } else if (media.kind === "spotify") {
        const en = await spotifyOEmbed(url, media);
        title = en.title;
        source = en.source;
        thumbnail = en.thumbnail;
      } else {
        title = audioTitle(url);
        source = hostnameOf(url);
        thumbnail = null;
        audioUrl = url;
      }
    } else if (isRssUrl(url) || PODCAST_HOST_RE.test(url)) {
      // 单集播客链接（Apple 节目页带 ?i=）→ 只解析出那一集，不再列整档。
      if (/podcasts\.apple\.com[^\s]*\?[^\s]*i=\d+/i.test(url)) {
        const p = await appleSingleEpisode(url);
        kind = "audio";
        title = p.title;
        source = p.source;
        thumbnail = p.thumbnail;
        embedUrl = p.audio;
        audioUrl = p.audio;
      } else {
        const p = await podcastMeta(url); // 抓取失败会抛，落进下方 catch
        kind = "podcast";
        title = p.title;
        source = p.source;
        thumbnail = p.thumbnail;
      }
    } else {
      const a = await articleMeta(url);
      kind = "link";
      title = a.title;
      source = a.source;
      thumbnail = a.thumbnail;
    }

    if (!title) title = hostnameOf(url);
    const lang = detectLang(title);
    return NextResponse.json({ kind, title, source, thumbnail, embedUrl, audioUrl, lang });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: msg }, { status: 502 });
  }
}
