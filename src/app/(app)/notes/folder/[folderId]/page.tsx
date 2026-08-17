import { notFound } from "next/navigation";
import { listFolders, listNotes, friendlyQueryError } from "@/lib/supabase/queries";
import { MobileFolderView } from "@/components/mobile-folder-view";

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

  const folder = folders.find((f) => f.id === folderId);
  if (!folder) notFound();

  const folderNotes = notes.filter((n) => n.folder_id === folderId);

  return (
    <MobileFolderView folder={folder} notes={folderNotes} folders={folders} />
  );
}
