import { getUserSettings, friendlyQueryError } from "@/lib/supabase/queries";
import { createClient } from "@/lib/supabase/server";
import { ChevronDown } from "lucide-react";
import { SettingsForm, LogoutButton } from "@/components/settings-form";
import { RecognitionRulesForm } from "@/components/recognition-rules-form";
import { AiModelForm } from "@/components/ai-model-form";
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
  const supabase = await createClient();
  const {
    data: { session },
  } = await supabase.auth.getSession();
  const userEmail = session?.user?.email ?? "";

  let settings: UserSettings = {
    daily_goal: 20,
    reminder_enabled: false,
    reminder_time: null,
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
      <header className="page-header mb-6">
        <h1 className="text-2xl font-bold text-zinc-900">设置</h1>
      </header>

      {error && (
        <div className="mb-4 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
          {error}
        </div>
      )}

      <div className="space-y-4">
        <section className="card-soft p-5">
          <div className="flex items-center gap-4">
            <div className="flex h-14 w-14 shrink-0 items-center justify-center rounded-full bg-teal-600 text-lg font-bold text-white">
              {userEmail ? userEmail[0].toUpperCase() : "语"}
            </div>
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-semibold text-zinc-900">{userEmail || "未登录"}</p>
              <p className="text-xs text-zinc-400">语巢 &middot; Nestlingo</p>
            </div>
          </div>
          <div className="mt-4 border-t border-zinc-100 pt-4">
            <LogoutButton />
          </div>
        </section>

        <SettingsForm initial={settings} />

        {/* 识别规则是进阶低频项：默认收起的「高级」折叠面板，避免设置页一开始就塞满。 */}
        <details className="card-soft group p-5">
          <summary className="flex cursor-pointer list-none items-center justify-between text-sm font-semibold text-zinc-900 [&::-webkit-details-marker]:hidden">
            <span>
              闪卡识别规则
              <span className="ml-1.5 text-xs font-normal text-zinc-400">高级</span>
            </span>
            <ChevronDown className="h-4 w-4 text-zinc-400 transition-transform group-open:rotate-180" />
          </summary>
          <p className="mt-0.5 text-xs text-zinc-500">
            粘贴表格转成闪卡时，用哪些表头关键词识别「正面 / 背面 / 读音 / 拓展」。选个预设或自己填。
          </p>
          <div className="mt-4">
            <RecognitionRulesForm initial={settings.recognition_rules} />
          </div>
        </details>

        <Section
          title="AI 模型"
          description="文字、语音转录、图片识别各选一个提供商；「默认」跟随环境配置，其它选项只在已配 Key 时显示。"
        >
          <AiModelForm initial={settings} keys={aiKeys} />
        </Section>

        <Section
          title="数据备份"
          description="把你的笔记、闪卡、复习进度导出到本地保存，方便备份或迁移。"
        >
          <DataBackup />
        </Section>
      </div>
    </div>
  );
}
