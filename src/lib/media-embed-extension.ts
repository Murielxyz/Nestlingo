// 内嵌媒体节点：在笔记里直接嵌入 YouTube 视频 / 音频直链。
// 编辑态用 React NodeView 渲染真 iframe / <audio>，下方给「生成文字稿 / AI 精读 / 删除」动作；
// renderHTML 输出静态占位（YouTube 缩略图 / 音频标签），让 generateHTML（分享图）也能渲染，
// 不依赖跨域 iframe。

import { Node, mergeAttributes } from "@tiptap/core";
import { ReactNodeViewRenderer } from "@tiptap/react";
import { MediaEmbedNodeView } from "@/components/media-embed-nodeview";

export type MediaEmbedAttrs = {
  src: string;
  kind: "youtube" | "audio" | "spotify";
  title: string;
};

/** 从 YouTube embed 链接里抠出视频 id（缩略图用）。 */
function youtubeId(embedUrl: string): string | null {
  const m = embedUrl.match(/(?:embed\/|youtu\.be\/|v=|\/)([\w-]{11})/);
  return m?.[1] ?? null;
}

export const MediaEmbed = Node.create({
  name: "mediaEmbed",
  group: "block",
  atom: true,
  draggable: true,

  addAttributes() {
    return {
      src: { default: "" },
      kind: { default: "youtube" },
      title: { default: "" },
    };
  },

  parseHTML() {
    return [
      {
        tag: "div[data-media-embed]",
        getAttrs: (el) => ({
          src: el.getAttribute("data-src") ?? "",
          kind: el.getAttribute("data-kind") ?? "youtube",
          title: el.getAttribute("data-title") ?? "",
        }),
      },
    ];
  },

  addNodeView() {
    return ReactNodeViewRenderer(MediaEmbedNodeView);
  },

  renderHTML({ node, HTMLAttributes }) {
    const { src, kind, title } = node.attrs as MediaEmbedAttrs;
    const base = mergeAttributes(HTMLAttributes, {
      "data-media-embed": "true",
      "data-kind": kind,
      "data-src": src,
      "data-title": title,
    });

    if (kind === "youtube") {
      const id = youtubeId(src);
      const thumb = id ? `https://i.ytimg.com/vi/${id}/hqdefault.jpg` : null;
      return [
        "div",
        base,
        thumb
          ? ["img", { src: thumb, class: "media-embed-thumb", alt: title || "视频" }]
          : ["p", {}, `▶ ${title || "视频"}`],
      ];
    }
    if (kind === "spotify") {
      return ["div", base, ["p", {}, `♪ ${title || "音乐"}`]];
    }
    return ["div", base, ["p", {}, title || "音频"]];
  },
});
