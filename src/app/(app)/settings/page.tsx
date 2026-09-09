import { getUserSettings, friendlyQueryError } from "@/lib/supabase/queries";
import { createClient } from "@/lib/supabase/server";
import { ChevronDown } from "lucide-react";
import { PageHeader } from "@/components/page-header";
import { SettingsForm } from "@/components/settings-form";
import { ProfileForm } from "@/components/profile-form";
import { RecognitionRulesForm } from "@/components/recognition-rules-form";
import { AiModelForm } from "@/components/ai-model-form";
import { DataBackup } from "@/components/data-backup";
import { ThemePicker } from "@/components/theme-picker";
import { SettingsGroup } from "@/components/settings-row";
import type { UserSettings } from "@/lib/types";

export default async function SettingsPage() {
  const supabase = await createClient();
  const {
    data: { session },
  } = await supabase.auth.getSession();
  const userEmail = session?.user?.email ?? "";
  const meta = session?.user?.user_metadata ?? {};

  let settings: UserSettings = {
    daily_goal: 20,
    reminder_enabled: false,
    reminder_time: null,
    review_shuffle: false,
    recognition_rules: null,
    hidden_themes: [],
    ai_text_provider: null,
    ai_speech_provider: null,
    ai_vision_provider: null,
  };
  let error: string | null = null;

  try {
    settings = await getUserSettings();
  } catch (err) {
    error = friendlyQueryError(err);
  }

  // 环境里配了哪些 Key（只显示有没有，不显示值），供「AI 模型」板块标「未配 Key」。
  const aiKeys = {
    anthropic: Boolean(process.env.ANTHROPIC_API_KEY),
    deepseek: Boolean(process.env.DEEPSEEK_API_KEY),
    groq: Boolean(process.env.GROQ_API_KEY),
    openai: Boolean(process.env.OPENAI_API_KEY),
    gemini: Boolean(process.env.GEMINI_API_KEY),
  };

  return (
    <div className="mx-auto max-w-2xl">
      <PageHeader title="设置" />

      {error && (
        <div className="mb-4 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
          {error}
        </div>
      )}

      <div className="space-y-5">
        {/* 账户：emoji 头像 + 昵称 + 邮箱，点铅笔编辑 */}
        <ProfileForm
          email={userEmail}
          initial={{
            name: typeof meta.name === "string" ? meta.name : undefined,
            emoji: typeof meta.avatar_emoji === "string" ? meta.avatar_emoji : undefined,
            color: typeof meta.avatar_color === "string" ? meta.avatar_color : undefined,
          }}
        />

        {/* 学习 */}
        <SettingsForm initial={settings} />

        {/* 外观 */}
        <SettingsGroup title="外观">
          <div className="px-4 py-4">
            <p className="mb-3 text-sm text-zinc-800">主题色</p>
            <ThemePicker />
            <p className="mt-3 text-xs text-zinc-400">
              莫兰迪低饱和配色，切换后全站即时生效。
            </p>
          </div>
        </SettingsGroup>

        {/* 识别规则是进阶低频项：默认收起的「高级」折叠面板，避免设置页一开始就塞满。 */}
        <details className="group overflow-hidden rounded-2xl border border-black/5 bg-white/80 shadow-sm backdrop-blur">
          <summary className="flex cursor-pointer list-none items-center justify-between px-4 py-3.5 text-sm font-semibold text-zinc-900 [&::-webkit-details-marker]:hidden">
            <span>
              闪卡识别规则
              <span className="ml-1.5 text-xs font-normal text-zinc-400">高级</span>
            </span>
            <ChevronDown className="h-4 w-4 text-zinc-400 transition-transform group-open:rotate-180" />
          </summary>
          <div className="border-t border-zinc-100 px-4 py-4">
            <p className="mb-4 text-xs text-zinc-500">
              粘贴表格转成闪卡时，用哪些表头关键词识别「正面 / 背面 / 读音 / 拓展」。选个预设或自己填。
            </p>
            <RecognitionRulesForm initial={settings.recognition_rules} />
          </div>
        </details>

        {/* AI 模型 */}
        <AiModelForm initial={settings} keys={aiKeys} />

        {/* 数据备份 */}
        <DataBackup />
      </div>
    </div>
  );
}
