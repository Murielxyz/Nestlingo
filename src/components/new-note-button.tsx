"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";

/** 「新建笔记」：先在数据库里建一条空笔记，再跳转到它的编辑页。传 folderId 则直接归到该文件夹。 */
export function NewNoteButton({ folderId }: { folderId?: string | null }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);

  async function createNote() {
    setBusy(true);
    const supabase = createClient();
    const { data, error } = await supabase
      .from("notes")
      .insert({ title: "无标题笔记", folder_id: folderId ?? null })
      .select("id")
      .single();
    setBusy(false);
    if (error || !data) return;
    router.push(`/notes/${data.id}`);
  }

  return (
    <button
      onClick={createNote}
      disabled={busy}
      title="新建笔记"
      className="rounded-lg border border-zinc-200 px-2.5 py-2 text-sm text-zinc-600 transition-colors hover:bg-zinc-50 disabled:opacity-60"
    >
      {busy ? "…" : "📝＋"}
    </button>
  );
}
