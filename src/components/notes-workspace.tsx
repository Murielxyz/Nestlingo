"use client";

import { useMemo, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { NoteList } from "./notes-browser";
import { NewNoteButton } from "./new-note-button";
import type { Folder, Note } from "@/lib/types";

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
  folders: Folder[];
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
  const [collapsed, setCollapsed] = useState(false);
  const [query, setQuery] = useState("");
  const [showNewFolder, setShowNewFolder] = useState(false);
  const [folderName, setFolderName] = useState("");
  const [menuFolderId, setMenuFolderId] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editingName, setEditingName] = useState("");

  const q = query.trim().toLowerCase();
  const filtered = useMemo(() => {
    return notes.filter((n) => {
      if (selectedId !== "all" && n.folder_id !== selectedId) return false;
      if (!q) return true;
      return (
        n.title.toLowerCase().includes(q) ||
        (n.content_text ?? "").toLowerCase().includes(q)
      );
    });
  }, [notes, selectedId, q]);

  const folderCounts = useMemo(() => {
    const m = new Map<string, number>();
    for (const n of notes) {
      if (n.folder_id) m.set(n.folder_id, (m.get(n.folder_id) ?? 0) + 1);
    }
    return m;
  }, [notes]);

  const selectedFolder = folders.find((f) => f.id === selectedId);
  const listTitle =
    selectedId === "all" ? "全部笔记" : (selectedFolder?.name ?? "全部笔记");

  async function createFolder() {
    const name = folderName.trim();
    if (!name) return;
    const supabase = createClient();
    const { error } = await supabase.from("folders").insert({ name });
    if (error) return;
    setFolderName("");
    setShowNewFolder(false);
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

  async function removeFolder(folder: Folder) {
    if (
      !window.confirm(`删除文件夹「${folder.name}」？里面的笔记会保留，变成无文件夹。`)
    ) {
      return;
    }
    const supabase = createClient();
    const { error } = await supabase.from("folders").delete().eq("id", folder.id);
    if (error) return;
    setMenuFolderId(null);
    router.refresh();
  }

  // 笔记正文页（/notes/[id]）：桌面端两栏（笔记列表 + 正文），不显示文件夹栏；手机端整页。
  if (isNote) {
    const noteMatches = notes.filter((n) => {
      if (!q) return true;
      return (
        n.title.toLowerCase().includes(q) ||
        (n.content_text ?? "").toLowerCase().includes(q)
      );
    });
    return (
      <div className="flex md:h-screen">
        {/* 左：笔记列表（桌面） */}
        <div className="hidden w-72 shrink-0 flex-col border-r border-zinc-200 bg-white md:flex">
          <div className="flex items-center gap-0.5 border-b border-zinc-200 px-2.5 py-2">
            <span className="min-w-0 flex-1 truncate px-1 text-sm font-semibold text-zinc-800">
              笔记
            </span>
            <NewNoteButton folderId={null} />
          </div>

          <div className="px-3 pt-2.5">
            <div className="flex items-center gap-2 rounded-lg border border-zinc-200 bg-zinc-50 px-2.5 py-1.5">
              <span className="text-zinc-400">🔍</span>
              <input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="搜索笔记…"
                className="min-w-0 flex-1 bg-transparent text-sm text-zinc-800 placeholder-zinc-400 focus:outline-none"
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
            {noteMatches.length === 0 ? (
              <p className="px-2 py-6 text-center text-sm text-zinc-400">
                {q ? "没有匹配的笔记" : "还没有笔记"}
              </p>
            ) : (
              <NoteList notes={noteMatches} query={query.trim()} folders={folders} showFolder={false} />
            )}
          </div>
        </div>

        {/* 右：正文 */}
        <div className="min-w-0 flex-1 md:overflow-y-auto">{children}</div>
      </div>
    );
  }

  // 其它子页面（闪卡页 / 文件夹页）：不套侧栏，直接整页铺满。
  if (!isList) {
    return <div className="min-w-0 flex-1">{children}</div>;
  }

  return (
    <div className="flex md:h-screen">
      {/* ===== 左：文件夹栏（桌面，可收起） ===== */}
      {!collapsed && (
        <aside className="hidden w-52 shrink-0 flex-col border-r border-zinc-200 bg-zinc-50 md:flex">
          <div className="flex items-center gap-0.5 border-b border-zinc-200 px-2.5 py-2">
            <button
              onClick={() => setCollapsed(true)}
              className="rounded-lg p-1.5 text-zinc-500 transition-colors hover:bg-zinc-100 hover:text-zinc-900"
              aria-label="收起文件夹"
              title="收起文件夹"
            >
              ≡
            </button>
            <span className="flex-1 px-1 text-sm font-semibold text-zinc-800">
              笔记
            </span>
            <button
              onClick={() => setShowNewFolder((v) => !v)}
              className="rounded-lg p-1.5 text-sm text-zinc-500 transition-colors hover:bg-zinc-100"
              aria-label="新建文件夹"
              title="新建文件夹"
            >
              📁＋
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
                placeholder="新文件夹名"
                autoFocus
                className="min-w-0 flex-1 rounded-lg border border-zinc-300 px-2 py-1 text-sm focus:border-teal-500 focus:outline-none"
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
              className={`flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left text-sm transition-colors ${
                selectedId === "all"
                  ? "bg-teal-50 text-teal-700"
                  : "text-zinc-700 hover:bg-zinc-100"
              }`}
            >
              <span>📝</span>
              <span className="min-w-0 flex-1 truncate">全部笔记</span>
              <span className="text-xs text-zinc-400">{notes.length}</span>
            </button>

            {/* 文件夹（flat，无 toggle，点击即筛选） */}
            {folders.map((folder) => {
              const count = folderCounts.get(folder.id) ?? 0;
              if (editingId === folder.id) {
                return (
                  <div key={folder.id} className="mt-0.5 flex items-center gap-1 px-1">
                    <span>📁</span>
                    <input
                      value={editingName}
                      onChange={(e) => setEditingName(e.target.value)}
                      className="min-w-0 flex-1 rounded-lg border border-zinc-300 px-2 py-1 text-sm focus:border-teal-500 focus:outline-none"
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
                <div key={folder.id} className="group relative">
                  <button
                    onClick={() => setSelectedId(folder.id)}
                    className={`flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left text-sm transition-colors ${
                      selectedId === folder.id
                        ? "bg-teal-50 text-teal-700"
                        : "text-zinc-700 hover:bg-zinc-100"
                    }`}
                  >
                    <span>📁</span>
                    <span className="min-w-0 flex-1 truncate">{folder.name}</span>
                    <span className="text-xs text-zinc-400">{count}</span>
                  </button>

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
                      <div className="absolute right-0 z-40 mt-1 w-28 rounded-xl border border-zinc-200 bg-white p-1 shadow-lg">
                        <button
                          onClick={() => {
                            setEditingId(folder.id);
                            setEditingName(folder.name);
                            setMenuFolderId(null);
                          }}
                          className="flex w-full rounded-lg px-2.5 py-1.5 text-left text-sm text-zinc-700 hover:bg-zinc-100"
                        >
                          重命名
                        </button>
                        <button
                          onClick={() => removeFolder(folder)}
                          className="flex w-full rounded-lg px-2.5 py-1.5 text-left text-sm text-red-600 hover:bg-red-50"
                        >
                          删除
                        </button>
                      </div>
                    </>
                  )}
                </div>
              );
            })}
          </nav>
        </aside>
      )}

      {/* ===== 中：笔记列表栏（桌面） ===== */}
      <div className="hidden w-72 shrink-0 flex-col border-r border-zinc-200 bg-white md:flex">
        <div className="flex items-center gap-0.5 border-b border-zinc-200 px-2.5 py-2">
          {collapsed && (
            <button
              onClick={() => setCollapsed(false)}
              className="rounded-lg p-1.5 text-zinc-500 transition-colors hover:bg-zinc-100 hover:text-zinc-900"
              aria-label="展开文件夹"
              title="展开文件夹"
            >
              ≡
            </button>
          )}
          <span className="min-w-0 flex-1 truncate px-1 text-sm font-semibold text-zinc-800">
            {listTitle}
          </span>
          <NewNoteButton folderId={selectedId === "all" ? null : selectedId} />
        </div>

        <div className="px-3 pt-2.5">
          <div className="flex items-center gap-2 rounded-lg border border-zinc-200 bg-zinc-50 px-2.5 py-1.5">
            <span className="text-zinc-400">🔍</span>
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="搜索笔记…"
              className="min-w-0 flex-1 bg-transparent text-sm text-zinc-800 placeholder-zinc-400 focus:outline-none"
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
          {filtered.length === 0 ? (
            <p className="px-2 py-6 text-center text-sm text-zinc-400">
              {q ? "没有匹配的笔记" : "还没有笔记"}
            </p>
          ) : (
            <NoteList
              notes={filtered}
              query={query.trim()}
              folders={folders}
              showFolder={selectedId === "all"}
            />
          )}
        </div>
      </div>

      {/* ===== 右：内容栏 ===== */}
      <div className="min-w-0 flex-1 md:overflow-y-auto">{children}</div>
    </div>
  );
}
