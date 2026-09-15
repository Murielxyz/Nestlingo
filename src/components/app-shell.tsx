"use client";

import { useEffect } from "react";
import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import { NotebookPen, RefreshCw, Settings, MessageCircleHeart } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { BrandMark } from "./brand-mark";

const NAV_ITEMS: { href: string; label: string; icon: LucideIcon }[] = [
  { href: "/notes", label: "笔记", icon: NotebookPen },
  { href: "/review", label: "闪卡", icon: RefreshCw },
  { href: "/companion", label: "语伴", icon: MessageCircleHeart },
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

  // 笔记区（/notes、/notes/[id]、/notes/folder/[folderId]）由 notes/layout 做布局，
  // 这里整页铺满、不套 max-w 和留白。
  const isNotes =
    pathname === "/notes" ||
    /^\/notes\/[^/]+$/.test(pathname) ||
    /^\/notes\/folder\/[^/]+$/.test(pathname);

  // 单篇笔记页自带「返回 + 保存」头部，mobile 端不再叠一层全局顶栏（避免两个 sticky 头重叠）。
  const isNoteDetail = /^\/notes\/[^/]+$/.test(pathname) && pathname !== "/notes";
  const searchParams = useSearchParams();

  // 复习/测试/完形填空等会话页（/review 带任意参数，如 ?mode=test、?note=…、?scope=weak、
  // ?theme=…）：沉浸式专注背诵，移动端底部导航一并隐藏；复习主页（无参数）仍保留。
  const isReviewSession = pathname === "/review" && searchParams.size > 0;

  // 语伴对话页铺满全屏：不套 max-w 和留白（和笔记区一样）。
  const isFullBleed = isNotes || pathname === "/companion";

  // 这些页面在内容内部自己算了「避让底部导航」的高度（或本就无底部导航），
  // 外层 main 不再叠一层 pb，否则会把页面撑高出一截、产生整页滚动的错觉（标题跟着滑走）。
  const reservesBottomEnd =
    isNotes || isReviewSession || isFullBleed;

  // 移动端带 sticky 标题栏的页面：标题吸顶且自带安全区 padding，main 不再叠顶部安全区留白，
  // 否则标题上方会多一段透明空隙、滚动内容从那里渗入。
  // 复习主页 + 会话子页（scope/mode/note/theme…）现在都吸顶，其余次级页（单卡/主题/素材/合集/设置/笔记闪卡）亦然。
  const hasStickyHeader =
    isNotes ||
    pathname === "/review" ||
    pathname === "/cards" ||
    pathname.startsWith("/cards/") ||
    pathname === "/companion" ||
    pathname.startsWith("/companion/") ||
    pathname === "/settings" ||
    pathname.startsWith("/groups/") ||
    /^\/notes\/[^/]+\/cards$/.test(pathname);

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
        new Notification("语巢 · 学习提醒", { body: "该学今天的单词啦" });
        localStorage.setItem("ln_reminder", todayKey);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [pathname]);

  return (
    <div className="min-h-screen">
      {/* ===== 桌面端左侧导航（常驻窄栏 168px，不收起：少一个按钮、宽度也不占地） ===== */}
      <aside className="hidden md:flex fixed inset-y-0 left-0 w-[168px] flex-col border-r border-zinc-200 bg-white print:hidden">
        <div className="flex items-center gap-2 border-b border-zinc-100 px-4 py-4">
          <BrandMark className="h-7 w-7 shrink-0" />
          <span className="min-w-0 flex-1">
            <span className="block text-base font-bold leading-tight text-zinc-900">语巢</span>
            <span className="block text-[10px] font-medium tracking-wide text-zinc-400">
              Nestlingo
            </span>
          </span>
        </div>

        <nav className="flex-1 space-y-0.5 px-2 py-3">
          {NAV_ITEMS.map((item) => {
            const active = isActive(pathname, item.href);
            const Icon = item.icon;
            return (
              <Link
                key={item.href}
                href={item.href}
                className={`flex items-center gap-2.5 rounded-lg px-2.5 py-2 text-sm font-medium transition-colors ${
                  active
                    ? "bg-teal-50 text-teal-700"
                    : "text-zinc-600 hover:bg-zinc-100 hover:text-zinc-900"
                }`}
              >
                <Icon className="h-[18px] w-[18px] shrink-0" />
                {item.label}
              </Link>
            );
          })}
        </nav>

        <div className="border-t border-zinc-100 px-4 py-3">
          <p className="truncate text-xs text-zinc-500">{userEmail}</p>
        </div>
      </aside>

      {/* ===== 主内容区（移动端底部让出导航 + 底部安全区；顶部让出状态栏安全区） ===== */}
      <main className={`md:pl-[168px] print:pl-0 print:pt-0 print:pb-0 ${hasStickyHeader ? "" : "pt-[max(1rem,env(safe-area-inset-top))]"} ${reservesBottomEnd ? "pb-0" : "pb-[calc(5rem+env(safe-area-inset-bottom))] md:pb-0"}`}>
        {isFullBleed ? (
          <div className="min-h-[100dvh]">{children}</div>
        ) : (
          <div className="mx-auto max-w-3xl px-4 md:px-8 py-6">{children}</div>
        )}
      </main>

      {/* ===== 移动端底部导航（底部放出安全区，避免被 home indicator 压住） ===== */}
      {/* 笔记编辑页顶部已有返回键，底部导航不显示，避免编辑时遮挡。 */}
      {/* 复习/测试会话页同样隐藏，专注背诵。 */}
      {!isNoteDetail && !isReviewSession && (
        <nav className="md:hidden fixed inset-x-0 bottom-0 z-10 flex border-t border-black/5 bg-white/80 pb-[env(safe-area-inset-bottom)] backdrop-blur-md print:hidden">
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
      )}
    </div>
  );
}
