"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { NoteCards } from "./note-cards";
import { createClient, detachMaterialsFromNote } from "@/lib/supabase/client";
import { exportCardsCsv } from "@/lib/export-data";
import { AddCardsModal } from "./add-cards-button";
import { BackButton } from "./back-button";
import { EmptyState } from "./empty-state";
import {
  BookMarked,
  Layers,
  Inbox,
  ChevronDown,
  MoreHorizontal,
  Pencil,
  Trash2,
  Check,
  X,
  Search,
  Plus,
} from "lucide-react";
import { RowMenu } from "./row-menu";
import { cardLang, LANG_ORDER, LANG_LABEL, LANG_COLOR, type Lang } from "@/lib/lang-detect";
import type { Card, CardFolderGroup } from "@/lib/types";

/** 一个「闪卡合集」：某篇笔记（含闪卡文件）下的全部卡，附上它所在的文件夹 + 主要语言。 */
type Collection = {
  noteId: string;
  title: string;
  count: number;
  sourceType: string | null;
  folderId: string | null;
  folderName: string | null;
  lang: Lang;
  due: number;
};

/**
 * 卡片页主体：顶部标题（返回 + 闪卡 + 右侧小「添加」按钮），
 * 下面是平铺的「闪卡合集」卡片（不再用文件夹折叠树，来源文件夹用一个小注释标在卡片上）。
 * - 独立闪卡 = 闪卡文件（source_type='cards'，📇）+ 不挂任何笔记的孤儿卡。
 * - 笔记闪卡 = 普通笔记（source_type=null）转成的卡。
 */
export function CardsView({
  groups,
  orphans,
  sourceError = null,
}: {
  groups: CardFolderGroup[];
  orphans: Card[];
  sourceError?: string | null;
}) {
  const [query, setQuery] = useState("");
  const [langFilter, setLangFilter] = useState<Lang | "all">("all");
  const [orphanOpen, setOrphanOpen] = useState(false);
  const [addOpen, setAddOpen] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  const [showAll, setShowAll] = useState(false);
  const router = useRouter();

  // 合集列表默认只展示前几张，其余收进「查看更多」。
  const COLLECTION_LIMIT = 6;

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
          due: n.due,
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
  const shownCollections = showAll
    ? visibleCollections
    : visibleCollections.slice(0, COLLECTION_LIMIT);

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
  // 库里是否真的一张都没有（不受搜索 / 语言筛选影响）：true 时给「还没有闪卡合集」引导态。
  const hasAny = collections.length > 0 || orphans.length > 0;

  return (
    <div>
      {/* 页头：返回 + 标题（闪卡）+ 右侧「搜索 / 添加」两个图标（更干净） */}
      <header className="page-header mb-5 flex items-center gap-2">
        <BackButton fallback="/review" />
        <h1 className="flex-1 truncate text-2xl font-bold text-zinc-900">闪卡</h1>
        <button
          onClick={() => setSearchOpen((v) => !v)}
          className={`md:hidden inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-lg transition-colors ${
            searchOpen || query
              ? "bg-teal-50 text-teal-600"
              : "text-zinc-500 hover:bg-zinc-100 hover:text-zinc-700"
          }`}
          aria-label="搜索合集 / 词"
          title="搜索合集 / 词"
        >
          <Search className="h-5 w-5" />
        </button>
        <button
          onClick={() => setAddOpen(true)}
          className="md:hidden inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-lg text-zinc-500 transition-colors hover:bg-zinc-100 hover:text-zinc-700"
          aria-label="添加闪卡"
          title="添加闪卡"
        >
          <Plus className="h-5 w-5" />
        </button>
      </header>

      {sourceError && (
        <div className="mb-4 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
          {sourceError}
        </div>
      )}

      {/* 搜索行：搜索框（手机点标题栏放大镜展开 / 网页端常驻，紧贴标题栏搜索按钮下方）+ 右侧「添加」（网页端直出，与笔记内页搜索行统一）。 */}
      <div className="mb-4 flex items-center gap-2">
        <div className={`relative min-w-0 flex-1 ${searchOpen ? "block" : "hidden"} md:block`}>
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-zinc-400" />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="搜索合集 / 词…"
            autoFocus={!!searchOpen}
            className="w-full rounded-xl border border-zinc-200 bg-white py-2.5 pl-9 pr-9 text-sm focus:border-teal-500 focus:outline-none placeholder:text-sm"
          />
          {query && (
            <button
              onClick={() => setQuery("")}
              className="absolute right-3 top-1/2 -translate-y-1/2 text-sm text-zinc-400 hover:text-zinc-600"
              aria-label="清空搜索"
            >
              ✕
            </button>
          )}
        </div>
        <button
          onClick={() => setAddOpen(true)}
          className="hidden shrink-0 items-center gap-1 whitespace-nowrap rounded-lg bg-teal-600 px-3 py-2 text-sm font-semibold text-white transition-colors hover:bg-teal-700 md:inline-flex"
        >
          <Plus className="h-4 w-4" /> 添加
        </button>
      </div>

      {/* 语言筛选：单独一行自由换行（搜索行之下，与合集详情页「生词/例句/语法」筛选区位置统一） */}
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <button
          onClick={() => setLangFilter("all")}
          className={`rounded-full px-3 py-2 text-sm font-medium transition-colors ${
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
            className={`rounded-full px-3 py-2 text-sm font-medium transition-colors ${
              langFilter === l
                ? "bg-teal-600 text-white"
                : `${LANG_COLOR[l]} border border-transparent hover:opacity-80`
            }`}
          >
            {LANG_LABEL[l]}
          </button>
        ))}
      </div>

      {!hasAny ? (
        <EmptyState
          icon={<Layers className="h-10 w-10" />}
          title="还没有闪卡合集"
          description="在笔记里点「⋯ → 转成闪卡」自动生成，或点「添加」导入。"
        />
      ) : empty ? (
        <div className="rounded-xl border border-dashed border-zinc-300 px-4 py-10 text-center text-sm text-zinc-500">
          {q ? "没有匹配的合集或词。" : "还没有闪卡。"}
        </div>
      ) : (
        <div className="space-y-8">
          {/* 闪卡合集（卡片网格）。独立闪卡也作为一个合集块，点一下展开。 */}
          {(visibleCollections.length > 0 || visibleOrphans.length > 0) && (
            <ul className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              {visibleOrphans.length > 0 && (
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

              {shownCollections.map((c) => (
                <CollectionCard key={c.noteId} c={c} />
              ))}
            </ul>
          )}

          {/* 合集多于限定数量时折叠，点开看全部 */}
          {visibleCollections.length > COLLECTION_LIMIT && (
            <div className="text-center">
              <button
                onClick={() => setShowAll((v) => !v)}
                className="rounded-full border border-zinc-200 px-4 py-2 text-sm text-zinc-600 transition-colors hover:bg-zinc-50"
              >
                {showAll ? "收起合集" : `查看更多合集（${visibleCollections.length - COLLECTION_LIMIT}）`}
              </button>
            </div>
          )}

          {/* 独立闪卡展开后的卡片列表 */}
          {visibleOrphans.length > 0 && orphanOpen && (
            <NoteCards cards={visibleOrphans} />
          )}
        </div>
      )}

      {addOpen && <AddCardsModal onClose={() => setAddOpen(false)} />}
    </div>
  );
}

/** 一个闪卡合集卡片：标题可点进卡片列表，右下角「⋯」菜单支持重命名 / 选择语言 / 导出 / 删除。 */
function CollectionCard({ c }: { c: Collection }) {
  const router = useRouter();
  const [renaming, setRenaming] = useState(false);
  const [name, setName] = useState(c.title);
  // 「选择语言」：一键兜底合集全部卡片识别失败的语言，避免逐张改。
  const [settingLang, setSettingLang] = useState(false);
  const [lang, setLang] = useState<Lang>(c.lang);

  async function commitLang() {
    const supabase = createClient();
    await supabase.from("cards").update({ lang }).eq("note_id", c.noteId);
    setSettingLang(false);
    router.refresh();
  }

  async function commitRename() {
    const n = name.trim();
    if (!n) return;
    const supabase = createClient();
    // 纯卡片文件没有独立笔记，改名合集=改名标题；普通笔记改名合集不碰原始笔记标题（写 cards_title）。
    const payload = c.sourceType === "cards" ? { title: n } : { cards_title: n };
    await supabase.from("notes").update(payload).eq("id", c.noteId);
    setRenaming(false);
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
    router.refresh();
  }

  async function doExport() {
    const supabase = createClient();
    const { data } = await supabase
      .from("cards")
      .select("*")
      .eq("note_id", c.noteId)
      .order("created_at", { ascending: true });
    exportCardsCsv((data ?? []) as Card[], `${c.title || "未命名"}.csv`);
  }

  // 点「背」把当前合集记为「正在背的合集」（复习主页据此显示），再进背诵页。
  function startReview() {
    try {
      localStorage.setItem(
        "ln_active_collection",
        JSON.stringify({ key: `${c.noteId}::`, noteId: c.noteId, kind: null, at: Date.now() })
      );
    } catch {
      // localStorage 不可用就忽略，不影响背诵。
    }
  }

  // 「背诵」入口：先记为正在背的合集，再跳背诵页。
  function goReview() {
    startReview();
    router.push(`/review?note=${c.noteId}`);
  }

  // 卡片主体：两行——标题行（图标+标题+语言徽章+⋯ 同一行对齐）+ 待学/张数/背行。
  const body = (
    <>
      {/* 标题行：图标 + 标题 + 语言徽章 + ⋯（同排自然对齐；⋯ 不在 Link 内，点它不触发导航） */}
      <div className="flex items-center gap-2.5">
        <Link href={`/notes/${c.noteId}/cards`} className="flex min-w-0 flex-1 items-center gap-2.5">
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
          <span
            className={`shrink-0 rounded-full px-2 py-0.5 text-[11px] font-medium ${LANG_COLOR[c.lang]}`}
          >
            {LANG_LABEL[c.lang]}
          </span>
        </Link>
        {!settingLang && (
          <RowMenu
            items={[
              { label: "重命名", onClick: () => setRenaming(true) },
              { label: "选择语言", onClick: () => setSettingLang(true) },
              { label: "导出", onClick: doExport },
              { label: "删除", onClick: doDelete, danger: true },
            ]}
          />
        )}
      </div>
      {/* 第二行：待学数 + 张数（左）+ 背按钮（右；无待学时描边弱化） */}
      <div className="mt-3 flex items-center justify-between gap-2.5 pl-11">
        <span className="text-xs text-zinc-400">
          共 {c.count} 张
          {c.due > 0 && <span className="font-medium text-teal-600"> · 待学 {c.due}</span>}
        </span>
        <button
          onClick={goReview}
          className={`shrink-0 rounded-lg px-3 py-1.5 text-sm font-semibold transition-colors ${
            c.due > 0
              ? "bg-teal-600 text-white hover:bg-teal-700"
              : "border border-zinc-200 text-zinc-400 hover:border-teal-300 hover:text-teal-700"
          }`}
        >
          背
        </button>
      </div>
    </>
  );

  return (
    <li>
      <div className="relative flex h-full flex-col rounded-2xl border border-zinc-200 bg-white transition-colors hover:border-teal-300 hover:shadow-sm">
        {renaming ? (
          <div className="flex items-center gap-1.5 p-4">
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              autoFocus
              onKeyDown={(e) => {
                if (e.key === "Enter") commitRename();
                if (e.key === "Escape") setRenaming(false);
              }}
              className="min-w-0 flex-1 rounded-lg border border-teal-300 px-2 py-1.5 text-sm font-medium text-zinc-800 focus:outline-none"
            />
            <button
              onClick={commitRename}
              className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-lg text-teal-600 hover:bg-teal-50"
              aria-label="保存"
            >
              <Check className="h-5 w-5" />
            </button>
            <button
              onClick={() => setRenaming(false)}
              className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-lg text-zinc-400 hover:bg-zinc-100"
              aria-label="取消"
            >
              <X className="h-5 w-5" />
            </button>
          </div>
        ) : (
          <>
            <div className="flex flex-col p-4 pb-4">{body}</div>
          </>
        )}
        {/* 「选择语言」激活时，底部临时换成语言下拉 + 保存/取消 */}
        {settingLang && (
          <div className="flex items-center gap-2 border-t border-zinc-100 px-3 py-2">
            <select
              value={lang}
              onChange={(e) => setLang(e.target.value as Lang)}
              className="min-w-0 flex-1 rounded-lg border border-zinc-200 bg-white px-2 py-1 text-xs text-zinc-600 focus:border-teal-500 focus:outline-none"
            >
              {LANG_ORDER.map((l) => (
                <option key={l} value={l}>
                  {LANG_LABEL[l]}
                </option>
              ))}
            </select>
            <button
              onClick={commitLang}
              className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-lg text-teal-600 hover:bg-teal-50"
              aria-label="保存语言"
            >
              <Check className="h-5 w-5" />
            </button>
            <button
              onClick={() => setSettingLang(false)}
              className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-lg text-zinc-400 hover:bg-zinc-100"
              aria-label="取消"
            >
              <X className="h-5 w-5" />
            </button>
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
        className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-md text-zinc-400 transition-colors hover:bg-zinc-100 hover:text-zinc-700"
        aria-label="更多操作"
      >
        <MoreHorizontal className="h-5 w-5" />
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
              className="flex w-full items-center gap-2 px-3 py-2 text-sm text-zinc-700 hover:bg-zinc-50"
            >
              <Pencil className="h-3.5 w-3.5" /> 重命名
            </button>
            <button
              onClick={remove}
              className="flex w-full items-center gap-2 px-3 py-2 text-sm text-red-600 hover:bg-red-50"
            >
              <Trash2 className="h-3.5 w-3.5" /> 删除
            </button>
          </div>
        </>
      )}
    </div>
  );
}
