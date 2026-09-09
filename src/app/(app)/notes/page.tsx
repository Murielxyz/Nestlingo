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

      {/* 手机端：NotesBrowser 自包含（头部 + 内容滚动都在组件内），直接整屏一个。 */}
      <NotesBrowser folders={folders} notes={notes} queryError={error} />
    </>
  );
}
