"use client";

import { useState, useMemo } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  ArrowLeft,
  Plus,
  Trash2,
  CheckSquare,
  Square,
  Search,
  Video,
  Music,
  FileText,
  Rss,
  Sparkles,
  Upload,
  Loader2,
  Inbox,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { LANG_LABEL, LANG_COLOR, type Lang } from "@/lib/lang-detect";
import type { MaterialWithNote, MaterialCollection, MaterialType, MaterialStatus, Material } from "@/lib/types";
import { EmptyState } from "./empty-state";
import { AddMaterialPanel } from "./add-material-panel";
import { AiGeneratePanel } from "./ai-generate-panel";
import { FileUploadPanel } from "./file-upload-panel";
import { ImportMaterialModal } from "./import-material-modal";
import { EditMaterialModal } from "./edit-material-modal";
import { RowMenu } from "./row-menu";

const TYPE_ICON: Record<MaterialType, LucideIcon> = {
  youtube: Video,
  audio: Music,
  spotify: Music,
  link: FileText,
  podcast: Rss,
  file: FileText,
  generated: Sparkles,
};
const STATUS_LABEL: Record<MaterialStatus, string> = { pending: "待处理", imported: "已导入" };
const STATUS_COLOR: Record<MaterialStatus, string> = {
  pending: "bg-amber-50 text-amber-700",
  imported: "bg-emerald-50 text-emerald-700",
};

function materialLang(m: Material): Lang {
  const l = m.lang as Lang | null | undefined;
  return l && l in LANG_LABEL ? l : "other";
}

/** 一个合集的素材列表：点进去逐条预览 / 导入笔记 / 删除 / 移到其它合集。 */
export function CollectionDetail({
  collection,
  materials,
  collections,
}: {
  collection: MaterialCollection;
  materials: MaterialWithNote[];
  collections: MaterialCollection[];
}) {
  const router = useRouter();
  const [query, setQuery] = useState("");
  const [addOpen, setAddOpen] = useState(false);
  const [aiOpen, setAiOpen] = useState(false);
  const [uploadOpen, setUploadOpen] = useState(false);
  const [importTarget, setImportTarget] = useState<Material | null>(null);
  const [editTarget, setEditTarget] = useState<Material | null>(null);
  const [, setBusyId] = useState<string | null>(null);
  // 批量操作
  const [batchMode, setBatchMode] = useState(false);
  const [selIds, setSelIds] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [moveTarget, setMoveTarget] = useState("");

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return materials;
    return materials.filter(
      (m) =>
        (m.title ?? "").toLowerCase().includes(q) ||
        (m.source ?? "").toLowerCase().includes(q) ||
        m.url.toLowerCase().includes(q)
    );
  }, [materials, query]);

  async function deleteMaterial(m: Material) {
    if (!window.confirm(`删除素材「${m.title || m.url}」？`)) return;
    setBusyId(m.id);
    const supabase = createClient();
    await supabase.from("materials").delete().eq("id", m.id);
    setBusyId(null);
    router.refresh();
  }

  function toggleSel(id: string) {
    setSelIds((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));
  }
  function allSel() {
    return visible.length > 0 && selIds.length === visible.length;
  }
  function toggleAllSel() {
    setSelIds(allSel() ? [] : visible.map((m) => m.id));
  }

  async function deleteMaterials(ids: string[]) {
    if (!ids.length) return;
    if (!window.confirm(`删除选中的 ${ids.length} 条素材？`)) return;
    setBusy(true);
    const supabase = createClient();
    const { error } = await supabase.from("materials").delete().in("id", ids);
    setBusy(false);
    if (!error) {
      setSelIds([]);
      setBatchMode(false);
      router.refresh();
    }
  }

  async function moveMaterials(ids: string[], collectionId: string) {
    if (!ids.length) return;
    setBusy(true);
    const supabase = createClient();
    await supabase
      .from("materials")
      .update({ collection_id: collectionId || null })
      .in("id", ids);
    setBusy(false);
    setSelIds([]);
    setBatchMode(false);
    setMoveTarget("");
    router.refresh();
  }

  return (
    <div>
      {/* 顶栏 */}
      <header className="page-header mb-4">
        <Link
          href="/materials"
          className="inline-flex items-center gap-1.5 text-sm font-medium text-zinc-500 hover:text-zinc-800"
        >
          <ArrowLeft className="h-4 w-4" />
          素材库
        </Link>
        <div className="mt-2 flex flex-wrap items-center justify-between gap-2">
          <div className="min-w-0">
            <h1 className="text-lg font-bold text-zinc-900">{collection.name}</h1>
            <p className="text-sm text-zinc-400">{materials.length} 条素材</p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <button
              onClick={() => {
                setAddOpen(false);
                setAiOpen(false);
                setUploadOpen((v) => !v);
              }}
              className="inline-flex items-center gap-1 rounded-lg border border-zinc-200 px-3 py-2.5 text-sm font-medium text-zinc-600 transition-colors hover:bg-zinc-50"
            >
              <Upload className="h-4 w-4" />
              上传文件
            </button>
            <button
              onClick={() => {
                setAddOpen(false);
                setUploadOpen(false);
                setAiOpen((v) => !v);
              }}
              className="inline-flex items-center gap-1 rounded-lg border border-zinc-200 px-3 py-2.5 text-sm font-medium text-zinc-600 transition-colors hover:bg-zinc-50"
            >
              <Sparkles className="h-4 w-4" />
              AI 生成
            </button>
            <button
              onClick={() => {
                setAiOpen(false);
                setUploadOpen(false);
                setAddOpen((v) => !v);
              }}
              className="inline-flex items-center gap-1 rounded-lg bg-teal-600 px-3.5 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-teal-700"
            >
              <Plus className="h-4 w-4" />
              收藏素材
            </button>
          </div>
        </div>
      </header>

      {/* 搜索 */}
      <div className="relative mb-4">
        <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-zinc-400" />
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="搜索这个合集里的标题 / 来源 / 链接…"
          className="w-full rounded-xl border border-zinc-200 bg-white py-2.5 pl-9 pr-3 text-sm focus:border-teal-500 focus:outline-none placeholder:text-sm"
        />
      </div>

      {addOpen && (
        <AddMaterialPanel
          collections={collections}
          defaultCollectionId={collection.id}
          onClose={() => setAddOpen(false)}
        />
      )}
      {uploadOpen && (
        <FileUploadPanel
          collections={collections}
          defaultCollectionId={collection.id}
          onClose={() => setUploadOpen(false)}
        />
      )}
      {aiOpen && (
        <AiGeneratePanel
          collections={collections}
          defaultCollectionId={collection.id}
          onClose={() => setAiOpen(false)}
        />
      )}

      {/* 批量操作栏 */}
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        {batchMode ? (
          <div className="flex flex-wrap items-center gap-2">
            <button
              onClick={toggleAllSel}
              className="inline-flex items-center gap-1 rounded-lg px-2 py-1.5 text-sm font-medium text-teal-600 hover:bg-teal-50"
            >
              {allSel() ? <Square className="h-4 w-4" /> : <CheckSquare className="h-4 w-4" />}
              {allSel() ? "全不选" : "全选"}
            </button>
            <button
              onClick={() => setBatchMode(false)}
              className="inline-flex items-center gap-1 rounded-lg border border-zinc-200 px-3 py-2 text-sm font-medium text-zinc-600 hover:bg-zinc-50"
            >
              取消
            </button>
            {selIds.length > 0 && (
              <>
                <select
                  value={moveTarget}
                  onChange={(e) => {
                    if (e.target.value) void moveMaterials(selIds, e.target.value);
                  }}
                  className="rounded-lg border border-zinc-200 px-2.5 py-1.5 text-sm text-zinc-600 focus:border-teal-500 focus:outline-none"
                >
                  <option value="">移到其它合集…</option>
                  {collections.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name}
                    </option>
                  ))}
                </select>
                <button
                  onClick={() => deleteMaterials(selIds)}
                  disabled={busy}
                  className="inline-flex items-center gap-1 rounded-lg border border-red-200 px-3 py-2 text-sm font-medium text-red-600 transition-colors hover:bg-red-50 disabled:opacity-50"
                >
                  {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Trash2 className="h-3.5 w-3.5" />}
                  删除选中（{selIds.length}）
                </button>
              </>
            )}
          </div>
        ) : (
          <button
            onClick={() => setBatchMode(true)}
            disabled={materials.length === 0}
            className="inline-flex items-center gap-1 rounded-lg border border-zinc-200 px-3 py-2 text-sm font-medium text-zinc-600 transition-colors hover:bg-zinc-50 disabled:opacity-50"
          >
            <CheckSquare className="h-4 w-4" />
            批量操作
          </button>
        )}
      </div>

      {/* 列表 */}
      {materials.length === 0 ? (
        <EmptyState
          icon={<Inbox className="h-10 w-10" />}
          title="这个合集还是空的"
          description="点右上角「收藏素材」贴链接，或去素材库收藏后把它归进这个合集。"
        />
      ) : visible.length === 0 ? (
        <div className="rounded-xl border border-dashed border-zinc-300 px-4 py-10 text-center text-sm text-zinc-500">
          没有匹配的素材。
        </div>
      ) : (
        <ul className="space-y-3">
          {visible.map((m) => {
            const Icon = TYPE_ICON[m.type] ?? FileText;
            const lang = materialLang(m);
            return (
              <li
                key={m.id}
                className={`flex flex-col gap-3 rounded-2xl border border-zinc-200 bg-white p-4 sm:flex-row ${
                  batchMode ? "cursor-pointer" : ""
                }`}
                onClick={batchMode ? () => toggleSel(m.id) : undefined}
              >
                <div className="flex shrink-0 items-start gap-3">
                  {batchMode && (
                    <button
                      onClick={() => toggleSel(m.id)}
                      aria-label="选择素材"
                      className={`mt-4 shrink-0 ${
                        selIds.includes(m.id) ? "text-teal-600" : "text-zinc-300 hover:text-zinc-500"
                      }`}
                    >
                      {selIds.includes(m.id) ? (
                        <CheckSquare className="h-5 w-5" />
                      ) : (
                        <Square className="h-5 w-5" />
                      )}
                    </button>
                  )}
                  {m.thumbnail ? (
                    <img
                      src={m.thumbnail}
                      alt=""
                      className="h-16 w-24 rounded-lg object-cover"
                      loading="lazy"
                    />
                  ) : (
                    <div className="flex h-16 w-24 items-center justify-center rounded-lg bg-zinc-50 text-zinc-300">
                      <Icon className="h-6 w-6" />
                    </div>
                  )}
                </div>

                <div className="min-w-0 flex-1">
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <Link
                        href={`/materials/${m.id}`}
                        onClick={(e) => e.stopPropagation()}
                        className="block truncate font-medium text-zinc-900 hover:text-teal-700"
                        title={m.title}
                      >
                        {m.title || m.url}
                      </Link>
                      {m.source && <p className="truncate text-xs text-zinc-400">{m.source}</p>}
                    </div>
                    <div className="flex shrink-0 items-center gap-1.5">
                      <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${LANG_COLOR[lang]}`}>
                        {LANG_LABEL[lang]}
                      </span>
                      <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${STATUS_COLOR[m.status]}`}>
                        {STATUS_LABEL[m.status]}
                      </span>
                    </div>
                  </div>

                  {m.status === "imported" && m.note_id && m.note_title && (
                    <Link
                      href={`/notes/${m.note_id}`}
                      className="mt-1 inline-block max-w-full truncate text-xs text-teal-600 hover:underline"
                    >
                      已导入 → {m.note_title}
                    </Link>
                  )}

                  {!batchMode && (
                    <div className="mt-3 flex flex-wrap items-center gap-2">
                      {m.status === "imported" && m.note_id ? (
                        <Link
                          href={`/notes/${m.note_id}`}
                          className="inline-flex items-center gap-1 rounded-lg bg-teal-600 px-2.5 py-1.5 text-xs font-semibold text-white transition-colors hover:bg-teal-700"
                        >
                          查看笔记
                        </Link>
                      ) : (
                        <button
                          onClick={() => setImportTarget(m)}
                          className="inline-flex items-center gap-1 rounded-lg bg-teal-600 px-2.5 py-2 text-xs font-semibold text-white transition-colors hover:bg-teal-700"
                        >
                          导入到笔记
                        </button>
                      )}
                      <RowMenu
                        items={[
                          { label: "编辑", onClick: () => setEditTarget(m) },
                          { label: "删除", danger: true, onClick: () => deleteMaterial(m) },
                        ]}
                      />
                    </div>
                  )}
                </div>
              </li>
            );
          })}
        </ul>
      )}

      {importTarget && (
        <ImportMaterialModal
          material={importTarget}
          onClose={() => setImportTarget(null)}
        />
      )}

      {editTarget && (
        <EditMaterialModal
          material={editTarget}
          collections={collections}
          onClose={() => setEditTarget(null)}
          onSaved={() => router.refresh()}
        />
      )}
    </div>
  );
}
