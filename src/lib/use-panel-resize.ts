"use client";

import { useEffect, useState } from "react";

function clamp(v: number, min: number, max: number) {
  return Math.min(Math.max(v, min), max);
}

/**
 * 面板可拖拽调整宽度（跨页面记住宽度）。
 *
 * 桌面端侧栏 / 分栏列加一条垂直拖拽把手，按住往左/右拖就能改宽度；
 * 拖完写进 localStorage，刷新后仍是上次的宽度。照 `useNotesView` 的约定用
 * `nestlingo:` 前缀 key + 挂载后 useEffect 读（hydration 安全）+ try/catch。
 *
 * 拖拽方向规则：**把手永远跟手**（拖到哪边界就到哪）。
 * - `flip = true`（左侧栏，把手在面板右缘）：往右拖 → 边界往右 → 变宽，`width = startW + (clientX - startX)`
 * - `flip = false`（右侧栏，把手在面板左缘）：往右拖 → 边界往右 → 变窄，`width = startW + (startX - clientX)`
 *
 * 拖拽期间给 body 关掉文本选中，避免把侧栏文字刷成一片蓝；松手后恢复。
 */
export function usePanelResize(opts: {
  key: string;
  initial: number;
  min: number;
  max: number;
  flip?: boolean;
}) {
  const { key, initial, min, max, flip = false } = opts;
  const [width, setWidth] = useState(initial);

  useEffect(() => {
    if (typeof window === "undefined") return;
    try {
      const saved = window.localStorage.getItem(key);
      if (saved !== null) {
        const n = Number(saved);
        if (Number.isFinite(n)) setWidth(clamp(n, min, max));
      }
    } catch {
      /* 忽略（隐私模式 / 存储进满） */
    }
  }, [key, min, max]);

  function onPointerDown(e: React.PointerEvent) {
    e.preventDefault();
    const startX = e.clientX;
    const startW = width;
    const dir = flip ? -1 : 1; // flip=true：左栏往右拖变宽(clx 增大→宽度增)；flip=false：右栏往右拖变窄(clx 增大→宽度减)
    let latest = startW;
    const bodyEl = document.body;
    const prevUserSelect = bodyEl.style.userSelect;
    bodyEl.style.userSelect = "none";

    const onMove = (ev: PointerEvent) => {
      latest = clamp(startW + dir * (startX - ev.clientX), min, max);
      setWidth(latest);
    };
    const onUp = () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      bodyEl.style.userSelect = prevUserSelect;
      try {
        window.localStorage.setItem(key, String(latest));
      } catch {
        /* 忽略 */
      }
    };

    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
  }

  return { width, onPointerDown };
}
