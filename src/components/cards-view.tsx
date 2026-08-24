"use client";

import { useMemo, useState, type ReactNode } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { NoteCards } from "./note-cards";
import { createClient, detachMaterialsFromNote } from "@/lib/supabase/client";
import { exportCardsCsv } from "@/lib/export-data";
import {
  Download,
  BookMarked,
  Folder,
  Layers,
  Inbox,
  ChevronDown,
  MoreHorizontal,
  Pencil,
  Trash2,
  Check,
  X,
  Search,
} from "lucide-react";
import { cardLang, LANG_LABEL, LANG_COLOR, type Lang } from "@/lib/lang-detect";
import type { Card, CardFolderGroup } from "@/lib/types";

const LANG_ORDER: Lang[] = ["thai", "korean", "chinese", "japanese", "other"];

/** 一个「闪卡合集」：某篇笔记（含闪卡文件）下的全部卡，附上它所在的文件夹 + 主要语言。 */
type Collection = {
  noteId: string;
  title: string;
  count: number;
  sourceType: string | null;
  folderId: string | null;
  folderName: string | null;
  lang: Lang;
};

/**
 * 卡片页主体：顶部筛选标签（全部 / 独立闪卡 / 笔记闪卡），
 * 下面是平铺的「闪卡合集」卡片（不再用文件夹折叠树，来源文件夹用一个小注释标在卡片上）。
 * - 独立闪卡 = 闪卡文件（source_type='cards'，📇）+ 不挂任何笔记的孤儿卡。
 * - 笔记闪卡 = 普通笔记（source_type=null）转成的卡。
 */
export function CardsView({
  groups,
  orphans,
  actions,
}: {
  groups: CardFolderGroup[];
  orphans: Card[];
  /** 视图级操作按钮（导出全部 / 添加闪卡），排在搜索框下面、语言标签上面。 */
  actions?: ReactNode;
}) {
  const [query, setQuery] = useState("");
  const [langFilter, setLangFilter] = useState<Lang | "all">("all");
  const [orphanOpen, setOrphanOpen] = useState(false);
  const [batchMode, setBatchMode] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const router = useRouter();

  // 把「文件夹 → 笔记」摊平成一张张合集卡片，文件夹信息作为来源注释带下来。
  const collections = useMemo<Collection[]>(
    () =>
      groups.flatMap((g) =>
        g.notes.map((n) => ({
          noteId: n.noteId,
          title: n.title,
          count: n.count,
          sourceType: n.sourceType,
          folderId: g.folderId,
          folderName: g.folderId ? g.folderName : null,
          lang: (n.lang ?? "other") as Lang,
        }))
      ),
    [groups]
  );

  // 搜索：按合集标题 / 孤儿卡正反面文字过滤（不区分大小写）。
  const q = query.trim().toLowerCase();
  const byLang = (c: Collection) => langFilter === "all" || c.lang === langFilter;
  const visibleCollections = collections.filter(
    (c) => byLang(c) && (!q || c.title.toLowerCase().includes(q))
  );

  // 孤儿卡（note_id 为空）单独一块；同样受语言 + 搜索筛选。
  const visibleOrphans = orphans.filter(
    (o) =>
      (langFilter === "all" || cardLang(o) === langFilter) &&
      (!q ||
        o.front.toLowerCase().includes(q) ||
        (o.back ?? "").toLowerCase().includes(q))
  );

  // 顶部语言 chip：按实际出现的语言自动生成（跟词群页一致）。
  const presentLangs = useMemo(() => {
    const s = new Set<Lang>();
    for (const c of collections) s.add(c.lang);
    for (const o of orphans) s.add(cardLang(o));
    return LANG_ORDER.filter((l) => s.has(l));
  }, [collections, orphans]);

  const empty = visibleCollections.length === 0 && visibleOrphans.length === 0;

  // 批量操作（仅作用于「合集」卡片，独立闪卡块不参与）。
  const allSelected =
    visibleCollections.length > 0 && visibleCollections.every((c) => selected.has(c.noteId));

  function toggleSelect(noteId: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(noteId)) next.delete(noteId);
      else next.add(noteId);
      return next;
    });
  }

  function toggleSelectAll() {
    setSelected(allSelected ? new Set() : new Set(visibleCollections.map((c) => c.noteId)));
  }

  function toggleBatch() {
    setBatchMode((v) => {
      if (v) setSelected(new Set());
      return !v;
    });
  }

  async function batchDelete() {
    if (selected.size === 0) return;
    if (
      !window.confirm(
        `删除所选 ${selected.size} 个合集里的闪卡？闪卡文件会连笔记一起删，普通笔记只删卡、正文保留。此操作不可恢复。`
      )
    ) {
      return;
    }
    const supabase = createClient();
    for (const noteId of selected) {
      const c = collections.find((col) => col.noteId === noteId);
      if (!c) continue;
      if (c.sourceType === "cards") {
        await detachMaterialsFromNote(noteId);
        await supabase.from("notes").delete().eq("id", noteId);
      } else {
        await supabase.from("cards").delete().eq("note_id", noteId);
      }
    }
    setSelected(new Set());
    setBatchMode(false);
    router.refresh();
  }

  return (
    <div>
      {/* 搜索 + 操作按钮：手机端上下堆叠，桌面端同一行（搜索左、按钮右） */}
      <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="relative w-full sm:max-w-md">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-zinc-400" />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="搜索合集 / 词…"
            className="w-full rounded-xl border border-zinc-200 bg-white py-2 pl-9 pr-3 text-sm focus:border-teal-500 focus:outline-none"
          />
        </div>
        {actions && (
          <div className="flex flex-wrap items-center gap-1.5">{actions}</div>
        )}
      </div>

      <div className="mb-5 flex flex-wrap items-center gap-2">
        <button
          onClick={() => setLangFilter("all")}
          className={`rounded-full px-3 py-1 text-xs font-medium transition-colors ${
            langFilter === "all"
              ? "bg-teal-600 text-white"
              : "border border-zinc-200 text-zinc-500 hover:bg-zinc-50"
          }`}
        >
          全部语言
        </button>
        {presentLangs.map((l) => (
          <button
            key={l}
            onClick={() => setLangFilter(l)}
            className={`rounded-full px-3 py-1 text-xs font-medium transition-colors ${
              langFilter === l
                ? "bg-teal-600 text-white"
                : `${LANG_COLOR[l]} border border-transparent hover:opacity-80`
            }`}
          >
            {LANG_LABEL[l]}
          </button>
        ))}
        <button
          onClick={toggleBatch}
          className={`ml-auto text-xs font-medium transition-colors ${
            batchMode ? "text-teal-600" : "text-zinc-400 hover:text-teal-600"
          }`}
        >
          {batchMode ? "退出批量" : "批量操作"}
        </button>
      </div>

      {/* 批量操作栏（批量模式才显示）：全选 + 删除所选 + 完成 */}
      {batchMode && (
        <div className="mb-4 flex items-center justify-between rounded-xl border border-zinc-200 bg-white px-4 py-2.5 shadow-sm">
          <div className="flex items-center gap-3">
            <button
              onClick={toggleSelectAll}
              className="text-sm font-medium text-teal-600 transition-colors hover:underline"
            >
              {allSelected ? "取消全选" : "全选"}
            </button>
            <span className="text-sm text-zinc-500">已选 {selected.size} 个合集</span>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={batchDelete}
              disabled={selected.size === 0}
              className="inline-flex items-center gap-1 rounded-lg border border-red-200 px-3 py-1.5 text-sm font-medium text-red-600 transition-colors hover:bg-red-50 disabled:opacity-50"
            >
              <Trash2 className="h-4 w-4" />
              删除所选
            </button>
            <button
              onClick={toggleBatch}
              className="rounded-lg px-3 py-1.5 text-sm text-zinc-500 transition-colors hover:bg-zinc-100"
            >
              完成
            </button>
          </div>
        </div>
      )}

      {empty ? (
        <div className="rounded-xl border border-dashed border-zinc-300 px-4 py-10 text-center text-sm text-zinc-500">
          {q ? "没有匹配的合集或词。" : "还没有闪卡。"}
        </div>
      ) : (
        <div className="space-y-8">
          {/* 闪卡合集（卡片网格）。独立闪卡也作为一个合集块，点一下展开。 */}
          {(visibleCollections.length > 0 ||
            (visibleOrphans.length > 0)) && (
            <ul className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {!batchMode && visibleOrphans.length > 0 && (
                <li>
                  <div
                    className={`flex h-full flex-col rounded-2xl border bg-white transition-colors ${
                      orphanOpen
                        ? "border-teal-300 shadow-sm"
                        : "border-zinc-200 hover:border-teal-300 hover:shadow-sm"
                    }`}
                  >
                    <button
                      onClick={() => setOrphanOpen((v) => !v)}
                      className="flex flex-col p-4 text-left"
                    >
                      <div className="flex items-center gap-2.5">
                        <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-teal-50">
                          <Layers className="h-4 w-4 text-teal-600" />
                        </span>
                        <span className="min-w-0 flex-1 truncate text-sm font-medium leading-snug text-zinc-800">
                          独立闪卡
                        </span>
                        <span className="shrink-0 rounded-full bg-teal-50 px-2 py-0.5 text-xs font-medium text-teal-600">
                          {visibleOrphans.length} 张
                        </span>
                        <ChevronDown
                          className={`h-4 w-4 shrink-0 text-zinc-400 transition-transform ${
                            orphanOpen ? "rotate-180" : ""
                          }`}
                        />
                      </div>
                      {/* 来源标注：外部添加（区别于笔记合集下面的文件夹来源） */}
                      <p className="mt-2 flex items-center gap-1 pl-11 text-xs text-zinc-400">
                        <Inbox className="h-3.5 w-3.5" />
                        <span>外部添加</span>
                      </p>
                    </button>
                    <div className="flex items-center justify-end border-t border-zinc-100 px-3 py-1.5">
                      <OrphanMenu
                        count={visibleOrphans.length}
                        ids={visibleOrphans.map((o) => o.id)}
                      />
                    </div>
                  </div>
                </li>
              )}

              {visibleCollections.map((c) => (
                <CollectionCard
                  key={c.noteId}
                  c={c}
                  batchMode={batchMode}
                  selected={selected.has(c.noteId)}
                  onToggle={() => toggleSelect(c.noteId)}
                />
              ))}
            </ul>
          )}

          {/* 独立闪卡展开后的卡片列表 */}
          {visibleOrphans.length > 0 && orphanOpen && (
            <NoteCards cards={visibleOrphans} />
          )}
        </div>
      )}
    </div>
  );
}

/** 导出单个闪卡合集（某篇笔记 / 闪卡文件下的所有卡）为 CSV。 */
function CollectionExportButton({ noteId, title }: { noteId: string; title: string }) {
  const [busy, setBusy] = useState(false);

  async function exportOne() {
    setBusy(true);
    try {
      const supabase = createClient();
      const { data } = await supabase
        .from("cards")
        .select("*")
        .eq("note_id", noteId)
        .order("created_at", { ascending: true });
      exportCardsCsv((data ?? []) as Card[], `${title || "未命名"}.csv`);
    } finally {
      setBusy(false);
    }
  }

  return (
    <button
      onClick={exportOne}
      disabled={busy}
      className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-xs text-zinc-500 transition-colors hover:bg-zinc-100 hover:text-zinc-800 disabled:opacity-60"
    >
      <Download className="h-3.5 w-3.5" />
      {busy ? "导出中…" : "导出"}
    </button>
  );
}

/** 一个闪卡合集卡片：标题可点进卡片列表，右下角「⋯」菜单支持重命名 / 删除。批量模式下整卡可勾选。 */
function CollectionCard({
  c,
  batchMode,
  selected,
  onToggle,
}: {
  c: Collection;
  batchMode?: boolean;
  selected?: boolean;
  onToggle?: () => void;
}) {
  const router = useRouter();
  const [menuOpen, setMenuOpen] = useState(false);
  const [renaming, setRenaming] = useState(false);
  const [name, setName] = useState(c.title);

  async function commitRename() {
    const n = name.trim();
    if (!n) return;
    const supabase = createClient();
    await supabase.from("notes").update({ title: n }).eq("id", c.noteId);
    setRenaming(false);
    setMenuOpen(false);
    router.refresh();
  }

  async function doDelete() {
    const label = c.title || "无标题";
    const isCardFile = c.sourceType === "cards";
    const msg = isCardFile
      ? `删除闪卡文件「${label}」及里面的 ${c.count} 张闪卡？此操作不可恢复。`
      : `删除「${label}」下的 ${c.count} 张闪卡？笔记本身会保留。`;
    if (!window.confirm(msg)) return;
    const supabase = createClient();
    if (isCardFile) {
      // 闪卡文件没有正文，删笔记会级联删掉它的卡和复习状态
      await detachMaterialsFromNote(c.noteId);
      await supabase.from("notes").delete().eq("id", c.noteId);
    } else {
      // 普通笔记：只删卡（级联删复习状态），笔记正文不动
      await supabase.from("cards").delete().eq("note_id", c.noteId);
    }
    setMenuOpen(false);
    router.refresh();
  }

  // 卡片主体（标题 + 数量 + 来源标注），正常态与批量态共用。
  const body = (
    <>
      <div className="flex items-center gap-2.5">
        <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-teal-50">
          {c.sourceType === "cards" ? (
            <Layers className="h-4 w-4 text-teal-600" />
          ) : (
            <BookMarked className="h-4 w-4 text-teal-600" />
          )}
        </span>
        <span className="min-w-0 flex-1 truncate text-sm font-medium leading-snug text-zinc-800">
          {c.title || "无标题"}
        </span>
        <span className="shrink-0 rounded-full bg-teal-50 px-2 py-0.5 text-xs font-medium text-teal-600">
          {c.count} 张
        </span>
      </div>
      {/* 来源标注：有文件夹显示文件夹名，否则标注「笔记添加 / 外部添加」，让每张卡来源统一可辨 */}
      <p className="mt-2 flex items-center gap-1 pl-11 text-xs text-zinc-400">
        {c.folderName ? (
          <>
            <Folder className="h-3.5 w-3.5 shrink-0" />
            <span className="truncate">{c.folderName}</span>
          </>
        ) : c.sourceType === "cards" ? (
          <>
            <Inbox className="h-3.5 w-3.5 shrink-0" />
            <span>外部添加</span>
          </>
        ) : (
          <>
            <BookMarked className="h-3.5 w-3.5 shrink-0" />
            <span>笔记添加</span>
          </>
        )}
      </p>
    </>
  );

  return (
    <li>
      <div className="flex h-full flex-col rounded-2xl border border-zinc-200 bg-white transition-colors hover:border-teal-300 hover:shadow-sm">
        {batchMode ? (
          <button
            type="button"
            onClick={onToggle}
            className="relative flex flex-1 flex-col p-4 text-left"
          >
            {body}
            <span
              className={`absolute right-3 top-3 flex h-5 w-5 items-center justify-center rounded-full border transition-colors ${
                selected
                  ? "border-teal-600 bg-teal-600 text-white"
                  : "border-zinc-300 bg-white text-transparent"
              }`}
            >
              <Check className="h-3.5 w-3.5" />
            </span>
          </button>
        ) : renaming ? (
          <div className="flex items-center gap-1.5 p-4">
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              autoFocus
              onKeyDown={(e) => {
                if (e.key === "Enter") commitRename();
                if (e.key === "Escape") setRenaming(false);
              }}
              className="min-w-0 flex-1 rounded-lg border border-teal-300 px-2 py-1 text-sm font-medium text-zinc-800 focus:outline-none"
            />
            <button
              onClick={commitRename}
              className="rounded-lg p-1.5 text-teal-600 hover:bg-teal-50"
              aria-label="保存"
            >
              <Check className="h-4 w-4" />
            </button>
            <button
              onClick={() => setRenaming(false)}
              className="rounded-lg p-1.5 text-zinc-400 hover:bg-zinc-100"
              aria-label="取消"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
        ) : (
          <Link href={`/notes/${c.noteId}/cards`} className="flex flex-col p-4">
            {body}
          </Link>
        )}
        {/* 底部：左侧「⋯」菜单，右侧导出（批量模式隐藏，整卡用于勾选） */}
        {!batchMode && (
          <div className="flex items-center justify-between border-t border-zinc-100 px-3 py-1.5">
          <div className="relative">
            <button
              onClick={() => setMenuOpen((v) => !v)}
              className="rounded-md p-1.5 text-zinc-400 transition-colors hover:bg-zinc-100 hover:text-zinc-700"
              aria-label="更多操作"
            >
              <MoreHorizontal className="h-4 w-4" />
            </button>
            {menuOpen && (
              <>
                <button
                  className="fixed inset-0 z-10 cursor-default"
                  onClick={() => setMenuOpen(false)}
                  aria-label="关闭菜单"
                />
                <div className="absolute bottom-full left-0 z-20 mb-1 w-32 overflow-hidden rounded-lg border border-zinc-200 bg-white py-1 shadow-lg">
                  <button
                    onClick={() => {
                      setRenaming(true);
                      setMenuOpen(false);
                    }}
                    className="flex w-full items-center gap-2 px-3 py-1.5 text-sm text-zinc-700 hover:bg-zinc-50"
                  >
                    <Pencil className="h-3.5 w-3.5" /> 重命名
                  </button>
                  <button
                    onClick={doDelete}
                    className="flex w-full items-center gap-2 px-3 py-1.5 text-sm text-red-600 hover:bg-red-50"
                  >
                    <Trash2 className="h-3.5 w-3.5" /> 删除
                  </button>
                </div>
              </>
            )}
          </div>
          <CollectionExportButton noteId={c.noteId} title={c.title} />
          </div>
        )}
      </div>
    </li>
  );
}

/** 独立闪卡（孤儿卡）块的「⋯」菜单：重命名 = 转成一个有名字的闪卡文件；删除 = 清空。 */
function OrphanMenu({ count, ids }: { count: number; ids: string[] }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);

  async function rename() {
    const n = window.prompt("给这些独立闪卡起个名字（会转成一个闪卡文件）：");
    if (!n?.trim()) return;
    const supabase = createClient();
    const { data: note, error } = await supabase
      .from("notes")
      .insert({ title: n.trim(), source_type: "cards" })
      .select("id")
      .single();
    if (error || !note) {
      window.alert(error?.message ?? "创建闪卡文件失败。");
      return;
    }
    // 只转当前「可见 ∧ 选中过滤的那批」孤儿卡，不能把语言/搜索过滤外的也一起转走。
    await supabase.from("cards").update({ note_id: note.id }).in("id", ids);
    setOpen(false);
    router.refresh();
  }

  async function remove() {
    if (!window.confirm(`删除这 ${count} 张独立闪卡？此操作不可恢复。`)) return;
    const supabase = createClient();
    await supabase.from("cards").delete().in("id", ids);
    setOpen(false);
    router.refresh();
  }

  return (
    <div className="relative">
      <button
        onClick={() => setOpen((v) => !v)}
        className="rounded-md p-1.5 text-zinc-400 transition-colors hover:bg-zinc-100 hover:text-zinc-700"
        aria-label="更多操作"
      >
        <MoreHorizontal className="h-4 w-4" />
      </button>
      {open && (
        <>
          <button
            className="fixed inset-0 z-10 cursor-default"
            onClick={() => setOpen(false)}
            aria-label="关闭菜单"
          />
          <div className="absolute bottom-full right-0 z-20 mb-1 w-32 overflow-hidden rounded-lg border border-zinc-200 bg-white py-1 shadow-lg">
            <button
              onClick={rename}
              className="flex w-full items-center gap-2 px-3 py-1.5 text-sm text-zinc-700 hover:bg-zinc-50"
            >
              <Pencil className="h-3.5 w-3.5" /> 重命名
            </button>
            <button
              onClick={remove}
              className="flex w-full items-center gap-2 px-3 py-1.5 text-sm text-red-600 hover:bg-red-50"
            >
              <Trash2 className="h-3.5 w-3.5" /> 删除
            </button>
          </div>
        </>
      )}
    </div>
  );
}
