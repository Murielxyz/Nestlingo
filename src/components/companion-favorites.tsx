"use client";

// 收藏页：合并展示语伴收藏——文字（assistant_records）+ 媒体（materials，带缩略图）。
// 每条可「导入笔记」（选现有或新建）/「取消收藏」（删除单条）。
// 本版：文字回复默认折叠成手风琴（点标题展开），避免收藏多了翻好久；
// 标题栏右侧改为「搜索 / 筛选 / 导入」三个图标：搜索按内容过滤、筛选按语言 + 类型过滤、
// 导入走素材库同款智能识别（视频 / 音频 / 非媒体链接按需处理）。

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  FilePlus2,
  Copy,
  Trash2,
  Loader2,
  Film,
  Music,
  MessageSquare,
  Search,
  SlidersHorizontal,
  Plus,
  ChevronDown,
  Play,
  X,
} from "lucide-react";
import { BackButton } from "./back-button";
import { createClient } from "@/lib/supabase/client";
import {
  deleteRecord,
  deleteMaterial,
  appendNodesToNote,
  pointsToBlocks,
  markRecordNote,
} from "@/lib/supabase/assistant";
import { importMaterialToNote } from "./import-material-modal";
import { AddMaterialPanel } from "./add-material-panel";
import type { AssistantPoint } from "@/lib/ai-note";
import { PointsPreview } from "./points-preview";
import { detectLang, LANG_LABEL, LANG_COLOR, type Lang } from "@/lib/lang-detect";
import { MATERIAL_TYPE_LABEL, type MaterialWithNote } from "@/lib/types";

type FavoriteRecord = {
  id: string;
  kind: string;
  prompt: string | null;
  reply: string | null;
  points: AssistantPoint[] | null;
  note_id: string | null;
  created_at?: string | null;
};

type ImportItem = { kind: "text"; record: FavoriteRecord } | { kind: "media"; material: MaterialWithNote };

type ListItem =
  | { kind: "text"; record: FavoriteRecord }
  | { kind: "media"; material: MaterialWithNote };

function toTs(v: string | null | undefined): number {
  return v ? new Date(v).getTime() : 0;
}

/** 统一的底部 chip：语言色 + 中性类型。 */
function chipClass(lang: string): string {
  return LANG_COLOR[lang as Lang] ?? LANG_COLOR.other;
}

type ImportState = { item: ImportItem; mode: "new" | "existing" } | null;

/** 文字收藏的类型、语言（智能识别）。 */
function recordMeta(r: FavoriteRecord): { type: string; lang: string } {
  return { type: "文字", lang: detectLang(r.reply || r.prompt || "") };
}

/** 媒体收藏的类型（归一化） + 语言（智能识别）。 */
function materialMeta(m: MaterialWithNote): { type: string; lang: string } {
  let type: string = MATERIAL_TYPE_LABEL[m.type as keyof typeof MATERIAL_TYPE_LABEL] ?? m.type ?? "其它";
  if (m.type === "youtube") type = "视频";
  else if (m.type === "spotify" || m.type === "audio") type = "音频";
  else if (m.type === "link") type = "链接";
  else if (m.type === "file") type = "媒体";
  return { type, lang: detectLang(m.title || m.url || "") };
}

const langLabel = (l: string) => LANG_LABEL[l as Lang] ?? l;
/** 类型筛选 chips 的稳定排序（只在出现的类型里挑，未出现的不展示）。 */
const TYPE_PREF = ["文字", "视频", "音频", "播客", "链接", "媒体", "AI"];

export function CompanionFavorites({
  initial,
  error: initialError,
}: {
  initial: { records: Record<string, unknown>[]; materials: MaterialWithNote[] } | null;
  error?: string | null;
}) {
  const router = useRouter();
  const records = (initial?.records ?? []) as FavoriteRecord[];
  const materials = (initial?.materials ?? []) as MaterialWithNote[];
  const [error, setError] = useState<string | null>(initialError ?? null);
  const [busy, setBusy] = useState<string | null>(null); // item id 进行中
  const [imp, setImp] = useState<ImportState>(null);

  // 导入弹窗：Esc 关闭
  useEffect(() => {
    if (!imp) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setImp(null);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [imp]);
  const [notes, setNotes] = useState<{ id: string; title: string }[]>([]);
  const [loadingNotes, setLoadingNotes] = useState(false);
  const [query, setQuery] = useState("");
  const [done, setDone] = useState<string | null>(null);

  // ===== 折叠 / 搜索 / 筛选 / 导入 面板状态 =====
  // 文字收藏 + 收藏素材（媒体）默认都收起，手动点标题展开。
  const [collapsed, setCollapsed] = useState<Set<string>>(
    () =>
      new Set([
        ...materials.map((m) => `m:${m.id}`),
        ...records.map((r) => `t:${r.id}`),
      ])
  );
  const [searchOpen, setSearchOpen] = useState(false);
  const [filterOpen, setFilterOpen] = useState(false);
  const [langFilter, setLangFilter] = useState<string | null>(null);
  const [typeFilter, setTypeFilter] = useState<string | null>(null);
  const [importOpen, setImportOpen] = useState(false);

  function toggleCollapse(key: string) {
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }

  // 可筛选的语言选项：文字 + 媒体中实际出现的语言，去重（以 data 为准）。
  const presentLangs = useMemo(() => {
    const s = new Set<string>();
    for (const r of records) s.add(recordMeta(r).lang);
    for (const m of materials) s.add(materialMeta(m).lang);
    return Array.from(s);
  }, [records, materials]);

  // 可筛选的类型选项：只列出「数据里实际出现过的」类型，不预置空的（用户要求：没有的就别多预设）。
  const presentTypes = useMemo(() => {
    const s = new Set<string>();
    for (const r of records) s.add(recordMeta(r).type);
    for (const m of materials) s.add(materialMeta(m).type);
    return [...s].sort(
      (a, b) => TYPE_PREF.indexOf(a) - TYPE_PREF.indexOf(b) || a.localeCompare(b)
    );
  }, [records, materials]);

  // ===== 搜索 + 筛选过滤（文字 + 媒体合并，按时间倒序混合排） =====
  const q = query.trim().toLowerCase();
  const sortedItems = useMemo<ListItem[]>(() => {
    const list: { item: ListItem; t: number }[] = [
      ...records.map((r) => ({ item: { kind: "text", record: r } as ListItem, t: toTs(r.created_at) })),
      ...materials.map((m) => ({
        item: { kind: "media", material: m } as ListItem,
        t: toTs(m.created_at ?? m.updated_at),
      })),
    ];
    return list.sort((a, b) => b.t - a.t).map((x) => x.item);
  }, [records, materials]);

  function itemMeta(it: ListItem): { type: string; lang: string } {
    return it.kind === "text" ? recordMeta(it.record) : materialMeta(it.material);
  }

  const filteredItems = useMemo(
    () =>
      sortedItems.filter((it) => {
        const meta = itemMeta(it);
        if (langFilter && meta.lang !== langFilter) return false;
        if (typeFilter && meta.type !== typeFilter) return false;
        if (!q) return true;
        if (it.kind === "text") {
          return (
            (it.record.prompt ?? "").toLowerCase().includes(q) ||
            (it.record.reply ?? "").toLowerCase().includes(q)
          );
        }
        return (
          (it.material.title ?? "").toLowerCase().includes(q) ||
          (it.material.url ?? "").toLowerCase().includes(q)
        );
      }),
    [sortedItems, q, langFilter, typeFilter]
  );

  function clearFilters() {
    setLangFilter(null);
    setTypeFilter(null);
  }

  function openImport(item: ImportItem, mode: "new" | "existing") {
    setImp({ item, mode });
    setQuery("");
    setNotes([]);
    setError(null);
    setDone(null);
    if (mode === "existing") void loadNotes();
  }

  async function loadNotes() {
    setLoadingNotes(true);
    try {
      const { data } = await createClient()
        .from("notes")
        .select("id, title")
        .is("source_type", null)
        .order("updated_at", { ascending: false });
      setNotes((data ?? []) as { id: string; title: string }[]);
    } catch {
      setNotes([]);
    } finally {
      setLoadingNotes(false);
    }
  }

  async function switchMode(mode: "new" | "existing") {
    if (!imp) return;
    setImp({ ...imp, mode });
    if (mode === "existing" && notes.length === 0) void loadNotes();
  }

  const filteredNotes = notes.filter((n) =>
    n.title.toLowerCase().includes(query.trim().toLowerCase())
  );

  async function doImport(targetNoteId: string | null) {
    if (!imp) return;
    const key = imp.item.kind === "text" ? `t:${imp.item.record.id}` : `m:${imp.item.material.id}`;
    setBusy(key);
    setError(null);
    try {
      let noteId: string;
      if (imp.item.kind === "text") {
        const pts = (imp.item.record.points ?? []).filter((p) => p.front);
        if (pts.length === 0) {
          setError("这条收藏没有可导入的知识点");
          setImp(null);
          return;
        }
        const nodes = pointsToBlocks(pts);
        noteId = await appendNodesToNote({ noteId: targetNoteId, title: "语伴收藏", nodes });
        await markRecordNote(imp.item.record.id, noteId);
      } else {
        noteId = await importMaterialToNote(imp.item.material, targetNoteId, {});
      }
      setImp(null);
      router.push(`/notes/${noteId}`);
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  }

  async function remove(item: FavoriteRecord | MaterialWithNote, kind: "text" | "media") {
    const id = kind === "text" ? (item as FavoriteRecord).id : (item as MaterialWithNote).id;
    if (!window.confirm("取消收藏这条？")) return;
    setBusy(`${kind}:${id}`);
    setError(null);
    try {
      if (kind === "text") await deleteRecord(id);
      else await deleteMaterial(id);
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  }

  async function copyText(text: string) {
    try {
      await navigator.clipboard.writeText(text);
      setDone("已复制");
    } catch {
      setError("复制失败");
    }
  }

  const isEmpty = filteredItems.length === 0;
  const totalCount = records.length + materials.length;

  /** 统一的底部芯片条：语言色 + 中性类型。 */
  function bottomBar(type: string, lang: string) {
    return (
      <div className="flex flex-wrap items-center gap-1.5 border-t border-zinc-100 px-4 py-2">
        <span className={`rounded-full px-2 py-0.5 text-[10px] font-medium ${chipClass(lang)}`}>
          {langLabel(lang)}
        </span>
        <span className="rounded-full bg-zinc-100 px-2 py-0.5 text-[10px] font-medium text-zinc-600">
          {type}
        </span>
      </div>
    );
  }

  function textCard(r: FavoriteRecord) {
    const meta = recordMeta(r);
    const key = `t:${r.id}`;
    const open = !collapsed.has(key);
    return (
      <div key={r.id} className="rounded-2xl border border-zinc-200 bg-white">
        <button
          onClick={() => toggleCollapse(key)}
          className="flex w-full items-start justify-between gap-3 p-4 text-left"
        >
          <span className="min-w-0 flex-1">
            {/* 收起时：完整展示我的问题（不截断、不折叠成主题），展开后正文只显示 AI 回答。 */}
            <span className="block whitespace-pre-wrap text-sm font-medium text-zinc-800">
              {r.prompt || "已收藏的对话"}
            </span>
          </span>
          <ChevronDown
            className={`h-4 w-4 shrink-0 text-zinc-400 transition-transform ${open ? "" : "rotate-180"}`}
          />
        </button>

        {open && (
          <div className="px-4 pb-4">
            <div className="rounded-lg bg-teal-50/60 px-3 py-2">
              <p className="text-xs font-medium text-teal-600">AI 回答</p>
              <p className="mt-0.5 whitespace-pre-wrap text-sm text-zinc-800">{r.reply || "（空回复）"}</p>
            </div>
            <div className="mt-3 rounded-lg border border-zinc-100 px-3 py-2">
              <PointsPreview points={r.points} />
            </div>
            <div className="mt-3 flex flex-wrap items-center gap-1.5">
              <button
                onClick={() => openImport({ kind: "text", record: r }, "new")}
                className="inline-flex items-center gap-1.5 rounded-lg border border-zinc-200 px-2.5 py-1.5 text-xs font-medium text-zinc-500 transition-colors hover:border-teal-300 hover:text-teal-600"
              >
                <FilePlus2 className="h-3 w-3" />
                导入笔记
              </button>
              <button
                onClick={() => void copyText(r.reply ?? "")}
                className="inline-flex items-center gap-1.5 rounded-lg border border-zinc-200 px-2.5 py-1.5 text-xs font-medium text-zinc-500 transition-colors hover:border-teal-300 hover:text-teal-600"
              >
                <Copy className="h-3 w-3" />
                复制
              </button>
              <button
                onClick={() => void remove(r, "text")}
                disabled={busy === `text:${r.id}`}
                className="inline-flex items-center gap-1.5 rounded-lg border border-zinc-200 px-2.5 py-1.5 text-xs font-medium text-red-500 transition-colors hover:border-red-300 hover:bg-red-50 disabled:opacity-50"
              >
                {busy === `text:${r.id}` ? <Loader2 className="h-3 w-3 animate-spin" /> : <Trash2 className="h-3 w-3" />}
                取消收藏
              </button>
              {r.note_id && (
                <span className="ml-auto text-[11px] text-zinc-400">已导入笔记</span>
              )}
            </div>
          </div>
        )}

        {bottomBar(meta.type, meta.lang)}
      </div>
    );
  }

  function mediaCard(m: MaterialWithNote) {
    const meta = materialMeta(m);
    const key = `m:${m.id}`;
    const open = !collapsed.has(key);
    return (
      <div key={m.id} className="rounded-2xl border border-zinc-200 bg-white">
        <button
          onClick={() => toggleCollapse(key)}
          className="flex w-full items-center gap-3 p-3 text-left"
          title="点击展开 / 收起操作"
        >
          <MediaThumb material={m} />
          <span className="min-w-0 flex-1">
            <span className="block truncate text-sm font-medium text-zinc-900">
              {m.title || m.url}
            </span>
            <span className="mt-0.5 block truncate text-[11px] text-zinc-400">
              {m.note_title ? `已导入「${m.note_title}」` : m.source || m.url}
            </span>
          </span>
          <ChevronDown
            className={`h-4 w-4 shrink-0 text-zinc-400 transition-transform ${open ? "" : "rotate-180"}`}
          />
        </button>

        {open && (
          <div className="flex flex-wrap items-center gap-1.5 px-3 pb-3">
            <Link
              href={`/materials/${m.id}`}
              className="inline-flex items-center gap-1.5 rounded-lg border border-zinc-200 px-2.5 py-1.5 text-xs font-medium text-zinc-500 transition-colors hover:border-teal-300 hover:text-teal-600"
            >
              <Play className="h-3 w-3" />
              观看
            </Link>
            {m.note_id ? (
              <span className="inline-flex items-center gap-1.5 rounded-lg bg-emerald-50 px-2.5 py-1.5 text-xs font-medium text-emerald-600">
                <FilePlus2 className="h-3 w-3" />
                已导入
              </span>
            ) : (
              <button
                onClick={() => openImport({ kind: "media", material: m }, "new")}
                className="inline-flex items-center gap-1.5 rounded-lg border border-zinc-200 px-2.5 py-1.5 text-xs font-medium text-zinc-500 transition-colors hover:border-teal-300 hover:text-teal-600"
              >
                <FilePlus2 className="h-3 w-3" />
                导入笔记
              </button>
            )}
            <button
              onClick={() => void remove(m, "media")}
              disabled={busy === `media:${m.id}`}
              className="inline-flex items-center gap-1.5 rounded-lg border border-zinc-200 px-2.5 py-1.5 text-xs font-medium text-red-500 transition-colors hover:border-red-300 hover:bg-red-50 disabled:opacity-50"
            >
              {busy === `media:${m.id}` ? <Loader2 className="h-3 w-3 animate-spin" /> : <Trash2 className="h-3 w-3" />}
              取消收藏
            </button>
          </div>
        )}

        {bottomBar(meta.type, meta.lang)}
      </div>
    );
  }
  const hasActiveFilter = langFilter || typeFilter;
  const iconBtn =
    "inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-lg text-zinc-500 transition-colors hover:bg-zinc-100 hover:text-zinc-700";

  return (
    <div>
      <header className="page-header mb-4 flex items-center gap-2">
        <BackButton
          fallback="/companion"
          className="rounded-lg p-1.5 text-zinc-500 transition-colors hover:bg-zinc-100 hover:text-zinc-900"
        />
        <h1 className="min-w-0 flex-1 truncate text-2xl font-bold text-zinc-900">收藏夹</h1>
        <button
          onClick={() => {
            setSearchOpen((v) => !v);
            setDone(null);
          }}
          className={iconBtn}
          aria-label="搜索收藏"
          title="搜索收藏"
        >
          <Search className="h-5 w-5" />
        </button>
        <button
          onClick={() => setFilterOpen((v) => !v)}
          className={`${iconBtn} ${hasActiveFilter ? "text-teal-600" : ""}`}
          aria-label="筛选"
          title="按语言 / 类型筛选"
        >
          <SlidersHorizontal className="h-5 w-5" />
        </button>
        <button
          onClick={() => {
            setImportOpen((v) => !v);
            setDone(null);
          }}
          className={iconBtn}
          aria-label="导入媒体"
          title="导入媒体（自动识别标题 / 频道 / 类型 / 语言）"
        >
          <Plus className="h-5 w-5" />
        </button>
      </header>

      {/* 收藏统计：提醒一共收藏了多少条（文字 + 素材） */}
      <p className="mb-3 text-xs text-zinc-400">
        共收藏 {totalCount} 条 · 文字 {records.length} · 素材 {materials.length}
      </p>

      {error && <p className="mb-2 text-sm text-red-600">{error}</p>}
      {done && <p className="mb-2 text-sm text-teal-600">{done}</p>}

      {/* 搜索框（点击标题栏搜索图标后展开） */}
      {searchOpen && (
        <div className="mb-3 flex items-center gap-2 rounded-lg border border-zinc-200 bg-zinc-50 px-3 py-2.5">
          <Search className="h-4 w-4 shrink-0 text-zinc-400" />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="搜索提问、回复或素材标题…"
            autoFocus
            className="min-w-0 flex-1 bg-transparent text-sm text-zinc-800 placeholder-zinc-400 focus:outline-none placeholder:text-sm"
          />
          {query && (
            <button
              onClick={() => setQuery("")}
              className="text-xs text-zinc-400 hover:text-zinc-600"
              aria-label="清空搜索"
            >
              ✕
            </button>
          )}
        </div>
      )}

      {/* 筛选面板（语言 + 类型） */}
      {filterOpen && (
        <div className="mb-3 space-y-2 rounded-xl border border-zinc-200 bg-zinc-50 p-3">
          <div className="flex items-center justify-between">
            <span className="text-xs text-zinc-400">筛选</span>
            <button onClick={clearFilters} className="text-xs text-teal-600 hover:text-teal-700">
              清除筛选
            </button>
          </div>
          <div className="flex flex-wrap gap-1.5">
            {presentLangs.length === 0 ? (
              <span className="text-xs text-zinc-400">暂无内容</span>
            ) : (
              <>
                <button
                  onClick={() => setLangFilter(null)}
                  className={`rounded-full px-3 py-1.5 text-xs font-medium transition-colors ${
                    !langFilter ? "bg-zinc-800 text-white" : "border border-zinc-200 text-zinc-500"
                  }`}
                >
                  全部
                </button>
                {presentLangs.map((l) => (
                  <button
                    key={l}
                    onClick={() => setLangFilter(langFilter === l ? null : l)}
                    className={`rounded-full px-3 py-1.5 text-xs font-medium transition-colors ${
                      langFilter === l
                        ? "bg-teal-600 text-white"
                        : "border border-zinc-200 text-zinc-500 hover:bg-zinc-100"
                    }`}
                  >
                    {langLabel(l)}
                  </button>
                ))}
              </>
            )}
          </div>
          <div className="mt-2 space-y-1">
            {presentTypes.length === 0 ? (
              <span className="text-xs text-zinc-400">暂无内容</span>
            ) : (
              <div className="flex flex-wrap gap-1.5">
                <button
                  onClick={() => setTypeFilter(null)}
                  className={`rounded-full px-3 py-1.5 text-xs font-medium transition-colors ${
                    !typeFilter ? "bg-zinc-800 text-white" : "border border-zinc-200 text-zinc-500"
                  }`}
                >
                  全部
                </button>
                {presentTypes.map((t) => (
                  <button
                    key={t}
                    onClick={() => setTypeFilter(typeFilter === t ? null : t)}
                    className={`rounded-full px-3 py-1.5 text-xs font-medium transition-colors ${
                      typeFilter === t
                        ? "bg-teal-600 text-white"
                        : "border border-zinc-200 text-zinc-500 hover:bg-zinc-100"
                    }`}
                  >
                    {t}
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>
      )}

      {/* 导入媒体：复用素材库「收藏素材」面板（自动识别标题 / 来源 / 类型 / 语言，可改） */}
      {importOpen && <AddMaterialPanel collections={[]} hideCollection onClose={() => setImportOpen(false)} />}

      {isEmpty ? (
        <p className="py-12 text-center text-sm text-zinc-400">
          {totalCount === 0 ? "还没有收藏。" : "没有匹配的收藏。"}
        </p>
      ) : (
        <div className="space-y-3">
          {filteredItems.map((it) =>
            it.kind === "text" ? textCard(it.record) : mediaCard(it.material)
          )}
        </div>
      )}

      {/* ===== 导入到笔记弹窗 ===== */}
      {imp && (
        <div
          className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 sm:items-center"
          onClick={() => setImp(null)}
        >
          <div
            className="w-full max-w-md rounded-t-3xl bg-white p-5 shadow-xl sm:rounded-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="mb-3 flex items-center justify-between">
              <p className="text-base font-semibold text-zinc-900">导入到笔记</p>
              <button
                onClick={() => setImp(null)}
                aria-label="关闭"
                className="rounded-lg p-1.5 text-zinc-400 transition-colors hover:bg-zinc-100 hover:text-zinc-600"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
            <div className="mb-3 flex gap-0.5 rounded-xl bg-black/[0.05] p-1">
              <button
                onClick={() => void switchMode("new")}
                className={`flex-1 rounded-lg px-3 py-2 text-sm font-medium transition-all ${
                  imp.mode === "new" ? "bg-white text-teal-700 shadow-sm" : "text-zinc-500"
                }`}
              >
                新建笔记
              </button>
              <button
                onClick={() => void switchMode("existing")}
                className={`flex-1 rounded-lg px-3 py-2 text-sm font-medium transition-all ${
                  imp.mode === "existing" ? "bg-white text-teal-700 shadow-sm" : "text-zinc-500"
                }`}
              >
                选已有笔记
              </button>
            </div>

            {imp.mode === "new" ? (
              <p className="mb-3 text-xs text-zinc-400">将新建一篇笔记收录这条收藏。</p>
            ) : (
              <>
                <input
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  placeholder="搜索笔记…"
                  autoFocus
                  className="mb-2 w-full rounded-lg border border-zinc-200 px-3 py-2.5 text-sm text-zinc-800 focus:border-teal-500 focus:outline-none placeholder:text-sm"
                />
                <div className="max-h-48 space-y-1 overflow-y-auto">
                  {loadingNotes ? (
                    <p className="py-3 text-center text-sm text-zinc-400">加载中…</p>
                  ) : filteredNotes.length === 0 ? (
                    <p className="py-3 text-center text-sm text-zinc-400">没有匹配的笔记</p>
                  ) : (
                    filteredNotes.map((n) => (
                      <button
                        key={n.id}
                        onClick={() => void doImport(n.id)}
                        disabled={busy !== null}
                        className="block w-full truncate rounded-lg border border-zinc-200 px-3 py-2.5 text-left text-sm text-zinc-700 transition-colors hover:border-teal-300"
                      >
                        {n.title}
                      </button>
                    ))
                  )}
                </div>
              </>
            )}

            {imp.mode === "new" && (
              <button
                onClick={() => void doImport(null)}
                disabled={busy !== null}
                className="mt-2 w-full rounded-lg bg-teal-600 px-3 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-teal-700 disabled:opacity-50"
              >
                {busy !== null ? "导入中…" : "新建并导入"}
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

/** 媒体收藏缩略图：有图用图，无图按类型给渐变占位 + 图标。 */
function MediaThumb({ material }: { material: MaterialWithNote }) {
  const isVideo = material.type === "youtube";
  const Icon = isVideo ? Film : material.type === "spotify" ? Music : MessageSquare;
  if (material.thumbnail) {
    return (
      <img
        src={material.thumbnail}
        alt={material.title || "素材"}
        className="h-16 w-16 shrink-0 rounded-lg object-cover"
      />
    );
  }
  return (
    <span className="flex h-16 w-16 shrink-0 items-center justify-center rounded-lg bg-gradient-to-br from-teal-500 to-cyan-500 text-white">
      <Icon className="h-6 w-6" />
    </span>
  );
}
