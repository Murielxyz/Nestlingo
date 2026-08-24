"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { X, Upload, Loader2, FolderPlus, Music, Image as ImageIcon, FileText } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { detectLang } from "@/lib/lang-detect";
import type { MaterialCollection } from "@/lib/types";

type FileKind = "audio" | "image" | "doc";

const KIND_ICON: Record<FileKind, typeof Music> = { audio: Music, image: ImageIcon, doc: FileText };
const KIND_LABEL: Record<FileKind, string> = { audio: "音频", image: "图片", doc: "文档" };
const MIME_KIND: Record<string, FileKind> = {
  "audio/mpeg": "audio",
  "audio/mp4": "audio",
  "audio/x-m4a": "audio",
  "audio/aac": "audio",
  "audio/wav": "audio",
  "audio/x-wav": "audio",
  "audio/ogg": "audio",
  "audio/opus": "audio",
  "audio/flac": "audio",
  "image/png": "image",
  "image/jpeg": "image",
  "image/webp": "image",
  "image/gif": "image",
  "image/avif": "image",
};

/** 按扩展名兜底判断子类（MIME 没覆盖到的）。 */
function kindByExt(name: string): FileKind | null {
  if (/\.(mp3|m4a|aac|wav|ogg|oga|opus|flac)$/i.test(name)) return "audio";
  if (/\.(png|jpe?g|webp|gif|avif|svg|bmp)$/i.test(name)) return "image";
  if (/\.(pdf|docx?|pptx?|xlsx?|txt|md|rtf)$/i.test(name)) return "doc";
  return null;
}

/** 判断上传文件属于哪类素材（音频/图片/文档），判断不出则拒绝。 */
function detectKind(file: File): FileKind | null {
  return MIME_KIND[file.type] ?? kindByExt(file.name) ?? null;
}

/** 上传文件素材面板：选一个本地音频/图片/文档 → 传到 Supabase Storage（每用户一个前缀文件夹）→
 *  存成一条 type=file 素材，进入其观看页查看/导入。上传前必须选一个合集。 */
export function FileUploadPanel({
  collections,
  defaultCollectionId,
  onClose,
}: {
  collections: MaterialCollection[];
  defaultCollectionId?: string;
  onClose: () => void;
}) {
  const router = useRouter();
  const inputRef = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<File | null>(null);
  const [kind, setKind] = useState<FileKind | "">("");
  const [collectionId, setCollectionId] = useState(defaultCollectionId ?? "");
  const [newColName, setNewColName] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const input =
    "w-full rounded-lg border border-zinc-200 px-3 py-2 text-sm text-zinc-800 focus:border-teal-500 focus:outline-none";

  function pick(f: File | null) {
    setError(null);
    if (!f) {
      setFile(null);
      setKind("");
      return;
    }
    const k = detectKind(f);
    if (!k) {
      setFile(null);
      setKind("");
      setError("这个文件不是支持的音频 / 图片 / 文档。");
      return;
    }
    setFile(f);
    setKind(k);
  }

  async function upload() {
    if (!file || !kind) {
      setError("请先选一个文件。");
      return;
    }
    setBusy(true);
    setError(null);
    const supabase = createClient();

    // 需要当前用户 id：存储桶 RLS 要求文件落在「自己 uid 的前缀文件夹」下。
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) {
      setError("未登录。");
      setBusy(false);
      return;
    }

    let cid = collectionId;
    if (!cid && newColName.trim()) {
      const { data, error: cErr } = await supabase
        .from("material_collections")
        .insert({ name: newColName.trim() })
        .select("id")
        .single();
      if (cErr || !data) {
        setError(cErr?.message ?? "创建合集失败");
        setBusy(false);
        return;
      }
      cid = data.id;
    }
    if (!cid) {
      setError("请选一个合集（素材必须归入合集，否则不显示）。");
      setBusy(false);
      return;
    }

    // 路径：materials/{uuid}.{ext} 前缀由 RLS 校验为当前用户（避免串号、避免同名覆盖）。
    const ext = file.name.split(".").pop() ?? "bin";
    const path = `${user.id}/${crypto.randomUUID()}.${ext}`;
    try {
      const { error: upErr } = await supabase.storage
        .from("materials")
        .upload(path, file, { contentType: file.type || "application/octet-stream" });
      if (upErr) throw new Error(upErr.message);

      const { data: pub } = supabase.storage.from("materials").getPublicUrl(path);
      const title = file.name.replace(/\.[^.]+$/, "");
      const { data: inserted, error: insErr } = await supabase
        .from("materials")
        .insert({
          url: pub.publicUrl,
          type: "file",
          file_kind: kind,
          title: title || file.name,
          source: file.name,
          thumbnail: kind === "image" ? pub.publicUrl : null,
          lang: detectLang(title),
          collection_id: cid,
          status: "pending",
        })
        .select("id")
        .single();
      if (insErr || !inserted) throw new Error(insErr?.message ?? "保存失败");

      router.push(`/materials/${inserted.id}`);
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setBusy(false);
    }
  }

  const KindIcon = kind ? KIND_ICON[kind] : Upload;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={onClose}>
      <div
        className="max-h-[85vh] w-full max-w-lg overflow-y-auto rounded-2xl bg-white p-5 shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
      <div className="mb-3 flex items-center justify-between">
        <h3 className="text-sm font-semibold text-zinc-800">上传文件素材</h3>
        <button
          onClick={onClose}
          className="rounded-lg px-2 py-1 text-zinc-400 hover:bg-zinc-100 hover:text-zinc-700"
          aria-label="关闭"
        >
          <X className="h-4 w-4" />
        </button>
      </div>

      {/* 文件选择 */}
      <input
        ref={inputRef}
        type="file"
        accept="audio/*,image/*,.pdf,.doc,.docx,.ppt,.pptx,.xls,.xlsx,.txt,.md,.rtf"
        className="hidden"
        onChange={(e) => pick(e.target.files?.[0] ?? null)}
      />
      <button
        type="button"
        onClick={() => inputRef.current?.click()}
        className="flex w-full flex-col items-center justify-center gap-2 rounded-xl border-2 border-dashed border-zinc-300 bg-zinc-50/50 px-4 py-8 text-zinc-500 transition-colors hover:border-teal-300 hover:text-teal-600"
      >
        <KindIcon className="h-8 w-8" />
        <span className="text-sm">
          {file ? file.name : "点击选择文件（音频 / 图片 / 文档）"}
        </span>
      </button>

      <div className="mt-3 flex flex-wrap items-center gap-2">
        {file && kind && (
          <span className="rounded-full bg-teal-50 px-2.5 py-0.5 text-xs font-medium text-teal-700">
            {KIND_LABEL[kind]}
          </span>
        )}
        {defaultCollectionId ? (
          <p className="text-xs text-zinc-500">
            归入合集「{collections.find((c) => c.id === defaultCollectionId)?.name}」。
          </p>
        ) : (
          <div className="flex flex-1 flex-col gap-2 sm:flex-row sm:items-center">
            <select
              value={collectionId}
              onChange={(e) => setCollectionId(e.target.value)}
              className={input}
            >
              <option value="">选择一个合集…</option>
              {collections.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
            <div className="flex flex-1 gap-1.5">
              <input
                value={newColName}
                onChange={(e) => setNewColName(e.target.value)}
                placeholder="或新建一个合集"
                className={input}
              />
              <span className="inline-flex shrink-0 items-center px-1 text-zinc-300">
                <FolderPlus className="h-4 w-4" />
              </span>
            </div>
          </div>
        )}
      </div>

      {error && (
        <p className="mt-2 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-600">
          {error}
        </p>
      )}

      <div className="mt-4 flex justify-end gap-2">
        <button
          onClick={onClose}
          className="rounded-lg border border-zinc-200 px-4 py-2 text-sm text-zinc-600 hover:bg-zinc-50"
        >
          取消
        </button>
        <button
          onClick={upload}
          disabled={busy || !file}
          className="inline-flex items-center gap-1.5 rounded-lg bg-teal-600 px-4 py-2 text-sm font-semibold text-white hover:bg-teal-700 disabled:opacity-60"
        >
          {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Upload className="h-4 w-4" />}
          {busy ? "上传中…" : "上传并收藏"}
        </button>
      </div>
      </div>
    </div>
  );
}
