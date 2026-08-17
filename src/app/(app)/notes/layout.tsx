import { listFolders, listNotes, friendlyQueryError } from "@/lib/supabase/queries";
import { NotesWorkspace } from "@/components/notes-workspace";
import type { Folder, Note } from "@/lib/types";

/**
 * 笔记区 layout：抓一遍文件夹 + 笔记，交给 NotesWorkspace 做三栏（桌面）/ 堆叠（手机）。
 * 桌面端的三栏侧栏在这里渲染，手机端则由各页面自己渲染列表/正文。
 */
export default async function NotesLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  let folders: Folder[] = [];
  let notes: Note[] = [];
  let error: string | null = null;

  try {
    [folders, notes] = await Promise.all([listFolders(), listNotes()]);
  } catch (err) {
    error = friendlyQueryError(err);
  }

  if (error) {
    return (
      <div className="mx-auto max-w-5xl px-4 py-6 md:px-8">
        <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
          {error}
        </div>
      </div>
    );
  }

  return (
    <NotesWorkspace folders={folders} notes={notes}>
      {children}
    </NotesWorkspace>
  );
}
