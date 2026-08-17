"use client";

import { useRouter } from "next/navigation";

/**
 * 原路返回按钮：退回上一页（历史栈），没有历史时兜底回到 /cards。
 * 用于「卡片页 → 笔记闪卡页」这种多入口页面，返回方向跟着来路走。
 */
export function BackButton({ label = "← 返回" }: { label?: string }) {
  const router = useRouter();

  function goBack() {
    if (typeof window !== "undefined" && window.history.length > 1) {
      router.back();
    } else {
      router.push("/cards");
    }
  }

  return (
    <button
      onClick={goBack}
      className="text-sm text-zinc-500 transition-colors hover:text-zinc-700"
    >
      {label}
    </button>
  );
}
