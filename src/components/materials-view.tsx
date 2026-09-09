"use client";

import { useMemo, useState, type ReactNode } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  Inbox,
  Plus,
  X,
  Trash2,
  Loader2,
  Folder,
  FolderPlus,
  Video,
  Music,
  FileText,
  Rss,
  Sparkles,
  Upload,
  CheckSquare,
  Square,
  MoreHorizontal,
  SlidersHorizontal,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { BottomSheet } from "./bottom-sheet";
import { createClient } from "@/lib/supabase/client";
import { LANG_ORDER, LANG_LABEL, LANG_COLOR, type Lang } from "@/lib/lang-detect";
import { MATERIAL_TYPE_LABEL } from "@/lib/types";
import type {
  MaterialWithNote,
  MaterialCollection,
  MaterialType,
  MaterialStatus,
  Material,
} from "@/lib/types";
import { EmptyState } from "./empty-state";
import { AddMaterialPanel } from "./add-material-panel";
import { AiGeneratePanel } from "./ai-generate-panel";
import { FileUploadPanel } from "./file-upload-panel";
import { ImportMaterialModal } from "./import-material-modal";
import { EditMaterialModal } from "./edit-material-modal";
import { EditCollectionModal } from "./edit-collection-modal";
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

/** 把 YouTube 的 hqdefault 缩略图升级到 maxresdefault（1280×720，明显更清晰）。 */
function ytMaxRes(src: string | null): string | null {
  return src ? src.replace("/hqdefault.jpg", "/maxresdefault.jpg") : src;
}

/**
 * 素材缩略图：YouTube 缩略图统一升级到 maxresdefault（更清晰）。
 * 个别视频没有 maxres（会返回 120×90 灰色占位图，或直接 404），用 onLoad/onError 自动回退到 hqdefault，
 * 避免升级后反而出现灰块。
 */
function MaterialThumb({
  src,
  alt,
  className,
  fallback,
}: {
  src: string | null;
  alt: string;
  className: string;
  fallback: ReactNode;
}) {
  return src ? (
    <img
      src={ytMaxRes(src) ?? ""}
      alt={alt}
      className={className}
      loading="lazy"
      onError={(e) => {
        const img = e.currentTarget;
        if (img.src.includes("/maxresdefault.jpg"))
          img.src = img.src.replace("/maxresdefault.jpg", "/hqdefault.jpg");
      }}
      onLoad={(e) => {
        const img = e.currentTarget;
        if (img.naturalWidth <= 121 && img.src.includes("/maxresdefault.jpg"))
          img.src = img.src.replace("/maxresdefault.jpg", "/hqdefault.jpg");
      }}
    />
  ) : (
    fallback
  );
}

function materialLang(m: Material): Lang {
  const l = m.lang as Lang | null | undefined;
  return l && l in LANG_LABEL ? l : "other";
}

/** 合集的「语言标签」：优先用合集自己定义的 lang，其次按里面素材唯一语言兜底，再退为空。 */
function collectionLang(c: MaterialCollection, rec: ColMeta | undefined): Lang | null {
  const l = c.lang as Lang | null | undefined;
  if (l && l in LANG_LABEL) return l;
  if (rec && rec.langs.size === 1) return [...rec.langs][0];
  return null;
}

/** 合集的「类型标签」：优先用合集自己定义的 type，其次按里面素材唯一类型兜底。 */
function collectionType(c: MaterialCollection, rec: ColMeta | undefined): MaterialType | null {
  if (c.type) return c.type;
  if (rec && rec.types.size === 1) return [...rec.types][0];
  return null;
}

/** 一个合集在列表里的汇总（条数 + 最新一条的缩略图/类型 + 出现过的语言/类型/状态集合，供筛选）。 */
type ColMeta = {
  count: number;
  thumbnail: string | null;
  type: MaterialType | null;
  langs: Set<Lang>;
  types: Set<MaterialType>;
  statuses: Set<MaterialStatus>;
};

const chip =
  "rounded-full px-3 py-2 text-sm font-medium transition-colors";
const chipOff = "text-zinc-500 hover:bg-zinc-100";
const chipOn = "bg-teal-600 text-white";
const tabBtn = (on: boolean) =>
  `inline-flex items-center rounded-lg px-3.5 py-2.5 text-sm font-medium transition-colors ${
    on ? "bg-teal-600 text-white shadow-sm" : "text-zinc-500 hover:bg-zinc-50"
  }`;

/**
 * 素材库主页（统一板块）：合集与单条素材都在同一个列表里展示。
 * - 顶部检索 + 语言/类型/状态筛选（恢复原来的筛选导航）。
 * - 合集行（文件夹）与素材行（单条）同排；点合集进详情、点素材标题进观看页。
 * - 批量操作：全选/全不选，选中的单条可移到合集、选中的合集与单条可删除。
 * - 每条素材的编辑/删除藏在「⋯」菜单里，行面只留主操作。
 */
export function MaterialsView({
  materials,
  collections,
}: {
  materials: MaterialWithNote[];
  collections: MaterialCollection[];
}) {
  const router = useRouter();
  const [localCollections, setLocalCollections] =
    useState<MaterialCollection[]>(collections);

  // 筛选（语言/类型/状态默认折叠进「筛选」下拉；激活项以可清除小标签展示）
  const [langFilter, setLangFilter] = useState<Lang | "all">("all");
  const [typeFilter, setTypeFilter] = useState<MaterialType | "all">("all");
  const [statusFilter, setStatusFilter] = useState<MaterialStatus | "all">("all");
  const [filterOpen, setFilterOpen] = useState(false);
  const activeCount = (langFilter !== "all" ? 1 : 0) + (typeFilter !== "all" ? 1 : 0) + (statusFilter !== "all" ? 1 : 0);

  // 面板
  const [addOpen, setAddOpen] = useState(false);
  const [aiOpen, setAiOpen] = useState(false);
  const [uploadOpen, setUploadOpen] = useState(false);
  const [newColOpen, setNewColOpen] = useState(false);
  const [newColName, setNewColName] = useState("");
  const [newColLang, setNewColLang] = useState<Lang | "">("");
  const [newColType, setNewColType] = useState<MaterialType | "">("");
  const [colBusy, setColBusy] = useState(false);
  const [colError, setColError] = useState<string | null>(null);

  // 编辑 / 导入
  const [editTarget, setEditTarget] = useState<Material | null>(null);
  const [editTargetCol, setEditTargetCol] = useState<MaterialCollection | null>(null);
  const [importTarget, setImportTarget] = useState<Material | null>(null);
  const [, setBusyId] = useState<string | null>(null);

  // 批量
  const [batchMode, setBatchMode] = useState(false);
  const [sel, setSel] = useState<string[]>([]); // "col:<id>" 或 "mat:<id>"
  const [busy, setBusy] = useState(false);
  const [moveTarget, setMoveTarget] = useState("");
  // 移动端顶栏的「＋」折叠菜单（批量/新建合集/上传/AI 都收进去）。
  const [moreOpen, setMoreOpen] = useState(false);

  // 顶部 Tab：单条素材 / 合集 分开放，各占整屏（单条在前、也是默认）。
  const [tab, setTab] = useState<"cols" | "mats">("mats");

  const singles = useMemo(() => materials.filter((m) => !m.collection_id), [materials]);

  const colMeta = useMemo<Map<string, ColMeta>>(() => {
    const map = new Map<string, ColMeta>();
    for (const m of materials) {
      if (!m.collection_id) continue;
      const rec =
        map.get(m.collection_id) ??
        ({ count: 0, thumbnail: null, type: null, langs: new Set(), types: new Set(), statuses: new Set() } as ColMeta);
      rec.count++;
      if (!rec.thumbnail) rec.thumbnail = m.thumbnail;
      if (!rec.type) rec.type = m.type;
      rec.langs.add(materialLang(m));
      rec.types.add(m.type);
      rec.statuses.add(m.status);
      map.set(m.collection_id, rec);
    }
    return map;
  }, [materials]);

  // 筛选项只列「数据里实际出现过的」值，不预置空的（用户要求：没有的就别多预设）。
  const presentLangs = useMemo(() => {
    const langs = new Set<Lang>();
    for (const m of singles) langs.add(materialLang(m));
    for (const c of localCollections) {
      const rec = colMeta.get(c.id);
      const cl = c.lang as Lang | null;
      if (cl && cl in LANG_LABEL) langs.add(cl);
      if (rec) for (const l of rec.langs) langs.add(l);
    }
    return langs;
  }, [singles, localCollections, colMeta]);

  const presentTypes = useMemo(() => {
    const types = new Set<MaterialType>();
    for (const m of singles) types.add(m.type);
    for (const c of localCollections) {
      const rec = colMeta.get(c.id);
      if (c.type) types.add(c.type);
      if (rec) for (const t of rec.types) types.add(t);
    }
    return types;
  }, [singles, localCollections, colMeta]);

  const presentStatuses = useMemo(() => {
    const statuses = new Set<MaterialStatus>();
    for (const m of singles) statuses.add(m.status);
    for (const c of localCollections) {
      const rec = colMeta.get(c.id);
      if (rec) for (const s of rec.statuses) statuses.add(s);
    }
    return statuses;
  }, [singles, localCollections, colMeta]);

  const visibleCols = useMemo(
    () =>
      localCollections.filter((c) => {
        const rec = colMeta.get(c.id);
        // 合集自己定义了语言/类型标签就用它的，没定义才按里面素材兜底。
        if (langFilter !== "all") {
          const myLang = c.lang as Lang | null;
          if (myLang) {
            if (myLang !== langFilter) return false;
          } else if (!(rec?.langs.has(langFilter) ?? false)) return false;
        }
        if (typeFilter !== "all") {
          if (c.type) {
            if (c.type !== typeFilter) return false;
          } else if (!(rec?.types.has(typeFilter) ?? false)) return false;
        }
        if (statusFilter !== "all" && !(rec?.statuses.has(statusFilter) ?? false)) return false;
        return true;
      }),
    [localCollections, colMeta, langFilter, typeFilter, statusFilter]
  );

  const visibleMats = useMemo(
    () =>
      singles.filter((m) => {
        if (langFilter !== "all" && materialLang(m) !== langFilter) return false;
        if (typeFilter !== "all" && m.type !== typeFilter) return false;
        if (statusFilter !== "all" && m.status !== statusFilter) return false;
        return true;
      }),
    [singles, langFilter, typeFilter, statusFilter]
  );

  function toggleSel(key: string) {
    setSel((prev) => (prev.includes(key) ? prev.filter((x) => x !== key) : [...prev, key]));
  }
  /** 当前 Tab 下可见项的全选键。 */
  function tabKeys(): string[] {
    return tab === "cols"
      ? visibleCols.map((c) => `col:${c.id}`)
      : visibleMats.map((m) => `mat:${m.id}`);
  }
  function allSel() {
    const keys = tabKeys();
    return keys.length > 0 && keys.every((k) => sel.includes(k));
  }
  function toggleAllSel() {
    if (allSel()) setSel([]);
    else setSel(tabKeys());
  }
  const selColIds = sel.filter((k) => k.startsWith("col:")).map((k) => k.slice(4));
  const selMatIds = sel.filter((k) => k.startsWith("mat:")).map((k) => k.slice(4));

  async function createCollection() {
    const name = newColName.trim();
    if (!name) return;
    setColBusy(true);
    setColError(null);
    const supabase = createClient();
    const { data, error } = await supabase
      .from("material_collections")
      .insert({ name, lang: newColLang || null, type: newColType || null })
      .select()
      .single();
    setColBusy(false);
    if (error || !data) {
      setColError(error?.message ?? "创建失败");
      return;
    }
    setLocalCollections((prev) => [...prev, data as MaterialCollection]);
    setNewColName("");
    setNewColLang("");
    setNewColType("");
    setNewColOpen(false);
    router.refresh();
  }

  async function deleteCollection(id: string) {
    if (!window.confirm("删除这个合集？里面的素材会退到「单条」继续展示。")) return;
    setBusyId(id);
    const supabase = createClient();
    const { error } = await supabase.from("material_collections").delete().eq("id", id);
    setBusyId(null);
    if (!error) {
      setLocalCollections((prev) => prev.filter((c) => c.id !== id));
      router.refresh();
    }
  }

  async function deleteMaterials(ids: string[]) {
    if (!ids.length) return;
    if (!window.confirm(`删除选中的 ${ids.length} 条素材？`)) return;
    setBusy(true);
    const supabase = createClient();
    const { error } = await supabase.from("materials").delete().in("id", ids);
    setBusy(false);
    if (!error) {
      setSel([]);
      setBatchMode(false);
      router.refresh();
    }
  }

  async function deleteCollections(ids: string[]) {
    if (!ids.length) return;
    if (!window.confirm(`删除选中的 ${ids.length} 个合集？里面的素材会退到「单条」继续展示。`)) return;
    setBusy(true);
    const supabase = createClient();
    const { error } = await supabase.from("material_collections").delete().in("id", ids);
    setBusy(false);
    if (!error) {
      setLocalCollections((prev) => prev.filter((c) => !ids.includes(c.id)));
      setSel([]);
      setBatchMode(false);
      router.refresh();
    }
  }

  async function batchDelete() {
    if (selColIds.length) await deleteCollections(selColIds);
    if (selMatIds.length) await deleteMaterials(selMatIds);
  }

  async function batchMove(collectionId: string) {
    if (!selMatIds.length) return;
    setBusy(true);
    const supabase = createClient();
    await supabase.from("materials").update({ collection_id: collectionId || null }).in("id", selMatIds);
    setBusy(false);
    setSel([]);
    setBatchMode(false);
    setMoveTarget("");
    router.refresh();
  }

  async function deleteMaterial(m: Material) {
    if (!window.confirm(`删除素材「${m.title || m.url}」？`)) return;
    setBusyId(m.id);
    const supabase = createClient();
    await supabase.from("materials").delete().eq("id", m.id);
    setBusyId(null);
    router.refresh();
  }

  const selIcon = (on: boolean) => (on ? <CheckSquare className="h-4 w-4" /> : <Square className="h-4 w-4" />);

  const LangChips = (
    <div className="flex flex-wrap items-center gap-1.5">
      <button onClick={() => setLangFilter("all")} className={`${chip} ${langFilter === "all" ? chipOn : chipOff}`}>
        全部语言
      </button>
      {LANG_ORDER.filter((l) => presentLangs.has(l)).map((l) => (
        <button
          key={l}
          onClick={() => setLangFilter(l)}
          className={`${chip} ${langFilter === l ? "bg-teal-600 text-white" : chipOff}`}
        >
          {LANG_LABEL[l]}
        </button>
      ))}
    </div>
  );

  const TypeChips = (
    <div className="flex flex-wrap items-center gap-1.5">
      <button onClick={() => setTypeFilter("all")} className={`${chip} ${typeFilter === "all" ? chipOn : chipOff}`}>
        全部类型
      </button>
      {Object.entries(MATERIAL_TYPE_LABEL)
        .filter(([t]) => presentTypes.has(t as MaterialType))
        .map(([t, label]) => (
        <button
          key={t}
          onClick={() => setTypeFilter(t as MaterialType)}
          className={`${chip} ${typeFilter === t ? chipOn : chipOff}`}
        >
          {label}
        </button>
      ))}
    </div>
  );

  const StatusChips = (
    <div className="flex flex-wrap items-center gap-1.5">
      <button
        onClick={() => setStatusFilter("all")}
        className={`${chip} ${statusFilter === "all" ? chipOn : chipOff}`}
      >
        全部状态
      </button>
      {(["pending", "imported"] as MaterialStatus[])
        .filter((s) => presentStatuses.has(s))
        .map((s) => (
        <button
          key={s}
          onClick={() => setStatusFilter(s)}
          className={`${chip} ${statusFilter === s ? chipOn : chipOff}`}
        >
          {STATUS_LABEL[s]}
        </button>
      ))}
    </div>
  );

  return (
    <div>
      {/* ===== 标题 + 工具栏（同行：标题左，操作右） ===== */}
      <div className="page-header mb-4 flex flex-wrap items-center justify-between gap-3">
        <h1 className="min-w-0 flex-1 truncate text-2xl font-bold text-zinc-900">素材</h1>
        <div className="flex flex-wrap items-center justify-end gap-2">
          {/* 次要操作收进「⋯」菜单（桌面 + 移动统一，顶栏只留「收藏素材」主操作，不冗长） */}
          <div className="relative">
            <button
              onClick={() => setMoreOpen((v) => !v)}
              aria-label="更多操作"
              title="更多操作"
              className={`inline-flex h-9 w-9 items-center justify-center rounded-lg border ${
                moreOpen ? "border-teal-600 text-teal-700" : "border-zinc-200 text-zinc-600 hover:bg-zinc-50"
              }`}
            >
              {moreOpen ? <X className="h-5 w-5" /> : <MoreHorizontal className="h-5 w-5" />}
            </button>
            {moreOpen && (
              <>
                <div className="fixed inset-0 z-30" onClick={() => setMoreOpen(false)} />
                <div className="absolute right-0 top-11 z-40 w-44 overflow-hidden rounded-xl border border-zinc-200 bg-white py-1 shadow-lg">
                  <button
                    onClick={() => {
                      setMoreOpen(false);
                      setNewColOpen((v) => !v);
                    }}
                    className="flex w-full items-center gap-2 px-3 py-2.5 text-left text-sm text-zinc-700 transition-colors hover:bg-zinc-50"
                  >
                    <FolderPlus className="h-4 w-4" />
                    新建合集
                  </button>
                  <button
                    onClick={() => {
                      setMoreOpen(false);
                      setAddOpen(false);
                      setAiOpen(false);
                      setUploadOpen((v) => !v);
                    }}
                    className="flex w-full items-center gap-2 px-3 py-2.5 text-left text-sm text-zinc-700 transition-colors hover:bg-zinc-50"
                  >
                    <Upload className="h-4 w-4" />
                    上传文件
                  </button>
                  <button
                    onClick={() => {
                      setMoreOpen(false);
                      setAddOpen(false);
                      setUploadOpen(false);
                      setAiOpen((v) => !v);
                    }}
                    className="flex w-full items-center gap-2 px-3 py-2.5 text-left text-sm text-zinc-700 transition-colors hover:bg-zinc-50"
                  >
                    <Sparkles className="h-4 w-4" />
                    AI 生成
                  </button>
                </div>
              </>
            )}
          </div>

          {/* 主操作：收藏素材，始终可见 */}
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

      {/* ===== 新建合集 / 收藏 / 上传 / AI 生成面板：紧贴顶栏按钮，位于 tab 之上 ===== */}
      {/* 新建合集：底部弹出面板（非居中弹窗），内容贴近面板。 */}
      <BottomSheet open={newColOpen} onClose={() => setNewColOpen(false)} title="新合集">
        <form onSubmit={(e) => { e.preventDefault(); void createCollection(); }} className="mt-1 flex flex-col gap-2 sm:flex-row sm:items-center">
              <input
                value={newColName}
                onChange={(e) => setNewColName(e.target.value)}
                placeholder="新合集名（例如：法语播客 / 日语 N3 语法）"
                className="min-w-0 flex-1 rounded-lg border border-zinc-200 px-3 py-2.5 text-sm text-zinc-800 focus:border-teal-500 focus:outline-none placeholder:text-sm"
              />
              <div className="flex shrink-0 items-center gap-2">
                <select
                  value={newColType}
                  onChange={(e) => setNewColType(e.target.value as MaterialType | "")}
                  className="rounded-lg border border-zinc-200 px-2 py-2 text-sm text-zinc-600 focus:border-teal-500 focus:outline-none"
                >
                  <option value="">类型…</option>
                  {(Object.keys(MATERIAL_TYPE_LABEL) as MaterialType[]).map((t) => (
                    <option key={t} value={t}>{MATERIAL_TYPE_LABEL[t]}</option>
                  ))}
                </select>
                <select
                  value={newColLang}
                  onChange={(e) => setNewColLang(e.target.value as Lang | "")}
                  className="rounded-lg border border-zinc-200 px-2 py-2 text-sm text-zinc-600 focus:border-teal-500 focus:outline-none"
                >
                  <option value="">语言…</option>
                  {LANG_ORDER.map((l) => (
                    <option key={l} value={l}>{LANG_LABEL[l]}</option>
                  ))}
                </select>
                <button
                  type="submit"
                  disabled={colBusy || !newColName.trim()}
                  className="inline-flex shrink-0 items-center gap-1 rounded-lg bg-teal-600 px-3.5 py-2.5 text-sm font-semibold text-white hover:bg-teal-700 disabled:opacity-60"
                >
                  {colBusy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}
                  新建
                </button>
              </div>
            </form>
        {colError && <p className="mt-2 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-600">{colError}</p>}
      </BottomSheet>
      {addOpen && <AddMaterialPanel collections={localCollections} onClose={() => setAddOpen(false)} />}
      {uploadOpen && <FileUploadPanel collections={localCollections} onClose={() => setUploadOpen(false)} />}
      {aiOpen && <AiGeneratePanel collections={localCollections} onClose={() => setAiOpen(false)} />}

      {/* ===== Tab 切换 + 筛选（同行，省纵向空间）===== */}
      <div className="mb-4 rounded-2xl border border-zinc-200 bg-white p-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          {/* 单条素材 / 合集 切换（单条在前） */}
          <div className="inline-flex items-center gap-1 rounded-xl border border-zinc-200 bg-white p-1">
            <button onClick={() => setTab("mats")} className={tabBtn(tab === "mats")}>
              单条素材
              <span className="ml-1.5 text-xs opacity-70">{singles.length}</span>
            </button>
            <button onClick={() => setTab("cols")} className={tabBtn(tab === "cols")}>
              合集
              <span className="ml-1.5 text-xs opacity-70">{localCollections.length}</span>
            </button>
          </div>
          {/* 批量操作 + 筛选开关（保持稳定，激活标签另起一行，避免被挤到 Tab 下方再溢出） */}
          <div className="flex items-center gap-1.5">
          <button
            onClick={() => setBatchMode((v) => !v)}
            className={`text-xs font-medium transition-colors ${batchMode ? "text-teal-600" : "text-zinc-400 hover:text-teal-600"}`}
          >
            {batchMode ? "退出批量" : "批量操作"}
          </button>
          <div className="relative">
            <button
              onClick={() => setFilterOpen((v) => !v)}
              className={`inline-flex items-center gap-1.5 rounded-full px-3 py-2 text-xs font-medium transition-colors ${
                activeCount > 0 || filterOpen
                  ? "bg-teal-600 text-white hover:bg-teal-700"
                  : "border border-zinc-200 text-zinc-600 hover:bg-zinc-50"
              }`}
            >
              <SlidersHorizontal className="h-3.5 w-3.5" />
              筛选
              {activeCount > 0 && (
                <span className="rounded-full bg-white/25 px-1.5 text-xs leading-4">{activeCount}</span>
              )}
            </button>
            {filterOpen && (
              <>
                <div className="fixed inset-0 z-30" onClick={() => setFilterOpen(false)} />
                <div className="absolute right-0 top-full z-40 mt-2 max-h-[70vh] w-60 max-w-[calc(100vw-2rem)] space-y-3 overflow-y-auto rounded-xl border border-zinc-200 bg-white p-3 shadow-lg sm:w-72">
                  <div>{LangChips}</div>
                  <div>{TypeChips}</div>
                  <div>{StatusChips}</div>
                </div>
              </>
            )}
          </div>
          </div>
        </div>

        {/* 已激活的筛选标签：单独一行，出现/消失不影响上面的 Tab/筛选行 */}
        {activeCount > 0 && (
          <div className="mt-2 flex flex-wrap items-center gap-1.5">
            {langFilter !== "all" && (
              <button onClick={() => setLangFilter("all")} className={`${chip} ${chipOn}`}>
                {LANG_LABEL[langFilter]} ×
              </button>
            )}
            {typeFilter !== "all" && (
              <button onClick={() => setTypeFilter("all")} className={`${chip} ${chipOn}`}>
                {MATERIAL_TYPE_LABEL[typeFilter]} ×
              </button>
            )}
            {statusFilter !== "all" && (
              <button onClick={() => setStatusFilter("all")} className={`${chip} ${chipOn}`}>
                {STATUS_LABEL[statusFilter]} ×
              </button>
            )}
            <button
              onClick={() => {
                setLangFilter("all");
                setTypeFilter("all");
                setStatusFilter("all");
              }}
              className="text-xs text-zinc-400 hover:text-zinc-600"
            >
              清空
            </button>
          </div>
        )}


        {/* 批量操作栏 */}
        {batchMode && (
          <div className="mt-3 flex flex-wrap items-center gap-2 border-t border-zinc-100 pt-3">
            <button onClick={toggleAllSel} className="inline-flex items-center gap-1 rounded-lg px-2 py-1.5 text-sm font-medium text-teal-600 hover:bg-teal-50">
              {selIcon(allSel())}
              {allSel() ? "全不选" : "全选"}
            </button>
            <button onClick={() => setBatchMode(false)} className="inline-flex items-center gap-1 rounded-lg border border-zinc-200 px-3 py-2 text-sm font-medium text-zinc-600 hover:bg-zinc-50">
              取消
            </button>
            {selMatIds.length > 0 && (
              <select
                value={moveTarget}
                onChange={(e) => {
                  if (e.target.value) void batchMove(e.target.value);
                }}
                className="rounded-lg border border-zinc-200 px-2.5 py-1.5 text-sm text-zinc-600 focus:border-teal-500 focus:outline-none"
              >
                <option value="">移到合集…</option>
                {localCollections.map((c) => (
                  <option key={c.id} value={c.id}>{c.name}</option>
                ))}
              </select>
            )}
            {sel.length > 0 && (
              <button
                onClick={batchDelete}
                disabled={busy}
                className="inline-flex items-center gap-1 rounded-lg border border-red-200 px-3 py-2 text-sm font-medium text-red-600 transition-colors hover:bg-red-50 disabled:opacity-50"
              >
                {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Trash2 className="h-3.5 w-3.5" />}
                删除选中（{sel.length}）
              </button>
            )}
          </div>
        )}
      </div>

      {/* ===== 统一板块：合集 / 单条素材，按 Tab 分别渲染 ===== */}
      {tab === "cols" ? (
        visibleCols.length === 0 ? (
          <EmptyState
            icon={<Inbox className="h-10 w-10" />}
            title={localCollections.length === 0 ? "还没有合集" : "没有匹配的合集"}
            description={
              localCollections.length === 0
                ? "点右上角「新建合集」把素材归类；合集内的素材会折叠在其中，不再跟单条混排。"
                : "换个搜索词或筛选条件试试。"
            }
          />
        ) : (
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
            {visibleCols.map((c) => {
              const rec = colMeta.get(c.id);
              const Icon = rec?.type ? TYPE_ICON[rec.type] ?? FileText : Folder;
              return (
                <div
                  key={`col:${c.id}`}
                  className={`flex flex-col overflow-hidden rounded-2xl border border-zinc-200 bg-white ${batchMode ? "cursor-pointer" : ""}`}
                  onClick={batchMode ? () => toggleSel(`col:${c.id}`) : undefined}
                >
                  <div className="relative">
                    <MaterialThumb
                      src={rec?.thumbnail ?? null}
                      alt=""
                      className="aspect-video w-full object-cover"
                      fallback={
                        <div className="flex aspect-video w-full flex-col items-center justify-center gap-1 bg-gradient-to-br from-teal-50 to-cyan-100/60 text-teal-300">
                          <Icon className="h-8 w-8" />
                          <span className="text-[11px] font-semibold text-teal-500">{c.name.slice(0, 1) || "集"}</span>
                        </div>
                      }
                    />
                    {batchMode && (
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          toggleSel(`col:${c.id}`);
                        }}
                        aria-label="选择合集"
                        className={`absolute right-2 top-2 drop-shadow ${sel.includes(`col:${c.id}`) ? "text-teal-600" : "text-zinc-300 hover:text-zinc-500"}`}
                      >
                        {selIcon(sel.includes(`col:${c.id}`))}
                      </button>
                    )}
                  </div>
                  <div className="flex flex-1 flex-col p-3">
                    {batchMode ? (
                      <p className="truncate text-sm font-medium text-zinc-900">{c.name}</p>
                    ) : (
                      <Link
                        href={`/materials/collection/${c.id}`}
                        className="block truncate text-sm font-medium text-zinc-900 hover:text-teal-700"
                      >
                        {c.name}
                      </Link>
                    )}
                    <p className="mt-0.5 text-xs text-zinc-400">{rec?.count ?? 0} 条素材</p>
                    <div className="mt-2 flex flex-wrap items-center gap-1.5">
                      <span className="rounded-full bg-zinc-100 px-2 py-0.5 text-xs font-medium text-zinc-500">合集</span>
                      {(() => {
                        const cl = collectionLang(c, rec);
                        return cl ? (
                          <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${LANG_COLOR[cl]}`}>{LANG_LABEL[cl]}</span>
                        ) : null;
                      })()}
                      {collectionType(c, rec) ? (
                        <span className="rounded-full bg-zinc-100 px-2 py-0.5 text-xs font-medium text-zinc-600">
                          {MATERIAL_TYPE_LABEL[collectionType(c, rec) as MaterialType]}
                        </span>
                      ) : null}
                    </div>
                    {!batchMode && (
                      <div className="mt-2 flex justify-end">
                        <RowMenu
                          items={[
                            { label: "编辑", onClick: () => setEditTargetCol(c) },
                            { label: "删除", danger: true, onClick: () => deleteCollection(c.id) },
                          ]}
                        />
                      </div>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )
      ) : visibleMats.length === 0 ? (
        <EmptyState
          icon={<Inbox className="h-10 w-10" />}
          title={singles.length === 0 ? "还没有单条素材" : "没有匹配的素材"}
          description={
            singles.length === 0
              ? "点右上角「收藏素材」贴链接；未归入合集的会作为单条显示。"
              : "换个搜索词或筛选条件试试。"
          }
        />
      ) : (
        <ul className="space-y-3">
          {visibleMats.map((m) => {
            const Icon = TYPE_ICON[m.type] ?? FileText;
            const lang = materialLang(m);
            return (
              <li
                key={`mat:${m.id}`}
                className={`flex flex-col gap-3 rounded-2xl border border-zinc-200 bg-white p-4 sm:flex-row ${batchMode ? "cursor-pointer" : ""}`}
                onClick={batchMode ? () => toggleSel(`mat:${m.id}`) : undefined}
              >
                <div className="flex shrink-0 items-start gap-3">
                  {batchMode && (
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        toggleSel(`mat:${m.id}`);
                      }}
                      aria-label="选择素材"
                      className={`mt-4 shrink-0 ${sel.includes(`mat:${m.id}`) ? "text-teal-600" : "text-zinc-300 hover:text-zinc-500"}`}
                    >
                      {selIcon(sel.includes(`mat:${m.id}`))}
                    </button>
                  )}
                  <MaterialThumb
                    src={m.thumbnail ?? null}
                    alt=""
                    className="h-16 w-24 rounded-lg object-cover"
                    fallback={
                      <div className="flex h-16 w-24 items-center justify-center rounded-lg bg-zinc-50 text-zinc-300">
                        <Icon className="h-6 w-6" />
                      </div>
                    }
                  />
                </div>

                <div className="min-w-0 flex-1">
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      {batchMode ? (
                        <p className="truncate font-medium text-zinc-900">{m.title || m.url}</p>
                      ) : (
                        <Link
                          href={`/materials/${m.id}`}
                          onClick={(e) => e.stopPropagation()}
                          className="block truncate font-medium text-zinc-900 hover:text-teal-700"
                          title={m.title}
                        >
                          {m.title || m.url}
                        </Link>
                      )}
                      {m.source && <p className="truncate text-xs text-zinc-400">{m.source}</p>}
                    </div>
                    {!batchMode && (
                      <div className="shrink-0">
                        <RowMenu
                          items={[
                            { label: "编辑", onClick: () => setEditTarget(m) },
                            { label: "导入到笔记", onClick: () => setImportTarget(m) },
                            { label: "删除", danger: true, onClick: () => deleteMaterial(m) },
                          ]}
                        />
                      </div>
                    )}
                  </div>

                  {m.status === "imported" && m.note_id && m.note_title && (
                    <Link href={`/notes/${m.note_id}`} className="mt-1 inline-block max-w-full truncate text-xs text-teal-600 hover:underline">
                      已导入 → {m.note_title}
                    </Link>
                  )}

                  <div className="mt-2 flex flex-wrap items-center gap-1.5">
                    <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${LANG_COLOR[lang]}`}>{LANG_LABEL[lang]}</span>
                    <span className="rounded-full bg-zinc-100 px-2 py-0.5 text-xs font-medium text-zinc-600">
                      {MATERIAL_TYPE_LABEL[m.type]}
                    </span>
                    <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${STATUS_COLOR[m.status]}`}>{STATUS_LABEL[m.status]}</span>
                  </div>
                </div>
              </li>
            );
          })}
        </ul>
      )}

      {editTarget && (
        <EditMaterialModal
          material={editTarget}
          collections={localCollections}
          onClose={() => setEditTarget(null)}
          onSaved={() => router.refresh()}
        />
      )}
      {editTargetCol && (
        <EditCollectionModal
          collection={editTargetCol}
          onClose={() => setEditTargetCol(null)}
          onSaved={(updated) => {
            setLocalCollections((prev) => prev.map((c) => (c.id === updated.id ? updated : c)));
            router.refresh();
          }}
        />
      )}
      {importTarget && <ImportMaterialModal material={importTarget} onClose={() => setImportTarget(null)} />}
    </div>
  );
}
