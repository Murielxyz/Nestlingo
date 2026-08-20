"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { NotebookPen, RefreshCw, Layers, Settings } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { BrandMark } from "./brand-mark";

const NAV_ITEMS: { href: string; label: string; icon: LucideIcon }[] = [
  { href: "/notes", label: "笔记", icon: NotebookPen },
  { href: "/review", label: "复习", icon: RefreshCw },
  { href: "/cards", label: "卡片", icon: Layers },
  { href: "/settings", label: "设置", icon: Settings },
];

function isActive(pathname: string, href: string) {
  if (href === "/notes") return pathname === "/notes";
  return pathname.startsWith(href);
}

export function AppShell({
  userEmail,
  children,
}: {
  userEmail: string;
  children: React.ReactNode;
}) {
  const pathname = usePathname();
  const [collapsed, setCollapsed] = useState(false);

  // 笔记区（/notes、/notes/[id]、/notes/folder/[folderId]）由 notes/layout 做布局，
  // 这里整页铺满、不套 max-w 和留白。
  const isNotes =
    pathname === "/notes" ||
    /^\/notes\/[^/]+$/.test(pathname) ||
    /^\/notes\/folder\/[^/]+$/.test(pathname);

  // 每日复习提醒：应用打开时，若到了设置的时间且已开启，弹一条系统通知（当天只弹一次）。
  useEffect(() => {
    let cancelled = false;
    (async () => {
      if (typeof Notification === "undefined" || Notification.permission !== "granted") {
        return;
      }
      const supabase = createClient();
      const { data, error } = await supabase
        .from("user_settings")
        .select("reminder_enabled, reminder_time")
        .limit(1)
        .maybeSingle();
      if (cancelled || error || !data?.reminder_enabled || !data?.reminder_time) return;

      const now = new Date();
      const [h, m] = data.reminder_time.split(":").map(Number);
      const due = new Date(now.getFullYear(), now.getMonth(), now.getDate(), h, m).getTime();
      const todayKey = now.toDateString();
      if (now.getTime() >= due && localStorage.getItem("ln_reminder") !== todayKey) {
        new Notification("语巢 · 复习提醒", { body: "该复习今天的单词啦" });
        localStorage.setItem("ln_reminder", todayKey);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [pathname]);

  return (
    <div className="min-h-screen">
      {/* ===== 桌面端左侧边栏（可收起成窄条，只留图标） ===== */}
      <aside
        className={`hidden md:flex fixed inset-y-0 left-0 flex-col border-r border-zinc-200 bg-white transition-[width] duration-200 ${
          collapsed ? "w-14" : "w-64"
        }`}
      >
        <div
          className={`flex items-center border-b border-zinc-100 ${
            collapsed ? "justify-center px-2 py-4" : "gap-2 px-5 py-5"
          }`}
        >
          {collapsed ? (
            <button
              onClick={() => setCollapsed(false)}
              className="rounded-lg p-1.5 text-zinc-500 transition-colors hover:bg-zinc-100 hover:text-zinc-900"
              aria-label="展开菜单"
              title="展开菜单"
            >
              »
            </button>
          ) : (
            <>
              <BrandMark className="h-8 w-8 shrink-0" />
              <span className="min-w-0 flex-1">
                <span className="block text-lg font-bold leading-tight text-zinc-900">语巢</span>
                <span className="block text-[11px] font-medium tracking-wide text-zinc-400">
                  Nestlingo
                </span>
              </span>
              <button
                onClick={() => setCollapsed(true)}
                className="rounded-lg p-1.5 text-zinc-500 transition-colors hover:bg-zinc-100 hover:text-zinc-900"
                aria-label="收起菜单"
                title="收起菜单"
              >
                «
              </button>
            </>
          )}
        </div>

        <nav className={`flex-1 py-4 space-y-1 ${collapsed ? "px-2" : "px-3"}`}>
          {NAV_ITEMS.map((item) => {
            const active = isActive(pathname, item.href);
            const Icon = item.icon;
            return (
              <Link
                key={item.href}
                href={item.href}
                title={collapsed ? item.label : undefined}
                className={`flex items-center rounded-lg text-sm font-medium transition-colors ${
                  collapsed ? "justify-center py-2.5" : "gap-3 px-3 py-2.5"
                } ${
                  active
                    ? "bg-teal-50 text-teal-700"
                    : "text-zinc-600 hover:bg-zinc-100 hover:text-zinc-900"
                }`}
              >
                <Icon className="h-[18px] w-[18px] shrink-0" />
                {!collapsed && item.label}
              </Link>
            );
          })}
        </nav>

        {collapsed ? (
          <div className="flex justify-center border-t border-zinc-100 py-3">
            <BrandMark className="h-5 w-5 opacity-70" />
          </div>
        ) : (
          <div className="px-5 py-4 border-t border-zinc-100">
            <p className="truncate text-xs text-zinc-500">{userEmail}</p>
          </div>
        )}
      </aside>

      {/* ===== 移动端顶栏 ===== */}
      <header className="md:hidden sticky top-0 z-10 flex items-center justify-between border-b border-zinc-200 bg-white px-4 py-3">
        <div className="flex items-center gap-2">
          <BrandMark className="h-6 w-6" />
          <span className="leading-tight">
            <span className="block text-sm font-bold text-zinc-900">语巢</span>
            <span className="block text-[10px] font-medium tracking-wide text-zinc-400">
              Nestlingo
            </span>
          </span>
        </div>
        <Link
          href="/settings"
          className="rounded-lg border border-zinc-200 px-2.5 py-1.5 text-xs text-zinc-600"
          aria-label="设置"
        >
          <Settings className="h-4 w-4" />
        </Link>
      </header>

      {/* ===== 主内容区 ===== */}
      <main className={`pb-20 md:pb-0 transition-[padding] duration-200 ${collapsed ? "md:pl-14" : "md:pl-64"}`}>
        {isNotes ? (
          <div className="min-h-screen bg-white">{children}</div>
        ) : (
          <div className="mx-auto max-w-5xl px-4 md:px-8 py-6">{children}</div>
        )}
      </main>

      {/* ===== 移动端底部导航 ===== */}
      <nav className="md:hidden fixed inset-x-0 bottom-0 z-10 flex border-t border-zinc-200 bg-white">
        {NAV_ITEMS.map((item) => {
          const active = isActive(pathname, item.href);
          const Icon = item.icon;
          return (
            <Link
              key={item.href}
              href={item.href}
              className={`flex flex-1 flex-col items-center gap-0.5 py-2 text-xs ${
                active ? "text-teal-600" : "text-zinc-500"
              }`}
            >
              <Icon className="h-5 w-5" />
              {item.label}
            </Link>
          );
        })}
      </nav>
    </div>
  );
}
