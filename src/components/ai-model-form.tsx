"use client";

// AI 模型选择：按任务（文字 / 语音转录 / 图片识别）各选一个提供商，只给预设选项。
// 每个任务独立保存进 user_settings 的 ai_*_provider 列；选「默认」= 跟随环境配置。
// 模型路由在服务端 AI 封装（ai-client / transcribe）处集中落设置，这里只负责存。

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import type { UserSettings } from "@/lib/types";
import { SettingsGroup, SettingsRow } from "./settings-row";

/** 环境里配了哪些 Key（设置页按 .env.local 计算后传进来，用来标「未配 Key」）。 */
export type AiKeys = {
  anthropic: boolean;
  deepseek: boolean;
  groq: boolean;
  openai: boolean;
  gemini: boolean;
};

type Option = { value: string; label: string; key: keyof AiKeys | null };

const TASKS: { key: "ai_text_provider" | "ai_speech_provider" | "ai_vision_provider"; title: string; options: Option[] }[] = [
  {
    key: "ai_text_provider",
    title: "文字",
    options: [
      { value: "", label: "默认", key: null },
      { value: "claude", label: "Claude", key: "anthropic" },
      { value: "deepseek", label: "DeepSeek", key: "deepseek" },
      { value: "openai", label: "OpenAI", key: "openai" },
      { value: "groq", label: "Groq", key: "groq" },
      { value: "gemini", label: "Gemini", key: "gemini" },
    ],
  },
  {
    key: "ai_speech_provider",
    title: "语音转录",
    options: [
      { value: "", label: "默认", key: null },
      { value: "groq", label: "Groq", key: "groq" },
      { value: "openai", label: "OpenAI", key: "openai" },
    ],
  },
  {
    key: "ai_vision_provider",
    title: "图片识别",
    options: [
      { value: "", label: "默认", key: null },
      { value: "claude", label: "Claude", key: "anthropic" },
      { value: "openai", label: "OpenAI", key: "openai" },
    ],
  },
];

/** 把三个下拉读成待存的字符串（'' 表示「默认」→ 存 null）。 */
function readValues(initial: UserSettings): Record<string, string> {
  const out: Record<string, string> = {};
  for (const t of TASKS) out[t.key] = initial[t.key] ?? "";
  return out;
}

export function AiModelForm({ initial, keys }: { initial: UserSettings; keys: AiKeys }) {
  const router = useRouter();
  const [values, setValues] = useState<Record<string, string>>(() => readValues(initial));
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
    const { error } = await supabase
      .from("user_settings")
      .upsert(
        {
          user_id: user.id,
          ai_text_provider: values.ai_text_provider || null,
          ai_speech_provider: values.ai_speech_provider || null,
          ai_vision_provider: values.ai_vision_provider || null,
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
      <SettingsGroup title="AI 模型">
        {TASKS.map((t) => {
          // 只显示已配 Key 的提供商（「默认」始终可选）。
          const visibleOptions = t.options.filter((o) => o.key === null || keys[o.key]);
          const selectValue = visibleOptions.some((o) => o.value === values[t.key])
            ? values[t.key]
            : "";
          return (
            <SettingsRow key={t.key} label={t.title}>
              <select
                value={selectValue}
                onChange={(e) => {
                  setValues((v) => ({ ...v, [t.key]: e.target.value }));
                  setSaved(false);
                }}
                className="shrink-0 rounded-lg border border-zinc-200 bg-white px-2 py-1.5 text-sm text-zinc-700 focus:border-teal-500 focus:outline-none"
              >
                {visibleOptions.map((o) => (
                  <option key={o.value} value={o.value}>
                    {o.label}
                  </option>
                ))}
              </select>
            </SettingsRow>
          );
        })}
      </SettingsGroup>

      <p className="px-1 text-xs text-zinc-400">
        「默认」跟随环境配置，其它选项只在已配 Key 时显示。
      </p>

      {error && <p className="px-1 text-sm text-red-600">{error}</p>}

      <button onClick={save} disabled={busy} className="btn-brand w-full">
        {busy ? "保存中…" : saved ? "已保存 ✓" : "保存 AI 模型"}
      </button>
    </div>
  );
}
