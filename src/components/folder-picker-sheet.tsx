"use client";

import { useMemo, useState } from "react";
import { Folder, FileX2, X } from "lucide-react";
import { flattenFolderTree } from "@/lib/folders";
import type { Folder as FolderType } from "@/lib/types";

/**
 * 「收录到文件夹 / 移动到」底部弹出文件夹选择器（借鉴苹果备忘录）：文件夹多时不再把
 * 列表塞进 ⋯ 菜单拉很长，而是点击后从底部滑出一张文件夹单，可滚动、带层级缩进。
 * 选中即回调 onPick(folderId)，取消用 onClose。新建文件夹内联在底部。
 */
export function FolderPickerSheet({
  open,
  onClose,
  folders,
  currentFolderId = null,
  title = "移动到",
  onPick,
  onCreateFolder,
  showUnfiled = true,
}: {
  open: boolean;
  onClose: () => void;
  folders: FolderType[];
  /** 当前所在文件夹（高亮 ✓；null = 无文件夹；undefined = 不参与选中态）。 */
  currentFolderId?: string | null;
  title?: string;
  onPick: (folderId: string | null) => void;
  /** 传了才渲染「＋ 新建文件夹」入口。 */
  onCreateFolder?: (name: string) => Promise<void> | void;
  /** 是否展示「无文件夹」条目。 */
  showUnfiled?: boolean;
}) {
  const [newFolderName, setNewFolderName] = useState("");
  const [creating, setCreating] = useState(false);
  const flat = useMemo(() => flattenFolderTree(folders), [folders]);

  if (!open) return null;

  async function submitNewFolder() {
    const name = newFolderName.trim();
    if (!name || !onCreateFolder || creating) return;
    setCreating(true);
    try {
      await onCreateFolder(name);
    } finally {
      setCreating(false);
      setNewFolderName("");
    }
  }

  return (
    <>
      {/* 背景遮罩：点击关闭 */}
      <div className="fixed inset-0 z-50 bg-black/40" onClick={onClose} />
      {/* 底部弹层（从底部滑出，向上铺开可滚动） */}
      <div className="fixed inset-x-0 bottom-0 z-50 mx-auto flex max-h-[72%] w-full max-w-lg flex-col rounded-t-2xl bg-white shadow-2xl">
        {/* 弹层把手 + 标题 + 关闭 */}
        <div className="flex items-center gap-2 px-4 pb-2 pt-3">
          <span className="h-1 w-9 rounded-full bg-zinc-200" />
        </div>
        <div className="flex items-center gap-2 border-b border-zinc-100 px-4 pb-3 pt-1">
          <h2 className="flex-1 truncate text-base font-semibold text-zinc-900">{title}</h2>
          <button
            onClick={onClose}
            aria-label="关闭"
            className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-lg text-zinc-400 transition-colors hover:bg-zinc-100 hover:text-zinc-700"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        {/* 文件夹单（可滚动） */}
        <div className="min-h-0 flex-1 overflow-y-auto px-2 py-2">
          {showUnfiled && (
            <button
              onClick={() => onPick(null)}
              className={`flex w-full items-center gap-2 rounded-lg px-2.5 py-2.5 text-left text-sm transition-colors ${
                currentFolderId === null ? "bg-teal-50 text-teal-700" : "text-zinc-700 hover:bg-zinc-100"
              }`}
            >
              <FileX2 className="h-4 w-4 shrink-0 text-zinc-400" />
              <span className="min-w-0 flex-1 truncate">无文件夹</span>
              {currentFolderId === null && <span className="text-teal-600">✓</span>}
            </button>
          )}
          {flat.map(({ folder: f, depth }) => (
            <button
              key={f.id}
              onClick={() => onPick(f.id)}
              style={{ paddingLeft: 10 + depth * 16 }}
              className={`flex w-full items-center gap-2 rounded-lg py-2.5 pr-2.5 text-left text-sm transition-colors ${
                currentFolderId === f.id ? "bg-teal-50 text-teal-700" : "text-zinc-700 hover:bg-zinc-100"
              }`}
            >
              <Folder className="h-4 w-4 shrink-0 text-teal-500" strokeWidth={2.25} />
              <span className="min-w-0 flex-1 truncate">{f.name}</span>
              {currentFolderId === f.id && <span className="text-teal-600">✓</span>}
            </button>
          ))}

          {folders.length === 0 && !showUnfiled && (
            <p className="px-3 py-6 text-center text-sm text-zinc-400">还没有文件夹。</p>
          )}

          {/* 新建文件夹（内联） */}
          {onCreateFolder && (
            <div className="mt-1 flex items-center gap-2 rounded-lg border border-zinc-200 px-2.5 py-1.5">
              <input
                value={newFolderName}
                onChange={(e) => setNewFolderName(e.target.value)}
                placeholder="新文件夹名"
                onKeyDown={(e) => {
                  if (e.key === "Enter") submitNewFolder();
                  if (e.key === "Escape") onClose();
                }}
                className="min-w-0 flex-1 bg-transparent text-sm placeholder:text-sm focus:outline-none"
              />
              <button
                onClick={submitNewFolder}
                disabled={creating || !newFolderName.trim()}
                className="shrink-0 text-sm font-medium text-teal-600 hover:text-teal-700 disabled:opacity-50"
              >
                {creating ? "创建中…" : "创建"}
              </button>
            </div>
          )}
        </div>
      </div>
    </>
  );
}
