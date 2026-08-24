"use client";

import type { ReactNode } from "react";

export type SegmentOption<T extends string> = {
  value: T;
  label: ReactNode;
};

/**
 * iOS 分段控件（Segmented Control）：全宽铺满、两端均分的切换条。
 * 浅灰轨道 + 选中项白色浮起胶囊。用于视图 / 标签切换（闪卡按来源·按主题、笔记文件夹·全部、
 * 卡全部·生词·例句·语法、素材单条·合集…），替代各页 ad-hoc 的 toggle 链接，统一观感。
 */
export function SegmentedControl<T extends string>({
  options,
  value,
  onChange,
  className = "",
}: {
  options: SegmentOption<T>[];
  value: T;
  onChange: (value: T) => void;
  className?: string;
}) {
  return (
    <div
      className={`flex w-full items-stretch gap-0.5 rounded-xl bg-black/[0.05] p-1 ${className}`}
    >
      {options.map((opt) => {
        const active = opt.value === value;
        return (
          <button
            key={opt.value}
            type="button"
            onClick={() => onChange(opt.value)}
            className={`flex min-w-0 flex-1 items-center justify-center gap-1.5 rounded-lg px-3 py-1.5 text-sm font-medium transition-all ${
              active
                ? "bg-white text-teal-700 shadow-sm"
                : "text-zinc-500 hover:text-zinc-800"
            }`}
          >
            {opt.label}
          </button>
        );
      })}
    </div>
  );
}
