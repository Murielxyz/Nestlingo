import { notFound } from "next/navigation";
import { listFolders, listNotes, friendlyQueryError } from "@/lib/supabase/queries";
import { MobileFolderView } from "@/components/mobile-folder-view";
import type { Folder as FolderType } from "@/lib/types";

export default async function FolderPage({
  params,
}: {
  params: Promise<{ folderId: string }>;
}) {
  const { folderId } = await params;

  let folders: Awaited<ReturnType<typeof listFolders>> = [];
  let notes: Awaited<ReturnType<typeof listNotes>> = [];
  try {
    [folders, notes] = await Promise.all([listFolders(), listNotes()]);
  } catch (err) {
    return (
      <div className="px-4 py-6">
        <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
          {friendlyQueryError(err)}
        </div>
      </div>
    );
  }

  // 「未分类」伪文件夹：收拢所有无文件夹的笔记，走和普通文件夹一样的视角。
  // 传全部 notes 进去，由 MobileFolderView 自己按子树 / 未分类收拢，展示「属于这个文件夹（含次级）的所有笔记」。
  if (folderId === "unfiled") {
    const pseudoFolder = {
      id: "unfiled",
      name: "未分类",
      parent_id: null,
      position: -1,
      color: null,
      created_at: "",
      updated_at: "",
    } as FolderType;
    return <MobileFolderView folder={pseudoFolder} notes={notes} folders={folders} />;
  }

  // 「全部笔记」伪文件夹：收纳整个库（含未归档的），走和普通文件夹一样的视角。
  if (folderId === "all") {
    const pseudoFolder = {
      id: "all",
      name: "全部笔记",
      parent_id: null,
      position: -1,
      color: null,
      created_at: "",
      updated_at: "",
    } as FolderType;
    return <MobileFolderView folder={pseudoFolder} notes={notes} folders={folders} />;
  }

  const folder = folders.find((f) => f.id === folderId);
  if (!folder) notFound();

  return <MobileFolderView folder={folder} notes={notes} folders={folders} />;
}
