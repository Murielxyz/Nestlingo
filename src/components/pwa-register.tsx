"use client";

import { useEffect } from "react";

/**
 * 在生产环境注册 Service Worker（离线缓存）。
 * 开发环境不注册，避免缓存干扰热更新。
 */
export function PwaRegister() {
  useEffect(() => {
    if (
      typeof window !== "undefined" &&
      "serviceWorker" in navigator &&
      process.env.NODE_ENV === "production"
    ) {
      navigator.serviceWorker.register("/sw.js").catch(() => {
        // 注册失败不阻塞应用
      });
    }
  }, []);

  return null;
}
