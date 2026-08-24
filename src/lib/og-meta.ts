// 从网页 HTML 里抠出文章元数据（Open Graph / Twitter Card / <title>），供素材库「收藏链接」用。
// 纯模块、无网络请求——服务端 meta 路由拿到 HTML 后传进来，正则抓 meta 标签。
// 属性顺序不定，逐条 meta 抓 content 与 property/name 再匹配。

export type OgMeta = {
  title: string;
  image: string | null;
  siteName: string;
  type: string;
};

/** 一条 meta 标签的关键属性（content + 匹配用的 property/name）。 */
type MetaTag = { content: string; key: string };

/** 抓出所有 `<meta ...>` 的 content 与 property/name。 */
function metaTags(html: string): MetaTag[] {
  const out: MetaTag[] = [];
  let m: RegExpExecArray | null;
  const tagRe = /<meta\b[^>]*>/gi;
  while ((m = tagRe.exec(html))) {
    const tag = m[0];
    const content = tag.match(/content\s*=\s*["']([^"']*)["']/i)?.[1]?.trim();
    const key =
      tag.match(/property\s*=\s*["']([^"']+)["']/i)?.[1] ??
      tag.match(/name\s*=\s*["']([^"']+)["']/i)?.[1] ??
      "";
    if (content && key) out.push({ content, key: key.toLowerCase() });
  }
  return out;
}

/** 从 HTML 里找 `<title>…</title>` 的纯文本（去标签、去空白）。 */
function titleFallback(html: string): string {
  const m = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  if (!m) return "";
  return m[1].replace(/<[^>]+>/g, "").replace(/\s+/g, " ").trim();
}

/** 把某个 meta 值解析成绝对 URL；解析不了返回 null。 */
function absolutize(url: string, baseUrl: string): string | null {
  try {
    return new URL(url, baseUrl).href;
  } catch {
    return null;
  }
}

/** 抓标题：og:title 优先，twitter:title 次之，<title> 兜底。 */
function pickTitle(tags: MetaTag[], html: string): string {
  for (const key of ["og:title", "twitter:title", "title"]) {
    const t = tags.find((x) => x.key === key)?.content;
    if (t && t) return t;
  }
  return titleFallback(html);
}

/**
 * 抓文章的 Open Graph / Twitter 元数据。
 * 返回值：title/image/siteName/type；抓不到的字段给空值（title 兜底用 <title>）。
 */
export function extractOgMeta(html: string, baseUrl: string): OgMeta {
  const tags = metaTags(html);
  const pickValue = (...keys: string[]) =>
    keys.map((k) => tags.find((x) => x.key === k)?.content).find(Boolean) ?? "";

  const image = pickValue("og:image", "twitter:image", "og:image:secure_url", "twitter:image:src");
  const siteName = pickValue("og:site_name", "twitter:site");
  const type = pickValue("og:type", "twitter:card");

  return {
    title: pickTitle(tags, html),
    image: image ? absolutize(image, baseUrl) : null,
    siteName: siteName.replace(/^@/, ""),
    type,
  };
}
