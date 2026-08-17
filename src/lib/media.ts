// 媒体学习：把用户粘贴的链接解析成可嵌入的 YouTube 视频或音频直链。
// 纯模块（无 React / 无网络请求），客户端和服务端都能用。

export type MediaKind = "youtube" | "audio";

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

  return null;
}

export const KIND_LABEL: Record<MediaKind, string> = {
  youtube: "视频",
  audio: "音频",
};
