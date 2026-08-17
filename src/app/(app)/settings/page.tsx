import { getUserSettings, friendlyQueryError } from "@/lib/supabase/queries";
import { SettingsForm } from "@/components/settings-form";
import type { UserSettings } from "@/lib/types";

export default async function SettingsPage() {
  let settings: UserSettings = {
    daily_goal: 20,
    reminder_enabled: false,
    reminder_time: null,
  };
  let error: string | null = null;

  try {
    settings = await getUserSettings();
  } catch (err) {
    error = friendlyQueryError(err);
  }

  const hasClaude = Boolean(process.env.ANTHROPIC_API_KEY);
  const hasOpenAI = Boolean(process.env.OPENAI_API_KEY);

  return (
    <div className="mx-auto max-w-md">
      <header className="mb-6">
        <h1 className="text-2xl font-bold text-zinc-900">设置</h1>
      </header>

      {error && (
        <div className="mb-4 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
          {error}
        </div>
      )}

      <SettingsForm initial={settings} />

      {/* AI 功能状态（只显示有没有配 Key，不显示 Key 本身） */}
      <section className="mt-6 rounded-2xl border border-zinc-200 bg-white p-4">
        <h2 className="text-sm font-semibold text-zinc-900">AI 功能状态</h2>
        <p className="mt-0.5 text-xs text-zinc-500">在「媒体」页把视频 / 播客转成精读笔记需要这些 Key。</p>
        <ul className="mt-3 space-y-2">
          <li className="flex items-center justify-between rounded-lg bg-zinc-50 px-3 py-2">
            <span className="text-sm text-zinc-700">✨ AI 精读笔记（Claude）</span>
            {hasClaude ? (
              <span className="text-xs font-medium text-teal-600">已配置 ✓</span>
            ) : (
              <span className="text-xs font-medium text-amber-600">未配置</span>
            )}
          </li>
          <li className="flex items-center justify-between rounded-lg bg-zinc-50 px-3 py-2">
            <span className="text-sm text-zinc-700">🎙️ 语音转录（Whisper）</span>
            {hasOpenAI ? (
              <span className="text-xs font-medium text-teal-600">已配置 ✓</span>
            ) : (
              <span className="text-xs font-medium text-amber-600">未配置</span>
            )}
          </li>
        </ul>
        {(!hasClaude || !hasOpenAI) && (
          <p className="mt-3 text-xs leading-relaxed text-zinc-400">
            在项目根目录的 <code className="rounded bg-zinc-100 px-1">.env.local</code> 里填入
            {!hasClaude && " ANTHROPIC_API_KEY"}
            {!hasClaude && !hasOpenAI && " 和"}
            {!hasOpenAI && " OPENAI_API_KEY"}
            ，保存后重启开发服务器即可生效。
          </p>
        )}
      </section>
    </div>
  );
}
