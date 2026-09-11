"use client";

import { createContext, useContext } from "react";

/**
 * 桌面端「导航栏 + 笔记文件夹栏」的共用收起状态。
 * AppShell 拥有状态并下发（点它顶部的 « / » 切换），笔记工作区读同一个值——
 * 于是两栏永远一起收起 / 一起展开，开关也只有一个、位置固定不跳。
 */
export type ShellCollapse = {
  collapsed: boolean;
  setCollapsed: (v: boolean) => void;
  toggle: () => void;
};

const noop = () => {};

// 默认展开（拿不到 Provider 时也按展开渲染，不至于把文件夹栏永久藏掉）。
const ShellCollapseContext = createContext<ShellCollapse>({
  collapsed: false,
  setCollapsed: noop,
  toggle: noop,
});

export const ShellCollapseProvider = ShellCollapseContext.Provider;

export function useShellCollapse(): ShellCollapse {
  return useContext(ShellCollapseContext);
}
