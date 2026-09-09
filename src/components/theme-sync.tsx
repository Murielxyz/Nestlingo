"use client";

import { useEffect } from "react";
import { STORAGE_KEY, THEMES, type ThemeKey } from "./theme-picker";

/**
 * 全局主题同步：挂载时把 localStorage 里的主题色重新应用到 <html data-theme>。
 * 首屏已由 layout 内联脚本设过一次（避免闪回默认色）；这里做 hydration 后的兜底——
 * 移动端关闭重开时内联脚本偶发没生效（app 回到默认绿、但设置页仍显示已选色），
 * 靠这个全局组件在每次进入页面时把主题拉回来。只读不写，不覆盖用户新选的值。
 */
export function ThemeSync() {
  useEffect(() => {
    try {
      const v = localStorage.getItem(STORAGE_KEY);
      const key = THEMES.some((t) => t.key === v) ? (v as ThemeKey) : "sage";
      document.documentElement.setAttribute("data-theme", key);
    } catch {
      // localStorage 不可用就忽略，保持默认主题。
    }
  }, []);

  return null;
}
