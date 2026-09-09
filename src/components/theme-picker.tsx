"use client";

// 主题色选择（设置页「外观」）：几套莫兰迪低饱和配色，点一下切换全站主色。
// 存 localStorage（每设备独立，跟笔记视图/背诵进度一个套路），由 layout 内联脚本在首屏前设 data-theme。
// 色相与 globals.css 里 :root[data-theme="…"] { --brand-hue } 一一对应。

import { useEffect, useState } from "react";

export const THEMES = [
  { key: "sage", label: "鼠尾草绿", hue: 165 },
  { key: "blue", label: "雾霾蓝", hue: 235 },
  { key: "rose", label: "藕粉", hue: 15 },
  { key: "lavender", label: "香芋紫", hue: 300 },
  { key: "oat", label: "燕麦咖", hue: 60 },
] as const;

export type ThemeKey = (typeof THEMES)[number]["key"];

export const STORAGE_KEY = "ln_theme_color";

function readTheme(): ThemeKey {
  try {
    const v = localStorage.getItem(STORAGE_KEY);
    return THEMES.some((t) => t.key === v) ? (v as ThemeKey) : "sage";
  } catch {
    return "sage";
  }
}

function applyTheme(key: ThemeKey) {
  document.documentElement.setAttribute("data-theme", key);
  try {
    localStorage.setItem(STORAGE_KEY, key);
  } catch {
    /* 隐私模式等 localStorage 不可用就忽略，不影响本次会话内的切换 */
  }
}

export function ThemePicker() {
  const [current, setCurrent] = useState<ThemeKey>("sage");

  // 打开时同步一次（跟 layout 首屏脚本保持一致，避免 SSR 默认值覆盖）；
  // 同时把存储的主题重新应用到 DOM——兜底首屏脚本偶尔没生效（移动端重开时偶发回默认色）的情况。
  useEffect(() => {
    const k = readTheme();
    setCurrent(k);
    applyTheme(k);
  }, []);

  function choose(key: ThemeKey) {
    setCurrent(key);
    applyTheme(key);
  }

  return (
    <div className="flex flex-wrap gap-3">
      {THEMES.map((t) => {
        const active = t.key === current;
        return (
          <button
            key={t.key}
            onClick={() => choose(t.key)}
            aria-label={t.label}
            title={t.label}
            className={`relative h-9 w-9 rounded-full transition-transform ${
              active ? "scale-105 ring-2 ring-zinc-400 ring-offset-2" : "hover:scale-105"
            }`}
          >
            <span
              className="absolute inset-0 rounded-full border border-black/10"
              style={{ background: `oklch(0.62 0.10 ${t.hue})` }}
            />
            {active && (
              <span className="absolute inset-0 flex items-center justify-center text-sm font-semibold text-white">
                ✓
              </span>
            )}
          </button>
        );
      })}
    </div>
  );
}
