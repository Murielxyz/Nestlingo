"use client";

import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { MoreHorizontal } from "lucide-react";

export type RowMenuItem = {
  label: string;
  onClick: () => void;
  danger?: boolean;
};

/**
 * 行内「⋯」更多菜单：点开一个小下拉，点外面自动收起。
 * 用 portal 挂到 body + fixed 定位，并按住触发钮的部位夹在视口内：
 * - 避开父容器（合集卡是 overflow-hidden，会把这个下拉裁掉）—— portal 逃出容器；
 * - 行在列表底部时自动向上翻、贴到可视边缘，不再「弹出屏幕」。
 */
export function RowMenu({ items }: { items: RowMenuItem[] }) {
  const [open, setOpen] = useState(false);
  const btnRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  // 位置：相对视口（fixed）。先量菜单之后才置位；未置位时菜单仍挂载但不可见，避免闪烁。
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null);

  // 点外面收起（菜单自身不算，点了菜单项也要正常执行）。
  useEffect(() => {
    if (!open) return;
    function onDoc(e: MouseEvent) {
      if (
        btnRef.current &&
        !btnRef.current.contains(e.target as Node) &&
        menuRef.current &&
        !menuRef.current.contains(e.target as Node)
      ) {
        setOpen(false);
      }
    }
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, [open]);

  // 打开后量按钮/菜单尺寸，把菜单夹在视口内：底部越界就向上翻、左右贴边防越界。
  useEffect(() => {
    if (!open) return;
    function place() {
      const btn = btnRef.current;
      const menu = menuRef.current;
      if (!btn || !menu) return;
      const r = btn.getBoundingClientRect();
      const mw = menu.offsetWidth;
      const mh = menu.offsetHeight;
      const gap = 6;
      let top = r.bottom + gap;
      if (top + mh > window.innerHeight - 8) top = Math.max(8, r.top - mh - gap);
      let left = r.right - mw;
      if (left < 8) left = 8;
      if (left + mw > window.innerWidth - 8) left = window.innerWidth - mw - 8;
      setPos({ top, left });
    }
    place();
    // 滚/缩窗口时跟着按钮走，不悬空、不被裁。
    window.addEventListener("resize", place);
    window.addEventListener("scroll", place, true);
    return () => {
      window.removeEventListener("resize", place);
      window.removeEventListener("scroll", place, true);
    };
  }, [open]);

  return (
    <>
      <button
        ref={btnRef}
        onClick={() => setOpen((o) => !o)}
        aria-label="更多操作"
        className="inline-flex h-7 w-7 items-center justify-center rounded-lg text-zinc-400 transition-colors hover:bg-zinc-100 hover:text-zinc-700"
      >
        <MoreHorizontal className="h-4 w-4" />
      </button>
      {open &&
        createPortal(
          <div
            ref={menuRef}
            style={{ top: pos?.top ?? 0, left: pos?.left ?? 0 }}
            className={`fixed z-50 w-40 overflow-hidden rounded-xl border border-zinc-200 bg-white py-1 shadow-lg ${
              pos ? "" : "invisible"
            }`}
          >
            {items.map((it) => (
              <button
                key={it.label}
                onClick={() => {
                  setOpen(false);
                  it.onClick();
                }}
                className={`block w-full px-3 py-2 text-left text-sm transition-colors ${
                  it.danger ? "text-red-600 hover:bg-red-50" : "text-zinc-700 hover:bg-zinc-50"
                }`}
              >
                {it.label}
              </button>
            ))}
          </div>,
          document.body
        )}
    </>
  );
}
