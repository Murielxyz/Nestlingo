import { notFound } from "next/navigation";
import { getNote, listFolders, listCards } from "@/lib/supabase/queries";
import { NoteEditor } from "@/components/note-editor";

export default async function NotePage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;

  const note = await getNote(id);
  if (!note) notFound();

  const folders = await listFolders();

  // 这篇笔记下已有的闪卡数：悬浮「闪卡」按钮据此决定是「转成闪卡」还是「展示闪卡」。
  // cards 表还没建时降级为 0，不打断打开笔记。
  let cardCount = 0;
  try {
    cardCount = (await listCards(id)).length;
  } catch {
    cardCount = 0;
  }

  // 文件夹已合并进笔记页，返回一律回「笔记」主页。
  const backHref = "/notes";

  return (
    <NoteEditor
      note={note}
      folders={folders}
      backHref={backHref}
      cardCount={cardCount}
    />
  );
}
