import { getUserSettings, friendlyQueryError } from "@/lib/supabase/queries";
import { SettingsForm } from "@/components/settings-form";
import { RecognitionRulesForm } from "@/components/recognition-rules-form";
import { DataBackup } from "@/components/data-backup";
import type { UserSettings } from "@/lib/types";

function Section({
  title,
  description,
  children,
}: {
  title: string;
  description?: string;
  children: React.ReactNode;
}) {
  return (
    <section className="card-soft p-5">
      <h2 className="text-sm font-semibold text-zinc-900">{title}</h2>
      {description && <p className="mt-0.5 text-xs text-zinc-500">{description}</p>}
      <div className="mt-4">{children}</div>
    </section>
  );
}

export default async function SettingsPage() {
  let settings: UserSettings = {
    daily_goal: 20,
    reminder_enabled: false,
    reminder_time: null,
    recognition_rules: null,
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
    <div className="mx-auto max-w-2xl">
      <header className="mb-6">
        <h1 className="text-2xl font-bold text-zinc-900">设置</h1>
      </header>

      {error && (
        <div className="mb-4 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
          {error}
        </div>
      )}

      <div className="space-y-4">
        <SettingsForm initial={settings} />

        <Section
          title="闪卡识别规则"
          description="粘贴表格转成闪卡时，用哪些表头关键词识别「正面 / 背面 / 读音 / 拓展」。选个预设或自己填。"
        >
          <RecognitionRulesForm initial={settings.recognition_rules} />
        </Section>

        <Section
          title="数据备份"
          description="把你的笔记、闪卡、复习进度导出到本地保存，方便备份或迁移。"
        >
          <DataBackup />
        </Section>

        {/* AI 功能状态（只显示有没有配 Key，不显示 Key 本身） */}
        <Section title="AI 功能状态" description="AI 精读与语音转录需要这些 Key。">
          <ul className="space-y-2">
            <li className="flex items-center justify-between rounded-lg bg-zinc-50 px-3 py-2">
              <span className="text-sm text-zinc-700">AI 精读笔记（Claude）</span>
              {hasClaude ? (
                <span className="text-xs font-medium text-teal-600">已配置 ✓</span>
              ) : (
                <span className="text-xs font-medium text-amber-600">未配置</span>
              )}
            </li>
            <li className="flex items-center justify-between rounded-lg bg-zinc-50 px-3 py-2">
              <span className="text-sm text-zinc-700">语音转录（Whisper）</span>
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
        </Section>
      </div>
    </div>
  );
}
