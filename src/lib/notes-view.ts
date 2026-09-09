"use client";

import { useEffect, useState } from "react";

export type NotesView = "list" | "grid";

const KEY = "nestlingo:notes-view";

/**
 * 笔记的列表 / 网格视图，跨页面记住选择：
 * 打开时读一次 localStorage，切换就写回——返回重进仍是上次那一格，不再每次重置成「列表」。
 * 用 useEffect 在挂载后读取（而不是初始化就同步读 window），避免 SSR 水合不一致。
 * 所有用到视图切换的页共用同一个 key，因此文件夹页 / 全部笔记页的视图也彼此打通。
 */
export function useNotesView() {
  const [view, setView] = useState<NotesView>("list");

  useEffect(() => {
    if (typeof window === "undefined") return;
    try {
      const saved = window.localStorage.getItem(KEY);
      if (saved === "grid" || saved === "list") setView(saved);
    } catch {
      /* 忽略（隐私模式 / 存储进满） */
    }
  }, []);

  const changeView = (v: NotesView) => {
    setView(v);
    try {
      window.localStorage.setItem(KEY, v);
    } catch {
      /* 忽略 */
    }
  };

  return [view, changeView] as const;
}
