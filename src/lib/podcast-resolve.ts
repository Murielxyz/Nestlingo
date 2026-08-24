// 把「用户粘贴的播客链接」解析成一个可直接抓取的 RSS/Atom 源地址。
// 覆盖（按优先级）：
//   1. 已经是 RSS/Atom 源（.xml / .rss，链里含 /feed /rss）→ 原样返回。
//   2. Apple Podcasts / iTunes（podcasts.apple.com / itunes.apple.com / /id<数字> / ?i=<数字>）
//      → 用 itunes.apple.com/lookup?id=<id> 拿它的 feedUrl（公开、无 Key）。
//   3. Google 播客（podcasts.google.com/feed/<base64>）→ base64 解开就是源地址。
//   4. 其他播客平台/节目主页（PodBean / Buzzsprout / 自建播客站…）→ 抓页面，找
//      <link rel="alternate" type="application/rss+xml" href="...">（几乎所有播客托管页都有）。
// 要么返回 feed URL，要么抛中文 Error。只读 URL、只做网络请求，不返回别的。

import { serverFetch } from "@/lib/server-fetch";
import { isRssUrl } from "@/lib/media";

const APPLE_ID_RE = /\/id(\d+)/i;
const GOOGLE_FEED_RE = /podcasts\.google\.com\/feed\/([A-Za-z0-9+/=_-]+)/i;
const PAGE_LIMIT = 600_000; // 抓页面只取前 600KB 找 RSS 声明，够用且防超大页

const UA = "Mozilla/5.0 (compatible; Nestlingo; +https://nestlingo.app)";

/** 解析出可直接抓取的 RSS/Atom 源地址。 */
export async function resolvePodcastFeed(raw: string): Promise<string> {
  const url = raw.trim();
  if (!url) throw new Error("没有链接");

  // 1) 已是 RSS/Atom 源
  if (isRssUrl(url)) return url;

  // 2) Apple Podcasts / iTunes
  if (/podcasts\.apple\.com|itunes\.apple\.com/i.test(url)) {
    const id = url.match(APPLE_ID_RE)?.[1];
    if (id) return appleFeedUrl(id);
  }

  // 3) Google 播客 feed（base64）
  const google = url.match(GOOGLE_FEED_RE)?.[1];
  if (google) {
    const decoded = decodeB64(google);
    if (/^https?:\/\//i.test(decoded)) return decoded;
  }

  // 4) 通用兜底：抓主页找 RSS alternate
  if (/^https?:\/\//i.test(url)) {
    const feed = await pageRssAlternate(url);
    if (feed) return feed;
  }

  throw new Error(
    "没能识别这个链接。支持 Apple Podcasts / Google 播客 / 播客 RSS 源，或贴播客主页链接（PodBean / Buzzsprout / 自建播客站，页面里带 RSS 源的那种）。"
  );
}

/** Apple 播客：用 `itunes.apple.com/lookup?id=<id>` 拿 feedUrl。 */
async function appleFeedUrl(id: string): Promise<string> {
  const res = await serverFetch(
    `https://itunes.apple.com/lookup?id=${encodeURIComponent(id)}&entity=podcast&limit=1`,
    { headers: { "user-agent": UA }, signal: AbortSignal.timeout(15_000) }
  );
  if (!res.ok) throw new Error("Apple Podcast 查询失败，请稍后重试。");
  const data = await res.json();
  const feedUrl = data?.results?.[0]?.feedUrl as string | undefined;
  if (!feedUrl) throw new Error("没查到这档 Apple 播客，可能链接不对或节目已下架。");
  return feedUrl;
}

/** 通用兜底：抓页面，找 `<link rel=alternate type=application/rss+xml href=...>`。 */
async function pageRssAlternate(pageUrl: string): Promise<string> {
  let html: string;
  try {
    const res = await serverFetch(pageUrl, {
      headers: { "user-agent": UA },
      signal: AbortSignal.timeout(20_000),
    });
    if (!res.ok) return "";
    html = await res.text();
  } catch {
    return "";
  }
  if (html.length > PAGE_LIMIT) html = html.slice(0, PAGE_LIMIT);
  return rssAlternateHref(html, pageUrl);
}

/** 从 HTML 里挖 RSS alternate 链接（属性顺序可能不同，逐条找再取 href）。 */
function rssAlternateHref(html: string, baseUrl: string): string {
  const linkRe = /<link\b[^>]*>/gi;
  let m: RegExpExecArray | null;
  while ((m = linkRe.exec(html))) {
    const tag = m[0];
    if (!/rel\s*=\s*["']?alternate["']?/i.test(tag)) continue;
    if (!/type\s*=\s*["']?application\/(rss|atom)\+xml["']?/i.test(tag)) continue;
    const href = tag.match(/href\s*=\s*["']([^"']+)["']/i)?.[1]?.trim();
    if (!href) continue;
    try {
      return new URL(href, baseUrl).href;
    } catch {
      return "";
    }
  }
  return "";
}

/** base64（Google 用的是 base64url，把 - _ 还原成 + /）。 */
function decodeB64(s: string): string {
  const b64 = s.replace(/-/g, "+").replace(/_/g, "/");
  try {
    return Buffer.from(b64, "base64").toString("utf8");
  } catch {
    return "";
  }
}
