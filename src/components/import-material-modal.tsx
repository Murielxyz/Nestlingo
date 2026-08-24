"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { X, Search, FilePlus2, Loader2 } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { docToText } from "@/lib/doc-to-text";
import { parseMediaUrl } from "@/lib/media";
import { transcriptCallout } from "@/lib/ai-note";
import { MATERIAL_TYPE_LABEL } from "@/lib/types";
import type { Material } from "@/lib/types";
import type { JSONContent } from "@tiptap/core";
import type { MaterialImportExtra } from "@/lib/types";

/** 已有笔记选择器只需要 id + 标题（不等同于完整 Note，避免把服务端类型拖进客户端）。 */
type PickerNote = { id: string; title: string };

/** 真实外链才带进节点；AI 生成素材的 url 常为空字符串，不该产出坏链接。 */
const realHref = (url: string | null | undefined): string | null =>
  url && /^https?:\/\//i.test(url) ? url : null;

/** 追加到笔记的那几个节点。 */
function buildNodes(material: Material, extra: MaterialImportExtra): JSONContent[] {
  // 「来源」只给真实外链：AI 生成素材的 url 常为空字符串，不该产出坏链接。
  const source = realHref(material.url) ?? undefined;
  const embedAttrs = (src: string, kind: "youtube" | "audio" | "spotify", title: string) => ({
    src,
    kind,
    title,
    cover: material.thumbnail ?? null,
    original: realHref(material.url),
  });
  // 1) 显式正文（AI 生成 / 文章提取）→「原文」callout，带来源链接到原始 URL。
  if (extra.articleText?.trim()) {
    return [transcriptCallout(extra.articleText, source)];
  }
  // 2) 显式音频（播客选定单集）→ 内嵌播放器（带封面 + 原始链接）。
  if (extra.audioUrl) {
    return [
      {
        type: "mediaEmbed",
        attrs: embedAttrs(extra.audioUrl, "audio", extra.audioTitle ?? material.title),
      },
    ];
  }
  // 3) 上传文件：音频 → 播放器；图片 → 图示节点；文档 → 纯文本段落（标题 + 链接）。
  if (material.type === "file") {
    if (material.file_kind === "audio") {
      return [
        {
          type: "mediaEmbed",
          attrs: embedAttrs(material.url, "audio", material.title),
        },
      ];
    }
    if (material.file_kind === "image") {
      return [{ type: "image", attrs: { src: material.url, alt: material.title } }];
    }
    const text = material.title ? `${material.title}  ${material.url}` : material.url;
    return [{ type: "paragraph", content: [{ type: "text", text }] }];
  }
  // 4) 直接存了正文的素材（可能是旧 type=generated 数据）→「原文」callout。
  if (material.type === "generated" && material.content?.trim()) {
    return [transcriptCallout(material.content, source)];
  }
  // 5) 媒体（YouTube/音频/Spotify）→ 内嵌 mediaEmbed 节点。
  const parsed = parseMediaUrl(material.url);
  if (parsed && (parsed.kind === "youtube" || parsed.kind === "audio" || parsed.kind === "spotify")) {
    return [
      {
        type: "mediaEmbed",
        attrs: embedAttrs(parsed.embedUrl, parsed.kind, material.title),
      },
    ];
  }
  // 6) 网页文章（link）不再导入成「标题+链接」——统一做成「原文」块 + 来源标识；
  //    正文取自已存的 content，没有就以标题占位（导入后可在笔记里补正文 / AI 精读）。
  if (material.type === "link") {
    const body = (material.content || material.title || material.url).trim();
    return [transcriptCallout(body, source)];
  }
  // 其余（如整个播客订阅）无内嵌：退成「标题  链接」段落（主路径是选中单集内嵌）。
  const text = material.title ? `${material.title}  ${material.url}` : material.url;
  return [{ type: "paragraph", content: [{ type: "text", text }] }];
}

/**
 * 把一条素材追加进指定笔记（或新建一篇笔记）的 content，返回笔记 id。
 * - 媒体（YouTube/音频/Spotify）→ 内嵌 mediaEmbed 节点（src 用 embed 链接，导入后仍能点节点上的「生成文字稿 / AI 精读」）。
 * - 链接 / 播客（编辑器没有内嵌、也没有 Link 的 schema）→ 纯文本段落「标题  链接」。
 * - 上传文件按类型内嵌；AI 生成 / 文章提取的正文 →「原文」callout。
 * 直接沿用编辑器写 content 的方式（doc 形状 + docToText），保证「转成闪卡」能跳过 [媒体] / [原文]。
 */
export async function importMaterialToNote(
  material: Material,
  noteId: string | null,
  extra: MaterialImportExtra = {}
): Promise<string> {
  const supabase = createClient();

  // 1) 目标笔记现有 content（新笔记则延后创建）。
  let existing: JSONContent | null = null;
  let targetNoteId = noteId;
  if (noteId) {
    const { data } = await supabase
      .from("notes")
      .select("content")
      .eq("id", noteId)
      .single();
    existing = (data?.content ?? null) as JSONContent | null;
  }

  // 2) 要追加的节点。
  const nodes = buildNodes(material, extra);

  // 3) 组装新 doc：content 是真正的节点数组，兼容旧数据可能是数组的防御分支。
  const baseContent: JSONContent[] = Array.isArray(existing)
    ? (existing as JSONContent[])
    : Array.isArray(existing?.content)
      ? (existing.content as JSONContent[])
      : [];
  const newDoc: JSONContent = { type: "doc", content: [...baseContent, ...nodes] };

  // 4) 写回 / 新建笔记。
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
        title: extra.title || material.title || "无标题笔记",
        folder_id: null,
        content: newDoc,
        content_text: docToText(newDoc),
      })
      .select("id")
      .single();
    if (error || !data) throw new Error(error?.message ?? "创建笔记失败");
    targetNoteId = data.id;
  }

  // 5) 标「已导入」+ 记录落点。
  await supabase
    .from("materials")
    .update({ status: "imported", note_id: targetNoteId })
    .eq("id", material.id);

  return targetNoteId!;
}

/** 导入提示文案：按导入载荷判断会以哪种形式进笔记。 */
function embedHintOf(material: Material, extra?: MaterialImportExtra): string {
  if (extra?.articleText?.trim()) {
    return "将以「原文」区块加入笔记（可在笔记里 AI 精读 / 转卡）";
  }
  if (extra?.audioUrl) {
    return "将以「音频」内嵌进笔记";
  }
  if (material.type === "file") {
    if (material.file_kind === "audio") return "将以「音频」内嵌进笔记";
    if (material.file_kind === "image") return "将以图片加入笔记";
    return "将以链接段落加入笔记";
  }
  if (material.type === "generated" && material.content?.trim()) {
    return "将以「原文」区块加入笔记（可在笔记里 AI 精读 / 转卡）";
  }
  const parsed = parseMediaUrl(material.url);
  return parsed
    ? `将以「${MATERIAL_TYPE_LABEL[parsed.kind as keyof typeof MATERIAL_TYPE_LABEL]}」内嵌进笔记`
    : "将以链接段落加入笔记（可在笔记里点「闪卡」转卡）";
}

/** 导入到笔记弹窗：新建 / 选已有笔记。 */
export function ImportMaterialModal({
  material,
  extra,
  onClose,
}: {
  material: Material;
  extra?: MaterialImportExtra;
  onClose: () => void;
}) {
  const router = useRouter();
  const [mode, setMode] = useState<"new" | "existing">("new");
  const [notes, setNotes] = useState<PickerNote[]>([]);
  const [loadingNotes, setLoadingNotes] = useState(false);
  const [query, setQuery] = useState("");
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  // 打开「选已有」时载入候选笔记（过滤卡片文件、按最近更新排，照 listNotes 的查询）。
  useEffect(() => {
    if (mode !== "existing" || notes.length > 0) return;
    setLoadingNotes(true);
    (async () => {
      try {
        const { data } = await createClient()
          .from("notes")
          .select("id, title")
          .is("source_type", null)
          .order("updated_at", { ascending: false });
        setNotes((data ?? []) as PickerNote[]);
      } catch {
        setNotes([]);
      } finally {
        setLoadingNotes(false);
      }
    })();
  }, [mode, notes.length]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return notes;
    return notes.filter((n) => n.title.toLowerCase().includes(q));
  }, [notes, query]);

  // 导入会追加的内容类型提示。
  const embedHint = embedHintOf(material, extra);

  async function doImport(targetNoteId: string | null) {
    setBusyId(targetNoteId ?? "new");
    setError(null);
    try {
      const id = await importMaterialToNote(material, targetNoteId, extra ?? {});
      router.push(`/notes/${id}`);
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setBusyId(null);
    }
  }

  const chip = (active: boolean) =>
    `rounded-lg px-3.5 py-2 text-sm font-medium transition-colors ${
      active ? "bg-teal-600 text-white shadow-sm" : "text-zinc-500 hover:bg-zinc-50"
    }`;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div className="max-h-[85vh] w-full max-w-md overflow-y-auto rounded-2xl bg-white p-5 shadow-xl">
        <div className="mb-3 flex items-center justify-between">
          <h3 className="text-base font-semibold text-zinc-900">导入到笔记</h3>
          <button
            onClick={onClose}
            className="rounded-lg px-2 py-1 text-zinc-400 hover:bg-zinc-100 hover:text-zinc-700"
            aria-label="关闭"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <p className="mb-3 truncate text-sm text-zinc-500" title={extra?.title || material.title}>
          {extra?.title || material.title || material.url}
        </p>
        <p className="mb-4 rounded-lg bg-zinc-50 px-3 py-2 text-xs text-zinc-500">{embedHint}</p>

        <div className="mb-4 inline-flex items-center gap-1 rounded-xl border border-zinc-200 bg-white p-1">
          <button onClick={() => setMode("new")} className={chip(mode === "new")}>
            新建笔记
          </button>
          <button onClick={() => setMode("existing")} className={chip(mode === "existing")}>
            选已有笔记
          </button>
        </div>

        {mode === "new" ? (
          <button
            onClick={() => doImport(null)}
            disabled={busyId === "new"}
            className="inline-flex w-full items-center justify-center gap-1.5 rounded-xl bg-teal-600 px-4 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-teal-700 disabled:opacity-60"
          >
            {busyId === "new" ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <FilePlus2 className="h-4 w-4" />
            )}
            {busyId === "new" ? "导入中…" : "新建一篇笔记并导入"}
          </button>
        ) : (
          <div>
            <div className="relative mb-2">
              <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-zinc-400" />
              <input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="搜索笔记标题…"
                className="w-full rounded-lg border border-zinc-200 py-1.5 pl-8 pr-3 text-sm focus:border-teal-500 focus:outline-none"
              />
            </div>
            <div className="max-h-64 space-y-1 overflow-y-auto">
              {loadingNotes ? (
                <p className="py-4 text-center text-xs text-zinc-400">加载中…</p>
              ) : filtered.length === 0 ? (
                <p className="py-4 text-center text-xs text-zinc-400">没有匹配的笔记。</p>
              ) : (
                filtered.map((n) => (
                  <button
                    key={n.id}
                    onClick={() => doImport(n.id)}
                    disabled={busyId === n.id}
                    className="flex w-full items-center justify-between gap-2 rounded-lg border border-zinc-100 px-3 py-2 text-left transition-colors hover:bg-zinc-50 disabled:opacity-60"
                  >
                    <span className="min-w-0 flex-1 truncate text-sm text-zinc-700">
                      {n.title}
                    </span>
                    {busyId === n.id && (
                      <Loader2 className="h-4 w-4 shrink-0 animate-spin text-teal-500" />
                    )}
                  </button>
                ))
              )}
            </div>
          </div>
        )}

        {error && (
          <p className="mt-3 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-600">
            {error}
          </p>
        )}
      </div>
    </div>
  );
}
