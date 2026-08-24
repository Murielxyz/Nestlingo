import { listFolders, listNotes, friendlyQueryError } from "@/lib/supabase/queries";
import { NotesBrowser } from "@/components/notes-browser";
import { NewNoteButton } from "@/components/new-note-button";
import { FileText } from "lucide-react";
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
      {/* 桌面端：三栏的侧栏（文件夹 + 笔记列表）由 layout 渲染，这里只放个空状态提示 + 新建按钮。 */}
      <div className="hidden h-full flex-col items-center justify-center text-center text-zinc-400 md:flex">
        <FileText className="h-10 w-10 text-zinc-300" />
        <p className="mt-3 text-base font-medium text-zinc-500">选择一篇笔记</p>
        <p className="mt-1 text-sm">或点下面直接新建一篇</p>
        <div className="mt-4">
          <NewNoteButton variant="primary" />
        </div>
      </div>

      {/* 手机端：文件夹 + 笔记列表（正常点开进入对应页面）。 */}
      <div className="md:hidden">
        {/* 标题吸顶（与全局顶部安全区对齐），不再随内容滚动，也不再因 py-6 留下顶部空隙。 */}
        <header className="sticky top-0 z-20 border-b border-zinc-200 bg-white px-4 pb-3 pt-[calc(env(safe-area-inset-top)+0.75rem)]">
          <h1 className="text-2xl font-bold text-zinc-900">笔记</h1>
        </header>

        <div className="px-4 py-4">
          {error ? (
            <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
              {error}
            </div>
          ) : (
            <NotesBrowser folders={folders} notes={notes} />
          )}
        </div>
      </div>
    </>
  );
}
