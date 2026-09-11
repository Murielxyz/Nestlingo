"use client";

import { useMemo, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import {
  FolderPlus,
  FileText,
  Folder,
  Search,
  ChevronLeft,
  ChevronRight,
  ArrowUp,
  ArrowDown,
} from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import {
  folderTree,
  descendantFolderIds,
  folderNoteTotals,
} from "@/lib/folders";
import { usePanelResize } from "@/lib/use-panel-resize";
import { NoteList } from "./notes-browser";
import { NewNoteButton } from "./new-note-button";
import type { Folder as FolderType, Note } from "@/lib/types";

/**
 * 笔记工作台（macOS 备忘录式三栏）：
 * - 电脑端（md+）：左 = 文件夹栏（全部笔记 + 文件夹，可收起），中 = 笔记列表，右 = 内容。
 * - 手机端：只有内容栏，正常点开进入对应页面（列表在 /notes，正文在 /notes/[id]）。
 * - 子页面（如 /notes/[id]/cards）整页铺满，不进三栏。
 *
 * 数据（folders / notes）由服务端 layout 抓取传入；增删改后各组件 router.refresh()
 * 会让 layout 重新抓一遍，这里作为 client 组件收到新 props 自动更新，选中的文件夹状态保留。
 */
export function NotesWorkspace({
  folders,
  notes,
  children,
}: {
  folders: FolderType[];
  notes: Note[];
  children: React.ReactNode;
}) {
  const pathname = usePathname();
  const router = useRouter();

  // /notes：三栏（文件夹 + 笔记列表 + 内容）。
  // /notes/[id]：两栏（笔记列表 + 正文，不显示文件夹栏），正文旁随时切到别的笔记。
  // 其它子页面（/notes/[id]/cards、/notes/folder/[id]）：整页铺满。
  const isList = pathname === "/notes";
  const isNote = /^\/notes\/[^/]+$/.test(pathname);

  const [selectedId, setSelectedId] = useState<"all" | string>("all");
  // 侧栏（文件夹栏 + 笔记列表栏）总开关：收起时两栏一起隐、内容几乎铺满；展开时两栏一起回来。
  // 默认展开，且纯手动控制（不再进笔记页自动收起），开关固定在左上角、不随收起跳动。
  const [collapsed, setCollapsed] = useState(false);
  const [query, setQuery] = useState("");

  // 文件夹栏 / 笔记列表栏宽度：桌面端可拖拽调整并记住（`nestlingo:` 前缀，照 usePanelResize）。
  // 两栏都是把手在右缘的左侧栏 → flip:true（往右拖边界往右、变宽；收起功能已撤）。
  const folderResize = usePanelResize({
    key: "nestlingo:folders-width",
    initial: 176,
    min: 160,
    max: 320,
    flip: true,
  });
  const listResize = usePanelResize({
    key: "nestlingo:notes-list-width",
    initial: 288,
    min: 224,
    max: 420,
    flip: true,
  });
  const [showNewFolder, setShowNewFolder] = useState(false);
  const [folderName, setFolderName] = useState("");
  const [newFolderParentId, setNewFolderParentId] = useState<string | null>(null);
  const [menuFolderId, setMenuFolderId] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editingName, setEditingName] = useState("");

  const q = query.trim().toLowerCase();
  const filtered = useMemo(() => {
    // 选中父文件夹时，展示它（含子文件夹）下所有笔记；选「全部」则不过滤文件夹。
    const scope =
      selectedId === "all" ? null : descendantFolderIds(folders, selectedId);
    return notes.filter((n) => {
      if (scope && !(n.folder_id && scope.has(n.folder_id))) return false;
      if (!q) return true;
      return (
        n.title.toLowerCase().includes(q) ||
        (n.content_text ?? "").toLowerCase().includes(q)
      );
    });
  }, [notes, selectedId, q, folders]);

  const folderCounts = useMemo(() => {
    const m = new Map<string, number>();
    for (const n of notes) {
      if (n.folder_id) m.set(n.folder_id, (m.get(n.folder_id) ?? 0) + 1);
    }
    return m;
  }, [notes]);

  // 侧栏按「含子文件夹」的总数显示（父文件夹不直接放笔记时，也看得出下面有多少篇）。
  const folderTotals = useMemo(
    () => folderNoteTotals(folders, folderCounts),
    [folders, folderCounts]
  );
  // 可折叠树：roots 顶层，folderChildren 父 id → 直接子夹。初始全部展开（保持原有「层层缩进全可见」的样子），
  // 想收哪层点箭头即可；点击文件夹名仍是筛选（父文件夹含其全部子夹下笔记）。
  const { roots, children: folderChildren } = useMemo(
    () => folderTree(folders),
    [folders]
  );
  const [openFolders, setOpenFolders] = useState<Set<string>>(
    () => new Set(folders.map((f) => f.id))
  );

  const selectedFolder = folders.find((f) => f.id === selectedId);
  const listTitle =
    selectedId === "all" ? "全部笔记" : (selectedFolder?.name ?? "全部笔记");

  async function createFolder() {
    const name = folderName.trim();
    if (!name) return;
    const supabase = createClient();
    const { error } = await supabase
      .from("folders")
      .insert({ name, parent_id: newFolderParentId });
    if (error) return;
    setFolderName("");
    setShowNewFolder(false);
    setNewFolderParentId(null);
    router.refresh();
  }

  async function saveEdit(id: string) {
    const name = editingName.trim();
    if (!name) return;
    const supabase = createClient();
    const { error } = await supabase.from("folders").update({ name }).eq("id", id);
    if (error) return;
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
    const supabase = createClient();
    const { error } = await supabase.from("folders").delete().eq("id", folder.id);
    if (error) return;
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
    const supabase = createClient();
    for (let i = 0; i < reordered.length; i++) {
      const { error } = await supabase
        .from("folders")
        .update({ position: i })
        .eq("id", reordered[i]);
      if (error) return;
    }
    setMenuFolderId(null);
    router.refresh();
  }

  // 其它子页面（闪卡页 / 文件夹页）：不套侧栏，直接整页铺满。
  if (!isList && !isNote) {
    return <div className="min-w-0 flex-1">{children}</div>;
  }

  // /notes 与 /notes/[id] 共用同一套侧栏：文件夹栏 + 笔记列表 + 内容。
  // 列表始终跟着「选中的文件夹」走——从某个文件夹点进笔记，左侧列表仍只显示该文件夹
  // （含子文件夹）下的笔记，不再跳回「全部笔记」；只有「全部笔记」被选中时才显示全部。
  const listNotes = filtered;
  const headerTitle = listTitle;
  const showFolderTag = selectedId === "all";
  const newNoteFolderId = selectedId === "all" ? null : selectedId;

  // 递归渲染一支文件夹：先箭头（有子夹才出现）切换展开/收起，再点名字筛选，右侧悬停出现 ⋯ 菜单。
  function renderFolder(
    folder: FolderType,
    depth: number,
    siblings: FolderType[]
  ): React.ReactNode {
    const count = folderTotals.get(folder.id) ?? 0;
    const childFolds = folderChildren.get(folder.id) ?? [];
    const isOpen = openFolders.has(folder.id);
    const siblingIdx = siblings.findIndex((f) => f.id === folder.id);
    const canMoveUp = siblingIdx > 0;
    const canMoveDown = siblingIdx >= 0 && siblingIdx < siblings.length - 1;

    if (editingId === folder.id) {
      return (
        <div
          key={folder.id}
          style={{ marginLeft: depth * 12 }}
          className="mt-0.5 flex items-center gap-1 px-1"
        >
          <Folder className="h-4 w-4 shrink-0 text-zinc-400" />
          <input
            value={editingName}
            onChange={(e) => setEditingName(e.target.value)}
            className="min-w-0 flex-1 rounded-lg border border-zinc-300 px-2 py-1.5 text-sm placeholder:text-sm focus:border-teal-500 focus:outline-none"
            autoFocus
            onKeyDown={(e) => {
              if (e.key === "Enter") saveEdit(folder.id);
              if (e.key === "Escape") setEditingId(null);
            }}
          />
          <button
            onClick={() => saveEdit(folder.id)}
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

    return (
      <div key={folder.id}>
        <div style={{ marginLeft: depth * 12 }} className="group relative">
          <div className="flex items-center gap-0.5">
            {childFolds.length > 0 ? (
              <button
                onClick={() =>
                  setOpenFolders((prev) => {
                    const next = new Set(prev);
                    if (next.has(folder.id)) next.delete(folder.id);
                    else next.add(folder.id);
                    return next;
                  })
                }
                aria-label={isOpen ? "收起子文件夹" : "展开子文件夹"}
                title={isOpen ? "收起子文件夹" : "展开子文件夹"}
                className="shrink-0 rounded p-1 text-zinc-400 transition-colors hover:bg-zinc-100 hover:text-zinc-700"
              >
                <ChevronRight
                  className={`h-4 w-4 transition-transform ${isOpen ? "rotate-90" : ""}`}
                />
              </button>
            ) : (
              <span className="w-6 shrink-0" />
            )}
            <button
              onClick={() => setSelectedId(folder.id)}
              className={`flex min-w-0 flex-1 items-center gap-2 rounded-lg py-2 pl-2 pr-2 text-left text-sm transition-colors ${
                selectedId === folder.id
                  ? "bg-teal-50 text-teal-700"
                  : "text-zinc-700 hover:bg-zinc-100"
              }`}
            >
              <Folder className="h-4 w-4 shrink-0 text-zinc-400" />
              <span className="min-w-0 flex-1 truncate">{folder.name}</span>
              <span className="text-xs text-zinc-400">{count}</span>
            </button>
          </div>

          {/* ⋯ 菜单：重命名 / 删除 */}
          <button
            onClick={() =>
              setMenuFolderId((id) => (id === folder.id ? null : folder.id))
            }
            className="absolute right-1 top-1/2 -translate-y-1/2 rounded px-1.5 py-0.5 text-xs text-zinc-400 opacity-0 transition-opacity hover:bg-zinc-200 hover:text-zinc-700 group-hover:opacity-100"
            aria-label="文件夹操作"
          >
            ⋯
          </button>
          {menuFolderId === folder.id && (
            <>
              <div
                className="fixed inset-0 z-30"
                onClick={() => setMenuFolderId(null)}
              />
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

        {isOpen && childFolds.length > 0 && (
          <div className="mt-0.5 space-y-0.5">
            {childFolds.map((c) => renderFolder(c, depth + 1, childFolds))}
          </div>
        )}
      </div>
    );
  }

  return (
    <div className="relative flex md:h-screen">
      {/* ===== 侧栏总开关：固定在左上角，收起/展开都不跳动（←/→ 箭头标识） ===== */}
      <button
        onClick={() => setCollapsed((v) => !v)}
        className="absolute left-2 top-2 z-30 hidden h-8 w-8 items-center justify-center rounded-lg text-zinc-500 transition-colors hover:bg-zinc-100 hover:text-zinc-900 md:inline-flex"
        aria-label={collapsed ? "展开侧栏" : "收起侧栏"}
        title={collapsed ? "展开侧栏" : "收起侧栏"}
      >
        {collapsed ? (
          <ChevronRight className="h-[18px] w-[18px]" />
        ) : (
          <ChevronLeft className="h-[18px] w-[18px]" />
        )}
      </button>

      {collapsed ? (
        /* 收起：只留一条窄边给开关占位，内容几乎铺满 */
        <div className="hidden w-11 shrink-0 border-r border-zinc-200 bg-zinc-50 md:block" />
      ) : (
        <>
      {/* ===== 左：文件夹栏（桌面） ===== */}
        <aside
          style={{ width: folderResize.width }}
          className="relative hidden shrink-0 flex-col border-r border-zinc-200 bg-zinc-50 md:flex"
        >
          {/* 左内边距让开左上角的开关按钮（pl-11） */}
          <div className="flex items-center gap-0.5 border-b border-zinc-200 py-2 pl-11 pr-2.5">
            <span className="flex-1 px-1 text-sm font-semibold text-zinc-800">
              笔记
            </span>
            <button
              onClick={() => {
                setNewFolderParentId(null);
                setShowNewFolder((v) => !v);
              }}
              className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-lg text-zinc-500 transition-colors hover:bg-zinc-100"
              aria-label="新建文件夹"
              title="新建文件夹"
            >
              <FolderPlus className="h-5 w-5" />
            </button>
          </div>

          {showNewFolder && (
            <form
              onSubmit={(e) => {
                e.preventDefault();
                createFolder();
              }}
              className="flex gap-1.5 border-b border-zinc-200 px-2.5 py-2"
            >
              <input
                value={folderName}
                onChange={(e) => setFolderName(e.target.value)}
                placeholder={newFolderParentId ? "子文件夹名" : "新文件夹名"}
                autoFocus
                className="min-w-0 flex-1 rounded-lg border border-zinc-300 px-2 py-1.5 text-sm placeholder:text-sm focus:border-teal-500 focus:outline-none"
              />
              <button
                type="submit"
                className="text-sm font-medium text-teal-600 hover:text-teal-700"
              >
                确定
              </button>
            </form>
          )}

          <nav className="flex-1 overflow-y-auto px-2 py-2">
            {/* 全部笔记 */}
            <button
              onClick={() => setSelectedId("all")}
              className={`flex w-full items-center gap-2 rounded-lg px-2 py-2 text-left text-sm transition-colors ${
                selectedId === "all"
                  ? "bg-teal-50 text-teal-700"
                  : "text-zinc-700 hover:bg-zinc-100"
              }`}
            >
              <FileText className="h-4 w-4 shrink-0" />
              <span className="min-w-0 flex-1 truncate">全部笔记</span>
              <span className="text-xs text-zinc-400">{notes.length}</span>
            </button>

            {/* 文件夹（可折叠树：箭头展开/收起，点名字筛选；父文件夹包含其全部子夹下的笔记） */}
            {roots.map((folder) => renderFolder(folder, 0, roots))}
          </nav>
          {/* 拖拽把手：按住右边缘左右拖调整宽度 */}
          <div
            onPointerDown={folderResize.onPointerDown}
            className="absolute inset-y-0 right-0 z-10 w-1.5 cursor-col-resize bg-transparent transition-colors hover:bg-teal-200/70"
            aria-hidden
          />
        </aside>

      {/* ===== 中：笔记列表栏（桌面，可拖宽） ===== */}
      <div
        style={{ width: listResize.width }}
        className="relative hidden shrink-0 flex-col border-r border-zinc-200 bg-white md:flex"
      >
        <div className="flex items-center gap-0.5 border-b border-zinc-200 px-2.5 py-2">
          <span className="min-w-0 flex-1 truncate px-1 text-sm font-semibold text-zinc-800">
            {headerTitle}
          </span>
          <NewNoteButton folderId={newNoteFolderId} />
        </div>
        <div className="px-3 pt-2.5">
          <div className="flex items-center gap-2 rounded-lg border border-zinc-200 bg-zinc-50 px-3 py-2">
            <Search className="h-4 w-4 shrink-0 text-zinc-400" />
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="搜索笔记…"
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
        </div>
        <div className="flex-1 overflow-y-auto px-2 py-2">
          {listNotes.length === 0 ? (
            <p className="px-2 py-6 text-center text-sm text-zinc-400">
              {q ? "没有匹配的笔记" : "还没有笔记"}
            </p>
          ) : (
            <NoteList
              notes={listNotes}
              query={query.trim()}
              folders={folders}
              showFolder={showFolderTag}
            />
          )}
        </div>
        {/* 拖拽把手：按住右边缘左右拖调整宽度 */}
        <div
          onPointerDown={listResize.onPointerDown}
          className="absolute inset-y-0 right-0 z-10 w-1.5 cursor-col-resize bg-transparent transition-colors hover:bg-teal-200/70"
          aria-hidden
        />
      </div>
        </>
      )}

      {/* ===== 右：内容栏 ===== */}
      <div className="min-w-0 flex-1 md:overflow-y-auto">{children}</div>
    </div>
  );
}
