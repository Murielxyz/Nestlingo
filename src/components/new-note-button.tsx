"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { FilePlus2 } from "lucide-react";

/** 「新建笔记」：先在数据库里建一条空笔记，再跳转到它的编辑页。传 folderId 则直接归到该文件夹。 */
export function NewNoteButton({
  folderId,
  variant = "icon",
}: {
  folderId?: string | null;
  variant?: "icon" | "primary";
}) {
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

  // 空状态里用的大号「新建笔记」按钮（图标 + 文字）。
  if (variant === "primary") {
    return (
      <button
        onClick={createNote}
        disabled={busy}
        className="btn-brand inline-flex items-center gap-1.5"
      >
        <FilePlus2 className="h-4 w-4" />
        {busy ? "创建中…" : "新建笔记"}
      </button>
    );
  }

  // 侧栏 / 手机端顶部的图标按钮。
  return (
    <button
      onClick={createNote}
      disabled={busy}
      title="新建笔记"
      aria-label="新建笔记"
      className="rounded-lg border border-zinc-200 px-2.5 py-2 text-zinc-600 transition-colors hover:bg-zinc-50 disabled:opacity-60"
    >
      <FilePlus2 className="h-4 w-4" />
    </button>
  );
}
