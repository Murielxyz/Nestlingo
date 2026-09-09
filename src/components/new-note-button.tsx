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
  variant?: "icon" | "primary" | "ghost";
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

  // 侧栏 / 手机端工具栏的图标按钮（带描边，和旁边的搜索框 / 新建文件夹按钮一致）。
  if (variant === "icon") {
    return (
      <button
        onClick={createNote}
        disabled={busy}
        title="新建笔记"
        aria-label="新建笔记"
        className="inline-flex h-9 shrink-0 items-center justify-center rounded-lg border border-zinc-200 px-1.5 text-zinc-600 transition-colors hover:bg-zinc-50 disabled:opacity-60"
      >
        <FilePlus2 className="h-5 w-5" />
      </button>
    );
  }

  // 次级页导航条上的「+」操作：和返回箭头同体量、无色块描边，与左侧标题协调（不顶一格边框盒）。
  return (
    <button
      onClick={createNote}
      disabled={busy}
      title="新建笔记"
      aria-label="新建笔记"
      className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-lg text-teal-600 transition-colors hover:bg-teal-50 disabled:opacity-60"
    >
      <FilePlus2 className="h-5 w-5" />
    </button>
  );
}
