// 媒体学习：把用户粘贴的链接解析成可嵌入的 YouTube 视频或音频直链。
// 纯模块（无 React / 无网络请求），客户端和服务端都能用。

export type MediaKind = "youtube" | "audio" | "spotify";

export type ParsedMedia = {
  kind: MediaKind;
  /** 可直接嵌入的地址：YouTube 用 embed 链接，音频就是原链接。 */
  embedUrl: string;
  /** YouTube 缩略图；音频为 null。 */
  thumbnail: string | null;
  /** 默认标题（用户可改）。 */
  title: string;
};

// 匹配 youtube.com/watch?v= / shorts / live / embed，以及 youtu.be 短链。
const YT_RE =
  /(?:youtube\.com\/(?:watch\?(?:[^#]*&)?v=|shorts\/|live\/|embed\/)|youtu\.be\/)([\w-]{11})/i;

// 常见音频文件扩展名（播客/音轨直链）。
const AUDIO_RE = /^https?:\/\/.+\.(mp3|m4a|aac|wav|ogg|oga|opus|flac)(\?.*)?$/i;

// Spotify：单曲 / 专辑 / 歌单 / 播客单集。
const SPOTIFY_RE =
  /(?:open\.spotify\.com|play\.spotify\.com)\/(track|album|playlist|episode)\/([\w-]+)/i;

/** 解析链接，识别不了返回 null。 */
export function parseMediaUrl(raw: string): ParsedMedia | null {
  const url = raw.trim();
  if (!url) return null;

  const yt = url.match(YT_RE);
  if (yt && yt[1]) {
    const id = yt[1];
    return {
      kind: "youtube",
      embedUrl: `https://www.youtube.com/embed/${id}`,
      thumbnail: `https://i.ytimg.com/vi/${id}/hqdefault.jpg`,
      title: "YouTube 视频",
    };
  }

  if (AUDIO_RE.test(url)) {
    return { kind: "audio", embedUrl: url, thumbnail: null, title: "音频" };
  }

  const spot = url.match(SPOTIFY_RE);
  if (spot && spot[2]) {
    const type = spot[1].toLowerCase();
    const id = spot[2];
    const label =
      type === "album"
        ? "专辑"
        : type === "playlist"
          ? "歌单"
          : type === "episode"
            ? "播客单集"
            : "单曲";
    return {
      kind: "spotify",
      embedUrl: `https://open.spotify.com/embed/${type}/${id}`,
      thumbnail: null,
      title: `Spotify ${label}`,
    };
  }

  return null;
}

// 匹配 YouTube 直链/短链里的合辑（playlist）参数：youtube.com/playlist?list=ID，
// 以及 watch?v=..&list=ID / youtu.be/..?list=ID 这类「带合辑上下文的单集链接」。
const YT_PLAYLIST_RE = /(?:youtube\.com|youtu\.be)[^\s]*[?&]list=([\w-]{10,})/i;

/**
 * 判断是不是 YouTube 合辑链接，是则返回规范化的合辑地址。
 * 合辑里的每一集解析出来都单独存成一条素材，归进同名的素材合集。
 */
export function parseYoutubePlaylist(raw: string): { id: string; url: string } | null {
  const m = raw.trim().match(YT_PLAYLIST_RE);
  if (!m) return null;
  const id = m[1];
  return { id, url: `https://www.youtube.com/playlist?list=${id}` };
}

/** 判断是不是播客 RSS / Atom 订阅链接（需要拉取解析后挑一集）。 */
export function isRssUrl(raw: string): boolean {
  const url = raw.trim();
  if (!url) return false;
  // 视频/音频直链不是 RSS。
  if (YT_RE.test(url) || AUDIO_RE.test(url)) return false;
  return (
    /\.(rss|xml|atom)([/?#]|$)/i.test(url) ||
    /\/feed([/?#]|$)/i.test(url) ||
    /feeds\./i.test(url) ||
    /anchor\.fm\/.+\/podcast\/rss/i.test(url) ||
    /\/rss([/?#]|$)/i.test(url)
  );
}

export const KIND_LABEL: Record<MediaKind, string> = {
  youtube: "视频",
  audio: "音频",
  spotify: "音乐",
};
