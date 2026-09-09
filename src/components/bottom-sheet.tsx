"use client";

import { ReactNode, useEffect } from "react";

/**
 * 共享底部弹出面板：全屏遮罩 + 底部上滑圆角卡片，配合任意表单/内容使用。
 * 用于「新建文件夹 / 新建合集 / 新建分类」等需要从底部弹出的新建流程，
 * 避免内容在页面里随便一处突然出现（对齐苹果备忘录的底部抽屉交互）。
 * 面板内容滚动交给调用方；这里只提供外壳（遮罩、标题、关闭）。
 */
export function BottomSheet({
  open,
  onClose,
  title,
  children,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  children: ReactNode;
}) {
  // 打开时锁住背景滚动 + 记住滚动位置；关闭（含点遮罩/✕ 取消）后恢复。
  // 否则 iOS 键盘顶起标题栏后，取消弹层页面会残留上移、标题栏被顶出可视区。
  useEffect(() => {
    if (!open) return;
    const scrollY = window.scrollY;
    const prevOverflow = document.body.style.overflow;
    const prevPosition = document.body.style.position;
    const prevTop = document.body.style.top;
    document.body.style.overflow = "hidden";
    document.body.style.position = "fixed";
    document.body.style.top = `-${scrollY}px`;
    document.body.style.width = "100%";
    return () => {
      document.body.style.overflow = prevOverflow;
      document.body.style.position = prevPosition;
      document.body.style.top = prevTop;
      document.body.style.width = "";
      window.scrollTo(0, scrollY);
    };
  }, [open]);

  if (!open) return null;
  return (
    <>
      {/* 点击空白处关闭 */}
      <div className="fixed inset-0 z-50 bg-black/40" onClick={onClose} />
      <div className="fixed inset-x-0 bottom-0 z-50 mx-auto flex max-h-[80%] w-full max-w-lg flex-col rounded-t-2xl bg-white shadow-2xl">
        <div className="flex shrink-0 items-center justify-between gap-2 px-4 pb-2 pt-4">
          <h3 className="text-base font-semibold text-zinc-900">{title}</h3>
          <button
            onClick={onClose}
            className="shrink-0 rounded-lg px-2 py-1.5 text-sm text-zinc-400 transition-colors hover:bg-zinc-100 hover:text-zinc-600"
            aria-label="关闭"
          >
            ✕
          </button>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto px-4 pb-[calc(1rem+env(safe-area-inset-bottom))]">
          {children}
        </div>
      </div>
    </>
  );
}
