"use client";

import { useMemo, useRef, useState } from "react";
import type { Dispatch, SetStateAction } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { Search, FolderPlus, Folder, FileText, LayoutList, LayoutGrid, ChevronRight, Pin, Layers, ArrowUp, ArrowDown } from "lucide-react";
import { FolderPickerSheet } from "./folder-picker-sheet";
import { BottomSheet } from "./bottom-sheet";
import { createClient, detachMaterialsFromNote } from "@/lib/supabase/client";
import { flattenFolderTree, folderTree, folderNoteTotals } from "@/lib/folders";
import { useNotesView, type NotesView } from "@/lib/notes-view";
import { EmptyState } from "./empty-state";
import { NewNoteButton } from "./new-note-button";
import { formatNoteDate } from "@/lib/format-note-date";
import type { Folder as FolderType, Note } from "@/lib/types";

/**
 * 笔记 + 文件夹合并视图：以「文件夹」和「笔记文件」为主。
 * - 没文件夹的笔记直接列出来，不套「未分类」。
 * - 文件夹点一下展开/折叠，右侧「⋯」菜单里重命名 / 删除。
 * - 顶部一行：搜索框 + 新建笔记 / 新建文件夹两个图标按钮。
 * - 搜索命中会在标题和正文里高亮定位。
 */
export function NotesBrowser({
  folders,
  notes,
  queryError,
}: {
  folders: FolderType[];
  notes: Note[];
  /** 整页查询失败（listFolders/listNotes 抛错）时由 page 传入，在内容区顶部展示。 */
  queryError?: string | null;
}) {
  const router = useRouter();
  const [query, setQuery] = useState("");
  const [showNewFolder, setShowNewFolder] = useState(false);
  const [folderName, setFolderName] = useState("");
  const [newFolderParentId, setNewFolderParentId] = useState<string | null>(null);
  const [menuFolderId, setMenuFolderId] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editingName, setEditingName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const bodyRef = useRef<HTMLDivElement>(null);

  const q = query.trim().toLowerCase();
  const matches = (n: Note) =>
    !q ||
    n.title.toLowerCase().includes(q) ||
    (n.content_text ?? "").toLowerCase().includes(q);

  const noteCountByFolder = useMemo(() => {
    const m = new Map<string, number>();
    for (const n of notes) {
      if (n.folder_id) m.set(n.folder_id, (m.get(n.folder_id) ?? 0) + 1);
    }
    return m;
  }, [notes]);

  // 搜索时在整个库（含文件夹内笔记）里挑命中的，平铺展示结果。
  const searchNotes = notes.filter(matches);
  const flatFolders = useMemo(() => flattenFolderTree(folders), [folders]);
  // 无搜索时用「可折叠树」：roots 顶层，folderChildren 父 id → 直接子夹；计数用递归总数（含次级）。
  const { roots, children: folderChildren } = useMemo(() => folderTree(folders), [folders]);
  const totals = useMemo(
    () => folderNoteTotals(folders, noteCountByFolder),
    [folders, noteCountByFolder]
  );
  // 搜索时平铺显示命中的文件夹名（不保留层级缩进、不带 toggle 箭头）。
  const matchedFlatFolders = useMemo(
    () => flatFolders.filter(({ folder }) => folder.name.toLowerCase().includes(q)),
    [flatFolders, q]
  );

  async function createFolder() {
    const name = folderName.trim();
    if (!name) return;
    setBusy(true);
    setError(null);
    const supabase = createClient();
    const { error } = await supabase
      .from("folders")
      .insert({ name, parent_id: newFolderParentId });
    setBusy(false);
    if (error) {
      setError(error.message);
      return;
    }
    setFolderName("");
    setShowNewFolder(false);
    setNewFolderParentId(null);
    router.refresh();
  }

  async function saveEdit(id: string) {
    const name = editingName.trim();
    if (!name) return;
    setError(null);
    const supabase = createClient();
    const { error } = await supabase.from("folders").update({ name }).eq("id", id);
    if (error) {
      setError(error.message);
      return;
    }
    setEditingId(null);
    setMenuFolderId(null);
    router.refresh();
  }

  async function removeFolder(folder: FolderType) {
    if (
      !window.confirm(
        `删除文件夹「${folder.name}」？它的子文件夹会一起删除，里面的笔记都会保留（变成无文件夹）。`
      )
    ) {
      return;
    }
    setError(null);
    const supabase = createClient();
    const { error } = await supabase.from("folders").delete().eq("id", folder.id);
    if (error) {
      setError(error.message);
      return;
    }
    setMenuFolderId(null);
    router.refresh();
  }

  /** 上移/下移文件夹：与相邻兄弟交换位置，并把整层兄弟的 position 重写成 0..n-1（刷新后按 position 排序即生效）。 */
  async function moveFolder(folder: FolderType, dir: -1 | 1) {
    const siblings = folders
      .filter((f) => (f.parent_id ?? null) === (folder.parent_id ?? null))
      .map((f) => f.id);
    const idx = siblings.indexOf(folder.id);
    const target = idx + dir;
    if (idx === -1 || target < 0 || target >= siblings.length) return;
    const reordered = [...siblings];
    [reordered[idx], reordered[target]] = [reordered[target], reordered[idx]];
    setError(null);
    const supabase = createClient();
    for (let i = 0; i < reordered.length; i++) {
      const { error } = await supabase
        .from("folders")
        .update({ position: i })
        .eq("id", reordered[i]);
      if (error) {
        setError(error.message);
        return;
      }
    }
    setMenuFolderId(null);
    router.refresh();
  }

  const isEmpty = folders.length === 0 && notes.length === 0;

  return (
    <div
      className="flex min-h-0 flex-col md:hidden"
      style={{ height: "calc(100dvh - 5rem - env(safe-area-inset-bottom))" }}
    >
      {/* 自包含头部：标题左 + 新建文件夹/新建笔记右，同一行窄吸顶；搜索框在其下、更薄。 */}
      <header className="shrink-0 border-b border-black/5 px-4 pb-3 pt-[calc(env(safe-area-inset-top)+1rem)]">
        <div className="flex items-center gap-2">
          <h1 className="min-w-0 flex-1 truncate text-2xl font-bold text-zinc-900">笔记</h1>
          <button
            onClick={() => {
              setNewFolderParentId(null);
              setShowNewFolder((v) => !v);
            }}
            title="新建文件夹"
            aria-label="新建文件夹"
            className="inline-flex h-9 shrink-0 items-center justify-center rounded-lg border border-zinc-200 px-1.5 text-zinc-600 transition-colors hover:bg-zinc-50"
          >
            <FolderPlus className="h-5 w-5" />
          </button>
          <NewNoteButton />
        </div>

        {/* 常驻搜索框：标题下方独立一行，比标题行更薄。 */}
        <div className="mt-2 flex items-center gap-2 rounded-lg border border-zinc-200 bg-white px-3 py-2">
          <Search className="h-4 w-4 shrink-0 text-zinc-400" />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="搜索笔记内容…"
            className="min-w-0 flex-1 bg-transparent text-sm text-zinc-800 placeholder-zinc-400 focus:outline-none placeholder:text-sm"
          />
          {query && (
            <button
              onClick={() => setQuery("")}
              className="text-sm text-zinc-400 hover:text-zinc-600"
              aria-label="清空搜索"
            >
              ✕
            </button>
          )}
        </div>
      </header>

      {/* 只有内容区滚：搜索框 / 新建按钮 / 标题都吸在头部，不跟着滑走。 */}
      <div ref={bodyRef} className="min-h-0 flex-1 overflow-y-auto px-4 py-4">
        {queryError && (
          <div className="mb-4 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
            {queryError}
          </div>
        )}

        {error && <p className="mb-4 text-sm text-red-600">{error}</p>}

        {isEmpty ? (
          <EmptyState
            icon={<FileText className="h-10 w-10" />}
            title="还没有笔记"
            description="点「新建笔记」新建，或「新建文件夹」先建个文件夹。"
          />
        ) : q ? (
          <div className="space-y-3">
            {matchedFlatFolders.length > 0 && (
              <div>
                <p className="px-1 pt-1 text-xs font-medium text-zinc-400">文件夹</p>
                <div className="space-y-1.5">
                  {matchedFlatFolders.map(({ folder }) => (
                    <Link
                      key={folder.id}
                      href={`/notes/folder/${folder.id}`}
                      className="flex items-center gap-2 rounded-lg border border-zinc-200 bg-white px-4 py-3 transition-colors hover:border-teal-300"
                    >
                      <Folder className="h-4 w-4 shrink-0 text-teal-500" strokeWidth={2.25} />
                      <span className="min-w-0 flex-1 truncate text-sm font-semibold text-zinc-800">
                        {folder.name}
                      </span>
                      <span className="text-xs text-zinc-400">{totals.get(folder.id) ?? 0}</span>
                    </Link>
                  ))}
                </div>
              </div>
            )}

            {searchNotes.length > 0 ? (
              <div>
                {matchedFlatFolders.length > 0 && (
                  <p className="px-1 pt-1 text-xs font-medium text-zinc-400">笔记</p>
                )}
                <NoteList
                  notes={searchNotes}
                  query={query.trim()}
                  folders={folders}
                  showFolder
                  showCount={false}
                  hideToolbar
                />
              </div>
            ) : matchedFlatFolders.length === 0 ? (
              <p className="px-3 py-3 text-sm text-zinc-400">没有匹配的笔记</p>
            ) : null}
          </div>
        ) : (
          <div className="space-y-2.5">
            {/* 全部笔记：固定默认入口，收纳整个库（含未归档的），不可删/改名，点击进 /notes/folder/all。 */}
            <Link
              href="/notes/folder/all"
              className="flex items-center gap-2 rounded-lg border border-zinc-200 bg-white px-4 py-3.5 transition-colors hover:border-teal-300"
            >
              <Folder className="h-5 w-5 shrink-0 text-teal-500" strokeWidth={2.25} />
              <span className="min-w-0 flex-1 truncate text-base font-semibold text-zinc-800">
                全部笔记
              </span>
              <span className="text-sm text-zinc-400">{notes.length}</span>
              <span className="text-xs text-zinc-400">→</span>
            </Link>

            {roots.length > 0 && (
              <p className="px-1 pt-1 text-xs font-medium text-zinc-400">文件夹</p>
            )}
            {roots.map((folder) => (
              <FolderTreeNode
                key={folder.id}
                folder={folder}
                childrenMap={folderChildren}
                totals={totals}
                depth={0}
                editingId={editingId}
                setEditingId={setEditingId}
                editingName={editingName}
                setEditingName={setEditingName}
                saveEdit={saveEdit}
                menuFolderId={menuFolderId}
                setMenuFolderId={setMenuFolderId}
                setNewFolderParentId={setNewFolderParentId}
                setShowNewFolder={setShowNewFolder}
                removeFolder={removeFolder}
                siblings={roots}
                moveFolder={moveFolder}
              />
            ))}
          </div>
        )}
      </div>

      {/* 新建文件夹 / 新建子文件夹：改为底部弹出，内容紧贴面板、不再跑到列表里。 */}
      <BottomSheet
        open={showNewFolder}
        onClose={() => {
          setShowNewFolder(false);
          setFolderName("");
          setNewFolderParentId(null);
        }}
        title={newFolderParentId ? "新建子文件夹" : "新建文件夹"}
      >
        <form
          onSubmit={(e) => {
            e.preventDefault();
            createFolder();
          }}
          className="mt-1 flex gap-2"
        >
          <input
            value={folderName}
            onChange={(e) => setFolderName(e.target.value)}
            placeholder={newFolderParentId ? "子文件夹名" : "新文件夹名"}
            autoFocus
            className="min-w-0 flex-1 rounded-lg border border-zinc-200 px-3 py-2.5 text-sm placeholder:text-sm focus:border-teal-500 focus:outline-none"
          />
          <button
            type="submit"
            disabled={busy}
            className="shrink-0 rounded-lg bg-teal-600 px-3 py-2.5 text-sm font-semibold text-white hover:bg-teal-700 disabled:opacity-60"
          >
            {busy ? "创建中…" : "确定"}
          </button>
        </form>
      </BottomSheet>
    </div>
  );
}

/**
 * 可折叠文件夹树节点。窄箭头（ChevronRight，无文字）展开/收起子层，点文件夹名进它的笔记列表。
 * 默认全部收起（像苹果备忘录侧栏），想展开子层就点箭头。计数用递归总数（含次级文件夹里的笔记）。
 */
function FolderTreeNode({
  folder,
  childrenMap,
  totals,
  depth,
  editingId,
  setEditingId,
  editingName,
  setEditingName,
  saveEdit,
  menuFolderId,
  setMenuFolderId,
  setNewFolderParentId,
  setShowNewFolder,
  removeFolder,
  siblings,
  moveFolder,
}: {
  folder: FolderType;
  childrenMap: Map<string, FolderType[]>;
  totals: Map<string, number>;
  depth: number;
  editingId: string | null;
  setEditingId: (id: string | null) => void;
  editingName: string;
  setEditingName: (v: string) => void;
  saveEdit: (id: string) => void;
  menuFolderId: string | null;
  setMenuFolderId: Dispatch<SetStateAction<string | null>>;
  setNewFolderParentId: (id: string | null) => void;
  setShowNewFolder: (v: boolean) => void;
  removeFolder: (folder: FolderType) => void;
  siblings: FolderType[];
  moveFolder: (folder: FolderType, dir: -1 | 1) => void;
}) {
  const [open, setOpen] = useState(false);
  const childFolds = childrenMap.get(folder.id) ?? [];
  const count = totals.get(folder.id) ?? 0;
  const siblingIdx = siblings.findIndex((f) => f.id === folder.id);
  const canMoveUp = siblingIdx > 0;
  const canMoveDown = siblingIdx >= 0 && siblingIdx < siblings.length - 1;

  if (editingId === folder.id) {
    return (
      <div
        style={{ marginLeft: depth * 16 }}
        className="flex items-center gap-1.5 rounded-lg border border-zinc-200 bg-white px-3 py-2"
      >
        <Folder className="h-4 w-4 shrink-0 text-teal-500" strokeWidth={2.25} />
        <input
          value={editingName}
          onChange={(e) => setEditingName(e.target.value)}
          className="min-w-0 flex-1 rounded-lg border border-zinc-300 px-2 py-1.5 text-sm focus:border-teal-500 focus:outline-none"
          autoFocus
          onKeyDown={(e) => {
            if (e.key === "Enter") saveEdit(folder.id);
            if (e.key === "Escape") setEditingId(null);
          }}
        />
        <button onClick={() => saveEdit(folder.id)} className="text-xs text-teal-600 hover:text-teal-700">
          保存
        </button>
        <button onClick={() => setEditingId(null)} className="text-xs text-zinc-500 hover:text-zinc-700">
          取消
        </button>
      </div>
    );
  }

  return (
    <div>
      <div
        style={{ marginLeft: depth * 16 }}
        className="flex items-center gap-1 rounded-lg border border-zinc-200 bg-white transition-colors hover:border-teal-300"
      >
        {childFolds.length > 0 ? (
          <button
            onClick={() => setOpen((v) => !v)}
            aria-label={open ? "收起子文件夹" : "展开子文件夹"}
            className="shrink-0 rounded p-1 text-zinc-400 transition-colors hover:bg-zinc-100 hover:text-zinc-700"
          >
            <ChevronRight className={`h-5 w-5 transition-transform ${open ? "rotate-90" : ""}`} />
          </button>
        ) : (
          <span className="w-6 shrink-0" />
        )}
        <Link
          href={`/notes/folder/${folder.id}`}
          className="flex min-w-0 flex-1 items-center gap-2 px-1.5 py-3.5"
        >
          <Folder className="h-5 w-5 shrink-0 text-teal-500" strokeWidth={2.25} />
          <span className="min-w-0 flex-1 truncate text-base font-semibold text-zinc-800">
            {folder.name}
          </span>
          <span className="text-sm text-zinc-400">{count}</span>
        </Link>

        {/* ⋯ 菜单：新建子文件夹 / 重命名 / 删除 */}
        <div className="relative">
          <button
            onClick={() => setMenuFolderId((id) => (id === folder.id ? null : folder.id))}
            className="rounded px-2 py-1.5 text-zinc-400 transition-colors hover:bg-zinc-100 hover:text-zinc-700"
            aria-label="文件夹操作"
          >
            ⋯
          </button>
          {menuFolderId === folder.id && (
            <>
              <div className="fixed inset-0 z-30" onClick={() => setMenuFolderId(null)} />
              <div className="absolute right-0 z-40 mt-1 w-32 rounded-xl border border-zinc-200 bg-white p-1 shadow-lg">
                <button
                  onClick={() => moveFolder(folder, -1)}
                  disabled={!canMoveUp}
                  className="flex w-full items-center gap-1.5 rounded-lg px-2.5 py-2 text-left text-sm text-zinc-700 hover:bg-zinc-100 disabled:opacity-40 disabled:hover:bg-transparent"
                >
                  <ArrowUp className="h-3.5 w-3.5" />上移
                </button>
                <button
                  onClick={() => moveFolder(folder, 1)}
                  disabled={!canMoveDown}
                  className="flex w-full items-center gap-1.5 rounded-lg px-2.5 py-2 text-left text-sm text-zinc-700 hover:bg-zinc-100 disabled:opacity-40 disabled:hover:bg-transparent"
                >
                  <ArrowDown className="h-3.5 w-3.5" />下移
                </button>
                <button
                  onClick={() => {
                    setNewFolderParentId(folder.id);
                    setShowNewFolder(true);
                    setMenuFolderId(null);
                  }}
                  className="flex w-full rounded-lg px-2.5 py-2 text-left text-sm text-zinc-700 hover:bg-zinc-100"
                >
                  新建子文件夹
                </button>
                <button
                  onClick={() => {
                    setEditingId(folder.id);
                    setEditingName(folder.name);
                    setMenuFolderId(null);
                  }}
                  className="flex w-full rounded-lg px-2.5 py-2 text-left text-sm text-zinc-700 hover:bg-zinc-100"
                >
                  重命名
                </button>
                <button
                  onClick={() => removeFolder(folder)}
                  className="flex w-full rounded-lg px-2.5 py-2 text-left text-sm text-red-600 hover:bg-red-50"
                >
                  删除
                </button>
              </div>
            </>
          )}
        </div>
      </div>

      {open && childFolds.length > 0 && (
        <div className="mt-2 space-y-2.5">
          {childFolds.map((f) => (
            <FolderTreeNode
              key={f.id}
              folder={f}
              childrenMap={childrenMap}
              totals={totals}
              depth={depth + 1}
              editingId={editingId}
              setEditingId={setEditingId}
              editingName={editingName}
              setEditingName={setEditingName}
              saveEdit={saveEdit}
              menuFolderId={menuFolderId}
              setMenuFolderId={setMenuFolderId}
              setNewFolderParentId={setNewFolderParentId}
              setShowNewFolder={setShowNewFolder}
              removeFolder={removeFolder}
              siblings={childFolds}
              moveFolder={moveFolder}
            />
          ))}
        </div>
      )}
    </div>
  );
}

/**
 * 列表/网格视图切换的单按钮：点一下切换，图标显示「将要切到的那个视图」。
 * 列表态显示网格图标（点了进网格），网格态显示列表图标（点了回列表）。
 */
export function ViewToggleButton({
  view,
  onChange,
  className = "inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-lg text-zinc-500 transition-colors hover:bg-zinc-50 hover:text-zinc-700",
}: {
  view: "list" | "grid";
  onChange: (v: "list" | "grid") => void;
  className?: string;
}) {
  const toGrid = view !== "grid";
  return (
    <button
      onClick={() => onChange(toGrid ? "grid" : "list")}
      aria-label={toGrid ? "切换为网格视图" : "切换为列表视图"}
      title={toGrid ? "网格视图" : "列表视图"}
      className={className}
    >
      {toGrid ? <LayoutGrid className="h-5 w-5" /> : <LayoutList className="h-5 w-5" />}
    </button>
  );
}

export function NoteList({
  notes,
  query,
  folders,
  showFolder = false,
  showCount = true,
  hideToolbar = false,
  view: viewProp,
  onViewChange,
}: {
  notes: Note[];
  query: string;
  folders: FolderType[];
  showFolder?: boolean;
  showCount?: boolean;
  /** 连「N 篇笔记 + 视图切换」这一行也整个不渲染（如笔记首页搜索结果的纯列表）。 */
  hideToolbar?: boolean;
  /** 受控视图：传入 onViewChange 时由父级决定布局并把切换按钮放在父级（如文件夹页头部），NoteList 自身不再渲染切换。 */
  view?: NotesView;
  onViewChange?: (v: NotesView) => void;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const [menuNoteId, setMenuNoteId] = useState<string | null>(null);
  const [pickerNote, setPickerNote] = useState<Note | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editingTitle, setEditingTitle] = useState("");
  // 列表 / 两列网格视图切换（仅表单列表，不涉正文）；非受控时也跨页面记住选择。
  const [view, setView] = useNotesView();
  const isControlled = onViewChange != null;
  const activeView = isControlled ? viewProp! : view;
  const switchView = isControlled ? onViewChange! : setView;

  // 当前打开的笔记 id（仅 /notes/[id]，列表页 / 文件夹页 / 子页都不算），用于高亮「正在看的这篇」。
  const activeNoteId = useMemo(() => {
    if (!pathname) return null;
    const parts = pathname.split("/");
    if (parts.length === 3 && parts[1] === "notes" && parts[2] !== "folder") {
      return parts[2];
    }
    return null;
  }, [pathname]);

  async function removeNote(note: Note) {
    if (!window.confirm(`删除笔记「${note.title}」？里面的闪卡也会一起删除。`)) {
      return;
    }
    const supabase = createClient();
    const { error: detachError } = await detachMaterialsFromNote(note.id);
    if (detachError) return;
    const { error } = await supabase.from("notes").delete().eq("id", note.id);
    if (error) return;
    setMenuNoteId(null);
    // 桌面端边栏里删笔记时，当前路由仍是这条笔记自己的 /notes/{id}——
    // router.refresh() 会重拉这条已删笔记 → getNote null → notFound → 404。
    // 若正停在它的页面就跳回「笔记」首页（空态 + 列表刷新），否则（已在 /notes）原地刷新列表即可。
    if (pathname === `/notes/${note.id}`) router.replace("/notes");
    else router.refresh();
  }

  async function moveNote(note: Note, folderId: string | null) {
    const supabase = createClient();
    const { error } = await supabase
      .from("notes")
      .update({ folder_id: folderId })
      .eq("id", note.id);
    if (error) return;
    setPickerNote(null);
    setMenuNoteId(null);
    router.refresh();
  }

  /** 置顶 / 取消置顶：更新 pinned 后刷新列表，置顶的笔记浮到文件夹顶部。 */
  async function togglePin(note: Note) {
    const supabase = createClient();
    const { error } = await supabase
      .from("notes")
      .update({ pinned: !note.pinned })
      .eq("id", note.id);
    if (error) return;
    setMenuNoteId(null);
    router.refresh();
  }

  async function saveNoteTitle(id: string) {
    const title = editingTitle.trim();
    if (!title) return;
    const supabase = createClient();
    const { error } = await supabase.from("notes").update({ title }).eq("id", id);
    if (error) return;
    setEditingId(null);
    setMenuNoteId(null);
    router.refresh();
  }

  return (
    <div className="space-y-2">
      {/* 视图切换：单个按钮（列表/网格互切，显示将要切到的那一格）。仅移动端显示（桌面侧栏保持纯列表）；受控时由父级渲染；hideToolbar 时整行不渲染。 */}
      {(showCount || !isControlled) && !hideToolbar && (
        <div className="flex items-center gap-3 md:hidden">
          {showCount && <span className="text-xs font-medium text-zinc-400">{notes.length} 篇笔记</span>}
          {!isControlled && (
            <div className="ml-auto flex items-center gap-0.5">
              <ViewToggleButton view={activeView} onChange={switchView} />
            </div>
          )}
        </div>
      )}

      {activeView === "grid" ? (
        <div className="grid grid-cols-2 gap-3">
          {notes.map((note) => (
            <NoteItem
              key={note.id}
              note={note}
              view={activeView}
              query={query}
              folders={folders}
              showFolder={showFolder}
              activeNoteId={activeNoteId}
              menuNoteId={menuNoteId}
              setMenuNoteId={setMenuNoteId}
              editingId={editingId}
              setEditingId={setEditingId}
              editingTitle={editingTitle}
              setEditingTitle={setEditingTitle}
              onMoveRequest={(note) => setPickerNote(note)}
              onTogglePin={togglePin}
              onMove={moveNote}
              onRemove={removeNote}
              onSaveTitle={saveNoteTitle}
            />
          ))}
        </div>
      ) : (
        <ul className="space-y-2">
          {notes.map((note) => (
            <NoteItem
              key={note.id}
              note={note}
              view={activeView}
              query={query}
              folders={folders}
              showFolder={showFolder}
              activeNoteId={activeNoteId}
              menuNoteId={menuNoteId}
              setMenuNoteId={setMenuNoteId}
              editingId={editingId}
              setEditingId={setEditingId}
              editingTitle={editingTitle}
              setEditingTitle={setEditingTitle}
              onMoveRequest={(note) => setPickerNote(note)}
              onTogglePin={togglePin}
              onMove={moveNote}
              onRemove={removeNote}
              onSaveTitle={saveNoteTitle}
            />
          ))}
        </ul>
      )}

      {/* 移动到：底部弹出文件夹单（多了也能滚，参考苹果备忘录） */}
      <FolderPickerSheet
        open={pickerNote != null}
        onClose={() => setPickerNote(null)}
        folders={folders}
        title="移动到"
        currentFolderId={pickerNote?.folder_id ?? null}
        onPick={(fid) => pickerNote && moveNote(pickerNote, fid)}
      />
    </div>
  );
}

/** 单篇笔记的行 / 两列卡片，标题+摘要+时间（右上⋯菜单）。列表和网格共用同一套操作逻辑，仅外层布局不同。 */
function NoteItem({
  note,
  view,
  query,
  folders,
  showFolder,
  activeNoteId,
  menuNoteId,
  setMenuNoteId,
  editingId,
  setEditingId,
  editingTitle,
  setEditingTitle,
  onMoveRequest,
  onTogglePin,
  onMove,
  onRemove,
  onSaveTitle,
}: {
  note: Note;
  view: "list" | "grid";
  query: string;
  folders: FolderType[];
  showFolder?: boolean;
  activeNoteId: string | null;
  menuNoteId: string | null;
  setMenuNoteId: Dispatch<SetStateAction<string | null>>;
  editingId: string | null;
  setEditingId: Dispatch<SetStateAction<string | null>>;
  editingTitle: string;
  setEditingTitle: Dispatch<SetStateAction<string>>;
  /** 点击「移动」：交由父级弹出底部文件夹单。 */
  onMoveRequest: (note: Note) => void;
  /** 置顶 / 取消置顶：刷新列表（置顶的笔记浮到顶部）。 */
  onTogglePin: (note: Note) => void;
  onMove: (note: Note, folderId: string | null) => void;
  onRemove: (note: Note) => void;
  onSaveTitle: (id: string) => void;
}) {
  const time = formatNoteDate(note.updated_at);
  const isActive = note.id === activeNoteId;

  // 编辑态：列表 / 网格共用一条输入条。
  if (editingId === note.id) {
    return (
      <div className="flex items-center gap-1.5 rounded-lg border border-zinc-200 bg-white px-3 py-2">
        <input
          value={editingTitle}
          onChange={(e) => setEditingTitle(e.target.value)}
          className="min-w-0 flex-1 rounded-lg border border-zinc-300 px-2 py-1.5 text-sm focus:border-teal-500 focus:outline-none"
          autoFocus
          onKeyDown={(e) => {
            if (e.key === "Enter") onSaveTitle(note.id);
            if (e.key === "Escape") setEditingId(null);
          }}
        />
        <button
          onClick={() => onSaveTitle(note.id)}
          className="text-xs text-teal-600 hover:text-teal-700"
        >
          保存
        </button>
        <button
          onClick={() => setEditingId(null)}
          className="text-xs text-zinc-500 hover:text-zinc-700"
        >
          取消
        </button>
      </div>
    );
  }

  // ⋯ 菜单（列表 / 网格共用：重命名 / 移动 / 删除）。
  const menu = (
    <>
      <button
        onClick={() => setMenuNoteId((id) => (id === note.id ? null : note.id))}
        className="rounded px-2 py-1 text-zinc-400 transition-colors hover:bg-zinc-100 hover:text-zinc-700"
        aria-label="笔记操作"
      >
        ⋯
      </button>
      {menuNoteId === note.id && (
        <>
          <div className="fixed inset-0 z-30" onClick={() => setMenuNoteId(null)} />
          <div className="absolute right-0 z-40 mt-1 w-28 rounded-xl border border-zinc-200 bg-white p-1 shadow-lg">
            <button
              onClick={() => {
                setEditingId(note.id);
                setEditingTitle(note.title);
                setMenuNoteId(null);
              }}
              className="flex w-full rounded-lg px-2.5 py-2 text-left text-sm text-zinc-700 hover:bg-zinc-100"
            >
              重命名
            </button>
            <button
              onClick={() => onTogglePin(note)}
              className="flex w-full items-center gap-1.5 rounded-lg px-2.5 py-2 text-left text-sm text-zinc-700 hover:bg-zinc-100"
            >
              {note.pinned ? "取消置顶" : "置顶"}
            </button>
            <button
              onClick={() => onMoveRequest(note)}
              className="flex w-full rounded-lg px-2.5 py-2 text-left text-sm text-zinc-700 hover:bg-zinc-100"
            >
              移动
            </button>
            <button
              onClick={() => onRemove(note)}
              className="flex w-full rounded-lg px-2.5 py-2 text-left text-sm text-red-600 hover:bg-red-50"
            >
              删除
            </button>
          </div>
        </>
      )}
    </>
  );

  const cardClass = `flex flex-col rounded-lg border bg-white transition-colors ${
    isActive ? "border-teal-300 bg-teal-50" : "border-zinc-200 hover:border-teal-300"
  }`;

  if (view === "grid") {
    return (
      <div className={cardClass}>
        <Link href={`/notes/${note.id}`} className="min-w-0 flex-1 px-3.5 py-2.5">
          <p
            className={`line-clamp-2 text-lg font-medium ${
              isActive ? "text-teal-700" : "text-zinc-800"
            }`}
          >
            {note.pinned && <Pin className="mr-1 -mt-0.5 inline h-3.5 w-3.5 text-teal-500" />}
            <Highlight text={note.title} q={query} />
          </p>
          {showFolder && note.folder_id && (
            <p className="mt-1 flex items-center gap-1 truncate text-sm text-teal-500">
              <Folder className="h-3 w-3 shrink-0" />
              <span className="truncate">
                {folders.find((f) => f.id === note.folder_id)?.name ?? ""}
              </span>
            </p>
          )}
          {note.content_text && (
            <p className="mt-1 line-clamp-2 text-base text-zinc-500">
              <Snippet text={note.content_text} q={query} />
            </p>
          )}
        </Link>
        <div className="mt-auto flex items-center justify-between gap-2 border-t border-zinc-100 px-1.5 py-1">
          <div className="flex items-center gap-2">
            {time && <span className="ml-1.5 text-sm text-zinc-400">{time}</span>}
            {note.cardCount ? (
              <span className="inline-flex shrink-0 items-center gap-0.5 rounded-full bg-teal-50 px-1.5 py-0.5 text-[10px] font-medium text-teal-600">
                <Layers className="h-3 w-3" />
                {note.cardCount}
              </span>
            ) : null}
          </div>
          <div className="relative">{menu}</div>
        </div>
      </div>
    );
  }

  return (
    <div className={`flex items-center gap-0.5 rounded-lg border bg-white transition-colors ${isActive ? "border-teal-300 bg-teal-50" : "border-zinc-200 hover:border-teal-300"}`}>
      <Link href={`/notes/${note.id}`} className="min-w-0 flex-1 px-3.5 py-2.5">
        <p className={`flex items-center gap-1 truncate text-base font-medium md:text-sm ${isActive ? "text-teal-700" : "text-zinc-800"}`}>
          {note.pinned && <Pin className="h-3.5 w-3.5 shrink-0 text-teal-500" />}
          <span className="min-w-0 truncate">
            <Highlight text={note.title} q={query} />
          </span>
          {note.cardCount ? (
            <span className="inline-flex shrink-0 items-center gap-0.5 rounded-full bg-teal-50 px-1.5 py-0.5 text-[10px] font-medium text-teal-600">
              <Layers className="h-3 w-3" />
              {note.cardCount}
            </span>
          ) : null}
        </p>
        {showFolder && note.folder_id && (
          <p className="mt-0.5 flex items-center gap-1 truncate text-sm text-teal-500 md:text-xs">
            <Folder className="h-3 w-3 shrink-0" />
            <span className="truncate">
              {folders.find((f) => f.id === note.folder_id)?.name ?? ""}
            </span>
          </p>
        )}
        {note.content_text && (
          <p className="mt-0.5 truncate text-base text-zinc-500 md:text-sm">
            <Snippet text={note.content_text} q={query} />
          </p>
        )}
        {time && <p className="mt-0.5 text-sm text-zinc-400 md:text-xs">{time}</p>}
      </Link>
      <div className="relative self-start pr-1 pt-2.5">
        {menu}
      </div>
    </div>
  );
}

/** 在标题里高亮命中词（标题短，直接整段高亮）。 */
function Highlight({ text, q }: { text: string; q: string }) {
  if (!q) return <>{text}</>;
  const idx = text.toLowerCase().indexOf(q.toLowerCase());
  if (idx === -1) return <>{text}</>;
  return (
    <>
      {text.slice(0, idx)}
      <mark className="rounded-sm bg-yellow-200 text-inherit">
        {text.slice(idx, idx + q.length)}
      </mark>
      {text.slice(idx + q.length)}
    </>
  );
}

/** 在正文里截取命中附近的一段并高亮，让人一眼看到内容定位在哪。 */
function Snippet({ text, q }: { text: string; q: string }) {
  if (!q) return <>{text.slice(0, 80)}{text.length > 80 ? "…" : ""}</>;
  const idx = text.toLowerCase().indexOf(q.toLowerCase());
  if (idx === -1) return <>{text.slice(0, 80)}{text.length > 80 ? "…" : ""}</>;
  const start = Math.max(0, idx - 20);
  const end = Math.min(text.length, idx + q.length + 40);
  return (
    <>
      {start > 0 ? "…" : ""}
      {text.slice(start, idx)}
      <mark className="rounded-sm bg-yellow-200 text-inherit">
        {text.slice(idx, idx + q.length)}
      </mark>
      {text.slice(idx + q.length, end)}
      {end < text.length ? "…" : ""}
    </>
  );
}
