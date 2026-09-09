"use client";

// AI 语伴的收藏层 + 写回笔记：客户端组件专用（浏览器端 supabase）。
// 文字知识存 assistant_records，媒体链接复用 materials（走现有 parseMediaUrl 取缩略图/类型）。
// 语伴会话本身在 localStorage（可清空），这里只管「已收藏」的持久记录——清空会话不动收藏。

import { createClient } from "./client";
import type { JSONContent } from "@tiptap/core";
import { docToText } from "@/lib/doc-to-text";
import { pointsToNoteContent, type AssistantPoint } from "@/lib/ai-note";
import { parseMediaUrl } from "@/lib/media";

export type AssistantRecord = {
  id: string;
  kind: string;
  prompt: string | null;
  reply: string | null;
  points: AssistantPoint[] | null;
  media_id: string | null;
  note_id: string | null;
  favorited: string | null;
  created_at: string;
  updated_at: string;
};

/** 收藏一条文字知识（语伴产出）：写进 assistant_records，favorited 落当前时间。返回记录 id（失败 null）。 */
export async function collectTextRecord(input: {
  kind?: string;
  prompt: string;
  reply: string;
  points?: AssistantPoint[];
  mediaId?: string | null;
}): Promise<string | null> {
  const supabase = createClient();
  const { data, error } = await supabase
    .from("assistant_records")
    .insert({
      kind: input.kind ?? "note",
      prompt: input.prompt,
      reply: input.reply,
      points: input.points ?? null,
      media_id: input.mediaId ?? null,
      favorited: new Date().toISOString(),
    })
    .select("id")
    .single();
  if (error || !data) return null;
  return data.id as string;
}

/** 收藏一条媒体链接（语伴产出）：复用 materials 表（带缩略图）。返回素材 id（失败 null）。 */
export async function collectMediaRecord(input: {
  url: string;
  title: string;
  type: string;
  thumbnail: string | null;
}): Promise<string | null> {
  const supabase = createClient();
  const { data, error } = await supabase
    .from("materials")
    .insert({
      url: input.url,
      title: input.title,
      type: input.type,
      thumbnail: input.thumbnail ?? null,
      status: "pending",
    })
    .select("id")
    .single();
  if (error || !data) return null;
  return data.id as string;
}

/** 已导入到的笔记 id（文字）：在收藏/导入后回写 assistant_records.note_id。 */
export async function markRecordNote(recordId: string, noteId: string): Promise<void> {
  await createClient().from("assistant_records").update({ note_id: noteId }).eq("id", recordId);
}

/** 取消收藏（文字）：删除一条 assistant_records。 */
export async function deleteRecord(recordId: string): Promise<void> {
  await createClient().from("assistant_records").delete().eq("id", recordId);
}

/** 取消收藏（媒体）：删除一条 materials。 */
export async function deleteMaterial(materialId: string): Promise<void> {
  await createClient().from("materials").delete().eq("id", materialId);
}

/**
 * 把一组节点追加进目标笔记（noteId 为空则新建一篇标题为 title 的笔记），返回笔记 id。
 * 照 import-material 的写回方式：读现有 content → 拼新节点 → 更新 content + content_text（新建则 insert）。
 * 语伴「导入笔记」文字知识点用 pointsToNoteContent 生成节点后走这里。
 */
export async function appendNodesToNote(opts: {
  noteId?: string | null;
  title?: string;
  nodes: JSONContent[];
}): Promise<string> {
  const supabase = createClient();
  let existing: JSONContent | null = null;
  let targetNoteId = opts.noteId ?? null;
  if (targetNoteId) {
    const { data } = await supabase
      .from("notes")
      .select("content")
      .eq("id", targetNoteId)
      .single();
    existing = (data?.content ?? null) as JSONContent | null;
  }

  const baseContent: JSONContent[] = Array.isArray(existing)
    ? (existing as JSONContent[])
    : Array.isArray(existing?.content)
      ? (existing.content as JSONContent[])
      : [];
  const newDoc: JSONContent = { type: "doc", content: [...baseContent, ...opts.nodes] };

  if (targetNoteId) {
    const { error } = await supabase
      .from("notes")
      .update({ content: newDoc, content_text: docToText(newDoc) })
      .eq("id", targetNoteId);
    if (error) throw new Error(error.message);
  } else {
    const { data, error } = await supabase
      .from("notes")
      .insert({
        title: opts.title || "语伴导入",
        folder_id: null,
        content: newDoc,
        content_text: docToText(newDoc),
      })
      .select("id")
      .single();
    if (error || !data) throw new Error(error?.message ?? "创建笔记失败");
    targetNoteId = data.id;
  }

  return targetNoteId as string;
}

/** 语伴「导入笔记」用的是「知识点 → callout 节点」这一条路径（与学伴面板 addToNote 一致）。 */
export function pointsToBlocks(points: AssistantPoint[]): JSONContent[] {
  return pointsToNoteContent(points.filter((p) => p.front));
}

/** 从一段文字里挑出第一条「可识别」的媒体链接（YouTube / 音频 / Spotify）。没有返回 null。
 *  返回值带上 kind 供 materials.type 使用（与 parseMediaUrl 的 MediaKind 一致）。 */
export function findMediaUrl(text: string): {
  url: string;
  parsed: { kind: string; embedUrl: string; thumbnail: string | null; title: string };
} | null {
  const m = text.match(/https?:\/\/\S+/g);
  if (!m) return null;
  for (const url of m) {
    const parsed = parseMediaUrl(url);
    if (parsed) {
      return {
        url,
        parsed: {
          kind: parsed.kind,
          embedUrl: parsed.embedUrl,
          thumbnail: parsed.thumbnail,
          title: parsed.title,
        },
      };
    }
  }
  return null;
}
