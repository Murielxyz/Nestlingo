"use client";

import { useOffline } from "next/offline";

/**
 * 断网时在顶部显示的一条提示。
 * 依赖 next.config.ts 里的 experimental.useOffline。
 */
export function OfflineBanner() {
  const isOffline = useOffline();
  if (!isOffline) return null;

  return (
    <div
      role="status"
      className="bg-amber-500 text-white text-center text-sm py-1.5 px-3 font-medium"
    >
      当前处于离线状态，操作会在联网后自动同步。
    </div>
  );
}
