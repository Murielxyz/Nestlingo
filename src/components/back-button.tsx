"use client";

import { useRouter } from "next/navigation";
import type { ReactNode } from "react";

/**
 * 「返回」按钮：优先走浏览器后退（回到进入本页的那个原处），历史不足以后退时（直接打开链接 / 新标签）
 * 才回退跳到 fallback。这样避免了「从 A 点进背诵 → 返回用 Link 推一个 A 进历史 → 再返回又绕回背诵」的来回循环。
 * 默认样式是顶栏的「←」箭头；也可以传 className/children 做成别的按钮（如测试结束的「返回」）。
 */
export function BackButton({
  fallback,
  forceFallback = false,
  className = "rounded-lg px-2 py-1 text-lg text-zinc-500 transition-colors hover:bg-zinc-100 hover:text-zinc-800",
  ariaLabel = "返回",
  children = "←",
}: {
  fallback: string;
  /** 总是指向 fallback（返回固定回到本页的归处），不看浏览器历史。 */
  forceFallback?: boolean;
  className?: string;
  ariaLabel?: string;
  children?: ReactNode;
}) {
  const router = useRouter();
  return (
    <button
      type="button"
      onClick={() => {
        if (forceFallback || window.history.length <= 1) router.push(fallback);
        else router.back();
      }}
      className={className}
      aria-label={ariaLabel}
    >
      {children}
    </button>
  );
}
