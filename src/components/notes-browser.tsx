"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Search, FolderPlus, Folder, FileText } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { NewNoteButton } from "./new-note-button";
import { EmptyState } from "./empty-state";
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
}: {
  folders: FolderType[];
  notes: Note[];
}) {
  const router = useRouter();
  const [query, setQuery] = useState("");
  const [showNewFolder, setShowNewFolder] = useState(false);
  const [folderName, setFolderName] = useState("");
  const [menuFolderId, setMenuFolderId] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editingName, setEditingName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [tab, setTab] = useState<"folders" | "all">("folders");

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

  // 手机端：置顶「全部笔记」（展开显示所有笔记，含文件夹内的），下面列文件夹。
  // 点文件夹进它的笔记列表，点笔记进正文。
  const allNotes = notes.filter(matches);
  const unfiledNotes = notes.filter((n) => !n.folder_id && matches(n));
  const visibleFolders = folders.filter(
    (f) => !q || f.name.toLowerCase().includes(q)
  );

  async function createFolder() {
    const name = folderName.trim();
    if (!name) return;
    setBusy(true);
    setError(null);
    const supabase = createClient();
    const { error } = await supabase.from("folders").insert({ name });
    setBusy(false);
    if (error) {
      setError(error.message);
      return;
    }
    setFolderName("");
    setShowNewFolder(false);
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
        `删除文件夹「${folder.name}」？里面的笔记会保留，变成无文件夹。`
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

  const isEmpty = folders.length === 0 && notes.length === 0;

  return (
    <div>
      {/* 搜索框 + 新建笔记 / 新建文件夹 */}
      <div className="mb-4 flex items-center gap-2">
        <div className="flex flex-1 items-center gap-2 rounded-xl border border-zinc-200 bg-white px-3 py-2">
          <Search className="h-4 w-4 shrink-0 text-zinc-400" />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="搜索笔记内容…"
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
        <NewNoteButton />
        <button
          onClick={() => setShowNewFolder((v) => !v)}
          title="新建文件夹"
          aria-label="新建文件夹"
          className="rounded-lg border border-zinc-200 px-2.5 py-2 text-zinc-600 transition-colors hover:bg-zinc-50"
        >
          <FolderPlus className="h-4 w-4" />
        </button>
      </div>

      {showNewFolder && (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            createFolder();
          }}
          className="mb-4 flex gap-2"
        >
          <input
            value={folderName}
            onChange={(e) => setFolderName(e.target.value)}
            placeholder="新文件夹名"
            autoFocus
            className="flex-1 rounded-lg border border-zinc-300 px-3 py-2 text-sm focus:border-teal-500 focus:outline-none"
          />
          <button
            type="submit"
            disabled={busy}
            className="rounded-lg bg-teal-600 px-3 py-2 text-sm font-semibold text-white hover:bg-teal-700 disabled:opacity-60"
          >
            确定
          </button>
        </form>
      )}

      {error && <p className="mb-4 text-sm text-red-600">{error}</p>}

      {isEmpty ? (
        <EmptyState
          icon={<FileText className="h-10 w-10" />}
          title="还没有笔记"
          description="点「新建笔记」新建，或「新建文件夹」先建个文件夹。"
        />
      ) : (
        <div className="space-y-1.5">
          {/* 分段切换：文件夹优先（手机端避免「全部笔记」把文件夹挤到最下面） */}
          <div className="mb-2 grid grid-cols-2 gap-1 rounded-xl bg-zinc-100 p-1">
            <button
              onClick={() => setTab("folders")}
              className={`rounded-lg py-1.5 text-sm font-semibold transition-colors ${
                tab === "folders"
                  ? "bg-white text-zinc-900 shadow-sm"
                  : "text-zinc-500 hover:text-zinc-700"
              }`}
            >
              文件夹
            </button>
            <button
              onClick={() => setTab("all")}
              className={`rounded-lg py-1.5 text-sm font-semibold transition-colors ${
                tab === "all"
                  ? "bg-white text-zinc-900 shadow-sm"
                  : "text-zinc-500 hover:text-zinc-700"
              }`}
            >
              全部笔记
            </button>
          </div>

          {tab === "all" ? (
            allNotes.length === 0 ? (
              <p className="px-3 py-3 text-sm text-zinc-400">
                {q ? "没有匹配的笔记" : "还没有笔记"}
              </p>
            ) : (
              <NoteList
                notes={allNotes}
                query={query.trim()}
                folders={folders}
                showFolder
              />
            )
          ) : (
            <>
              {/* 文件夹（平铺，点击进入它的笔记列表） */}
              {visibleFolders.length > 0 && (
                <p className="px-1 pt-1 text-xs font-medium text-zinc-400">文件夹</p>
              )}
          {visibleFolders.map((folder) => {
            const count = noteCountByFolder.get(folder.id) ?? 0;
            if (editingId === folder.id) {
              return (
                <div
                  key={folder.id}
                  className="flex items-center gap-1.5 rounded-lg border border-zinc-200 bg-white px-3 py-2"
                >
                  <Folder className="h-4 w-4 shrink-0 text-zinc-400" />
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
              <div
                key={folder.id}
                className="flex items-center gap-0.5 rounded-lg border border-zinc-200 bg-white transition-colors hover:border-teal-300"
              >
                <Link
                  href={`/notes/folder/${folder.id}`}
                  className="flex min-w-0 flex-1 items-center gap-2 px-3 py-2.5"
                >
                  <Folder className="h-4 w-4 shrink-0 text-zinc-400" />
                  <span className="min-w-0 flex-1 truncate text-sm font-semibold text-zinc-800">
                    {folder.name}
                  </span>
                  <span className="text-xs text-zinc-400">{count}</span>
                </Link>

                {/* ⋯ 菜单：重命名 / 删除 */}
                <div className="relative">
                  <button
                    onClick={() =>
                      setMenuFolderId((id) => (id === folder.id ? null : folder.id))
                    }
                    className="rounded px-2 py-1 text-zinc-400 transition-colors hover:bg-zinc-100 hover:text-zinc-700"
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
              </div>
            );
          })}

              {/* 无文件夹的笔记 */}
              {unfiledNotes.length > 0 && (
                <>
                  <p className="px-1 pt-3 text-xs font-medium text-zinc-400">
                    无文件夹
                  </p>
                  <NoteList
                    notes={unfiledNotes}
                    query={query.trim()}
                    folders={folders}
                  />
                </>
              )}
            </>
          )}

        </div>
      )}
    </div>
  );
}

export function NoteList({
  notes,
  query,
  folders,
  showFolder = false,
}: {
  notes: Note[];
  query: string;
  folders: FolderType[];
  showFolder?: boolean;
}) {
  const router = useRouter();
  const [menuNoteId, setMenuNoteId] = useState<string | null>(null);
  const [movingNoteId, setMovingNoteId] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editingTitle, setEditingTitle] = useState("");

  async function removeNote(note: Note) {
    if (!window.confirm(`删除笔记「${note.title}」？里面的闪卡也会一起删除。`)) {
      return;
    }
    const supabase = createClient();
    const { error } = await supabase.from("notes").delete().eq("id", note.id);
    if (error) return;
    setMenuNoteId(null);
    router.refresh();
  }

  async function moveNote(note: Note, folderId: string | null) {
    const supabase = createClient();
    const { error } = await supabase
      .from("notes")
      .update({ folder_id: folderId })
      .eq("id", note.id);
    if (error) return;
    setMovingNoteId(null);
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
    <ul className="space-y-1.5">
      {notes.map((note) => (
        <li key={note.id}>
          {editingId === note.id ? (
            <div className="flex items-center gap-1.5 rounded-lg border border-zinc-200 bg-white px-3 py-2">
              <input
                value={editingTitle}
                onChange={(e) => setEditingTitle(e.target.value)}
                className="min-w-0 flex-1 rounded-lg border border-zinc-300 px-2 py-1 text-sm focus:border-teal-500 focus:outline-none"
                autoFocus
                onKeyDown={(e) => {
                  if (e.key === "Enter") saveNoteTitle(note.id);
                  if (e.key === "Escape") setEditingId(null);
                }}
              />
              <button
                onClick={() => saveNoteTitle(note.id)}
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
          ) : (
            <div className="flex items-center gap-0.5 rounded-lg border border-zinc-200 bg-white transition-colors hover:border-teal-300">
              <Link href={`/notes/${note.id}`} className="min-w-0 flex-1 px-3 py-2">
                <p className="truncate text-sm font-medium text-zinc-800">
                  <Highlight text={note.title} q={query} />
                </p>
                {showFolder && note.folder_id && (
                  <p className="mt-0.5 flex items-center gap-1 truncate text-xs text-teal-500">
                    <Folder className="h-3 w-3 shrink-0" />
                    <span className="truncate">
                      {folders.find((f) => f.id === note.folder_id)?.name ?? ""}
                    </span>
                  </p>
                )}
                {note.content_text && (
                  <p className="mt-0.5 truncate text-sm text-zinc-500">
                    <Snippet text={note.content_text} q={query} />
                  </p>
                )}
              </Link>

              {/* ⋯ 菜单：重命名 / 删除 */}
              <div className="relative">
                <button
                  onClick={() =>
                    setMenuNoteId((id) => (id === note.id ? null : note.id))
                  }
                  className="rounded px-2 py-1 text-zinc-400 transition-colors hover:bg-zinc-100 hover:text-zinc-700"
                  aria-label="笔记操作"
                >
                  ⋯
                </button>
                {menuNoteId === note.id && (
                  <>
                    <div
                      className="fixed inset-0 z-30"
                      onClick={() => {
                        setMenuNoteId(null);
                        setMovingNoteId(null);
                      }}
                    />
                    {movingNoteId === note.id ? (
                      <div className="absolute right-0 z-40 mt-1 max-h-64 w-44 overflow-y-auto rounded-xl border border-zinc-200 bg-white p-1 shadow-lg">
                        <p className="px-2.5 py-1.5 text-xs font-medium text-zinc-400">
                          移动到
                        </p>
                        <button
                          onClick={() => moveNote(note, null)}
                          className={`flex w-full rounded-lg px-2.5 py-1.5 text-left text-sm hover:bg-zinc-100 ${
                            note.folder_id === null ? "text-teal-600" : "text-zinc-700"
                          }`}
                        >
                          无文件夹
                        </button>
                        {folders.map((f) => (
                          <button
                            key={f.id}
                            onClick={() => moveNote(note, f.id)}
                            className={`flex w-full rounded-lg px-2.5 py-1.5 text-left text-sm hover:bg-zinc-100 ${
                              note.folder_id === f.id ? "text-teal-600" : "text-zinc-700"
                            }`}
                          >
                            {f.name}
                          </button>
                        ))}
                      </div>
                    ) : (
                      <div className="absolute right-0 z-40 mt-1 w-28 rounded-xl border border-zinc-200 bg-white p-1 shadow-lg">
                        <button
                          onClick={() => {
                            setEditingId(note.id);
                            setEditingTitle(note.title);
                            setMenuNoteId(null);
                          }}
                          className="flex w-full rounded-lg px-2.5 py-1.5 text-left text-sm text-zinc-700 hover:bg-zinc-100"
                        >
                          重命名
                        </button>
                        <button
                          onClick={() => setMovingNoteId(note.id)}
                          className="flex w-full rounded-lg px-2.5 py-1.5 text-left text-sm text-zinc-700 hover:bg-zinc-100"
                        >
                          移动
                        </button>
                        <button
                          onClick={() => removeNote(note)}
                          className="flex w-full rounded-lg px-2.5 py-1.5 text-left text-sm text-red-600 hover:bg-red-50"
                        >
                          删除
                        </button>
                      </div>
                    )}
                  </>
                )}
              </div>
            </div>
          )}
        </li>
      ))}
    </ul>
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
