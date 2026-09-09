"use client";

import { useState } from "react";
import { SlidersHorizontal } from "lucide-react";
import type { ReactNode } from "react";

export type FilterSheetOption = {
  value: string;
  label: ReactNode;
  /** 非选中 chip 的自定义样式（语言 chip 想按语言色显示时用）。 */
  className?: string;
};

export type FilterSheetGroup = {
  label: string;
  /** 当前值；传 "all" 表示未筛选。 */
  value: string;
  options: FilterSheetOption[];
  onChange: (value: string) => void;
};

/**
 * 统一「筛选」入口：一个 chip 按钮（带选中数徽标）→ 下拉面板（桌面）/ 底部弹层（移动），
 * 里面放多组单选框组（语言 / 类型 / 状态…）。替代各页行内散落的语言 chips 与自写筛选下拉。
 */
export function FilterSheet({
  groups,
  triggerLabel = "筛选",
  className = "",
}: {
  groups: FilterSheetGroup[];
  triggerLabel?: string;
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  const activeCount = groups.filter((g) => g.value !== "all").length;

  return (
    <div className={`relative ${className}`}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className={`inline-flex items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-sm font-medium transition-colors ${
          activeCount > 0
            ? "border-teal-200 bg-teal-50 text-teal-700"
            : "border-zinc-200 bg-white text-zinc-600 hover:bg-zinc-50"
        }`}
      >
        <SlidersHorizontal className="h-4 w-4" />
        {triggerLabel}
        {activeCount > 0 && (
          <span className="flex h-4 min-w-4 items-center justify-center rounded-full bg-teal-600 px-1 text-[10px] font-semibold text-white">
            {activeCount}
          </span>
        )}
      </button>

      {open && (
        <>
          <div className="fixed inset-0 z-30" onClick={() => setOpen(false)} />
          <div className="absolute right-0 top-full z-40 mt-2 w-72 max-w-[calc(100vw-2rem)] rounded-2xl border border-zinc-200 bg-white p-3 shadow-xl">
            {groups.map((g) => (
              <div key={g.label} className="mb-3 last:mb-0">
                <p className="mb-1.5 text-xs font-medium text-zinc-400">{g.label}</p>
                <div className="flex flex-wrap gap-1.5">
                  <button
                    type="button"
                    onClick={() => g.onChange("all")}
                    className={chip(g.value === "all")}
                  >
                    全部
                  </button>
                  {g.options.map((o) => (
                    <button
                      key={o.value}
                      type="button"
                      onClick={() => g.onChange(o.value)}
                      className={
                        g.value === o.value
                          ? "rounded-full bg-teal-600 px-3 py-2 text-sm font-medium text-white"
                          : `rounded-full px-3 py-2 text-sm font-medium ${
                              o.className ?? "bg-zinc-100 text-zinc-600 hover:bg-zinc-200"
                            }`
                      }
                    >
                      {o.label}
                    </button>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  );
}

function chip(active: boolean) {
  return `rounded-full px-3 py-2 text-sm font-medium transition-colors ${
    active ? "bg-teal-600 text-white" : "bg-zinc-100 text-zinc-600 hover:bg-zinc-200"
  }`;
}
