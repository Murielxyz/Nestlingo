import { listFolders, listNotes, friendlyQueryError } from "@/lib/supabase/queries";
import { NotesBrowser } from "@/components/notes-browser";
import type { Folder, Note } from "@/lib/types";

export default async function NotesPage() {
  let folders: Folder[] = [];
  let notes: Note[] = [];
  let error: string | null = null;

  try {
    [folders, notes] = await Promise.all([listFolders(), listNotes()]);
  } catch (err) {
    error = friendlyQueryError(err);
  }

  return (
    <>
      {/* 桌面端：三栏的侧栏（文件夹 + 笔记列表）由 layout 渲染，这里只放个空状态提示。 */}
      <div className="hidden h-full flex-col items-center justify-center text-center text-zinc-400 md:flex">
        <p className="text-4xl">📝</p>
        <p className="mt-3 text-base font-medium text-zinc-500">选择一篇笔记</p>
        <p className="mt-1 text-sm">或在左侧新建 / 搜索</p>
      </div>

      {/* 手机端：文件夹 + 笔记列表（正常点开进入对应页面）。 */}
      <div className="px-4 py-6 md:hidden">
        <header className="mb-6">
          <h1 className="text-2xl font-bold text-zinc-900">笔记</h1>
        </header>

        {error ? (
          <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
            {error}
          </div>
        ) : (
          <NotesBrowser folders={folders} notes={notes} />
        )}
      </div>
    </>
  );
}
