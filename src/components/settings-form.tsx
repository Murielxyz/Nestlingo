"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import type { UserSettings } from "@/lib/types";

/**
 * 设置页表单：每日复习目标 + 复习提醒 + 退出登录。
 * 设置存进 user_settings 表（每人一条），复习目标会限制每轮背诵的张数。
 */
export function SettingsForm({ initial }: { initial: UserSettings }) {
  const router = useRouter();
  const [dailyGoal, setDailyGoal] = useState(initial.daily_goal);
  const [reminderEnabled, setReminderEnabled] = useState(initial.reminder_enabled);
  const [reminderTime, setReminderTime] = useState(initial.reminder_time ?? "20:00");
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function save() {
    setBusy(true);
    setError(null);
    setSaved(false);
    const supabase = createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) {
      setError("未登录，无法保存。");
      setBusy(false);
      return;
    }

    // 开启提醒时顺手请求系统通知权限（应用打开时生效）。
    if (reminderEnabled && typeof Notification !== "undefined") {
      if (Notification.permission === "default") {
        await Notification.requestPermission().catch(() => {});
      }
    }

    const { error } = await supabase
      .from("user_settings")
      .upsert(
        {
          user_id: user.id,
          daily_goal: Math.max(1, dailyGoal),
          reminder_enabled: reminderEnabled,
          reminder_time: reminderEnabled ? reminderTime : null,
        },
        { onConflict: "user_id" }
      );
    setBusy(false);
    if (error) {
      setError(error.message);
      return;
    }
    setSaved(true);
    router.refresh();
  }

  async function logout() {
    const supabase = createClient();
    await supabase.auth.signOut();
    router.replace("/login");
    router.refresh();
  }

  return (
    <div className="space-y-6">
      {/* 每日目标 */}
      <section className="rounded-2xl border border-zinc-200 bg-white p-4">
        <h2 className="text-sm font-semibold text-zinc-900">每日背诵目标</h2>
        <p className="mt-0.5 text-xs text-zinc-500">
          每天想背多少张，复习时每轮最多背这些（类似 Anki 的每日计划）。
        </p>
        <div className="mt-3 flex items-center gap-2">
          <input
            type="number"
            min={1}
            value={dailyGoal}
            onChange={(e) => setDailyGoal(parseInt(e.target.value, 10) || 1)}
            className="w-24 rounded-lg border border-zinc-300 px-3 py-2 text-sm text-zinc-800 focus:border-teal-500 focus:outline-none"
          />
          <span className="text-sm text-zinc-500">张 / 天</span>
        </div>
      </section>

      {/* 复习提醒 */}
      <section className="rounded-2xl border border-zinc-200 bg-white p-4">
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-semibold text-zinc-900">每日复习提醒</h2>
          <button
            type="button"
            role="switch"
            aria-checked={reminderEnabled}
            onClick={() => setReminderEnabled((v) => !v)}
            className={`relative h-6 w-11 rounded-full transition-colors ${
              reminderEnabled ? "bg-teal-600" : "bg-zinc-200"
            }`}
          >
            <span
              className={`absolute top-0.5 h-5 w-5 rounded-full bg-white shadow transition-all ${
                reminderEnabled ? "left-[22px]" : "left-0.5"
              }`}
            />
          </button>
        </div>
        {reminderEnabled && (
          <div className="mt-3">
            <input
              type="time"
              value={reminderTime}
              onChange={(e) => setReminderTime(e.target.value)}
              className="rounded-lg border border-zinc-300 px-3 py-2 text-sm text-zinc-800 focus:border-teal-500 focus:outline-none"
            />
            <p className="mt-1.5 text-xs text-zinc-400">
              到点且应用打开时会弹提醒（完整离线推送后续版本加入）。
            </p>
          </div>
        )}
      </section>

      {error && <p className="text-sm text-red-600">{error}</p>}

      <button
        onClick={save}
        disabled={busy}
        className="w-full rounded-xl bg-teal-600 px-4 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-teal-700 disabled:opacity-60"
      >
        {busy ? "保存中…" : saved ? "已保存 ✓" : "保存设置"}
      </button>

      <div className="border-t border-zinc-200 pt-4">
        <button
          onClick={logout}
          className="w-full rounded-xl border border-zinc-200 px-4 py-2.5 text-sm text-zinc-600 transition-colors hover:bg-zinc-50 hover:text-zinc-900"
        >
          退出登录
        </button>
      </div>
    </div>
  );
}
