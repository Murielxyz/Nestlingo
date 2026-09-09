"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import type { UserSettings } from "@/lib/types";
import { SettingsGroup, SettingsRow } from "./settings-row";

/**
 * 设置页「学习」分组：每日复习目标 + 复习提醒。
 * 设置存进 user_settings 表（每人一条），复习目标会限制每轮背诵的张数。
 */
export function SettingsForm({ initial }: { initial: UserSettings }) {
  const router = useRouter();
  const [dailyGoal, setDailyGoal] = useState(initial.daily_goal);
  const [reminderEnabled, setReminderEnabled] = useState(initial.reminder_enabled);
  const [reminderTime, setReminderTime] = useState(initial.reminder_time ?? "20:00");
  const [reviewShuffle, setReviewShuffle] = useState(initial.review_shuffle);
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
          review_shuffle: reviewShuffle,
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

  return (
    <div className="space-y-3">
      <SettingsGroup title="学习">
        <SettingsRow
          label="每日背诵目标"
          hint="每轮最多背这些张（类似 Anki 每日计划）"
        >
          <div className="flex shrink-0 items-center gap-1.5">
            <input
              type="number"
              min={1}
              value={dailyGoal}
              onChange={(e) => setDailyGoal(parseInt(e.target.value, 10) || 1)}
              className="w-16 rounded-lg border border-zinc-200 bg-white px-2 py-1.5 text-right text-sm text-zinc-800 focus:border-teal-500 focus:outline-none"
            />
            <span className="text-xs text-zinc-400">张/天</span>
          </div>
        </SettingsRow>

        <SettingsRow label="每日学习提醒" hint="到点且应用打开时提醒">
          <button
            type="button"
            role="switch"
            aria-checked={reminderEnabled}
            onClick={() => setReminderEnabled((v) => !v)}
            className={`relative h-6 w-11 shrink-0 rounded-full transition-colors ${
              reminderEnabled ? "bg-teal-600" : "bg-zinc-200"
            }`}
          >
            <span
              className={`absolute top-0.5 h-5 w-5 rounded-full bg-white shadow transition-all ${
                reminderEnabled ? "left-[22px]" : "left-0.5"
              }`}
            />
          </button>
        </SettingsRow>

        <SettingsRow label="默认随机顺序背诵" hint="每次进背诵自动洗牌，可临时切回顺序">
          <button
            type="button"
            role="switch"
            aria-checked={reviewShuffle}
            onClick={() => setReviewShuffle((v) => !v)}
            className={`relative h-6 w-11 shrink-0 rounded-full transition-colors ${
              reviewShuffle ? "bg-teal-600" : "bg-zinc-200"
            }`}
          >
            <span
              className={`absolute top-0.5 h-5 w-5 rounded-full bg-white shadow transition-all ${
                reviewShuffle ? "left-[22px]" : "left-0.5"
              }`}
            />
          </button>
        </SettingsRow>

        {reminderEnabled && (
          <SettingsRow label="提醒时间">
            <input
              type="time"
              value={reminderTime}
              onChange={(e) => setReminderTime(e.target.value)}
              className="shrink-0 rounded-lg border border-zinc-200 bg-white px-2 py-1.5 text-sm text-zinc-800 focus:border-teal-500 focus:outline-none"
            />
          </SettingsRow>
        )}
      </SettingsGroup>

      {error && <p className="px-1 text-sm text-red-600">{error}</p>}

      <button onClick={save} disabled={busy} className="btn-brand w-full">
        {busy ? "保存中…" : saved ? "已保存 ✓" : "保存学习设置"}
      </button>
    </div>
  );
}
