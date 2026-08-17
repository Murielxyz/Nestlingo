"use client";

// 闪卡识别规则：让用户自定义「正面 / 背面 / 读音 / 拓展」四类表头关键词。
// 粘贴进笔记的表格，表头命中这些关键词时会被正确归到对应角色（转成闪卡时生效）。
// 提供一组语言预设，也可自由增删关键词。

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import type { RecognitionRules } from "@/lib/types";
import { RECOGNITION_PRESETS, EMPTY_RULES } from "@/lib/recognition-presets";

const FIELDS: { key: keyof RecognitionRules; label: string; placeholder: string }[] = [
  { key: "front", label: "正面（要记的词）", placeholder: "如：泰语、单词、word" },
  { key: "back", label: "背面（释义）", placeholder: "如：释义、中文、meaning" },
  { key: "hint", label: "读音", placeholder: "如：读音、音标、罗马" },
  { key: "extra", label: "拓展（例句等）", placeholder: "如：例句、拓展" },
];

function join(rules: RecognitionRules | null): Record<keyof RecognitionRules, string> {
  const r = rules ?? EMPTY_RULES;
  return {
    front: r.front.join("、"),
    back: r.back.join("、"),
    hint: r.hint.join("、"),
    extra: r.extra.join("、"),
  };
}

function split(s: string): string[] {
  return s
    .split(/[,，、;；\s]+/)
    .map((k) => k.trim())
    .filter(Boolean);
}

export function RecognitionRulesForm({ initial }: { initial: RecognitionRules | null }) {
  const router = useRouter();
  const [values, setValues] = useState(() => join(initial));
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function setField(key: keyof RecognitionRules, value: string) {
    setValues((prev) => ({ ...prev, [key]: value }));
    setSaved(false);
  }

  function applyPreset(key: string) {
    const preset = RECOGNITION_PRESETS.find((p) => p.key === key);
    if (!preset) return;
    setValues(join(preset.rules));
    setSaved(false);
  }

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
    const rules: RecognitionRules = {
      front: split(values.front),
      back: split(values.back),
      hint: split(values.hint),
      extra: split(values.extra),
    };
    const { error } = await supabase
      .from("user_settings")
      .upsert(
        { user_id: user.id, recognition_rules: rules },
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
    <div>
      {/* 预设 */}
      <div className="mb-3">
        <p className="mb-1.5 text-xs font-medium text-zinc-500">语言预设（一键填充，可再改）</p>
        <div className="flex flex-wrap gap-1.5">
          {RECOGNITION_PRESETS.map((p) => (
            <button
              key={p.key}
              onClick={() => applyPreset(p.key)}
              className="rounded-full border border-zinc-200 px-3 py-1 text-sm text-zinc-600 transition-colors hover:border-teal-300 hover:bg-teal-50 hover:text-teal-700"
            >
              {p.label}
            </button>
          ))}
        </div>
      </div>

      {/* 四类关键词 */}
      <div className="space-y-3">
        {FIELDS.map((f) => (
          <div key={f.key}>
            <label className="mb-1 block text-xs font-medium text-zinc-600">{f.label}</label>
            <input
              value={values[f.key]}
              onChange={(e) => setField(f.key, e.target.value)}
              placeholder={f.placeholder}
              className="w-full rounded-lg border border-zinc-200 px-3 py-2 text-sm text-zinc-800 focus:border-teal-500 focus:outline-none"
            />
          </div>
        ))}
      </div>

      {error && <p className="mt-3 text-sm text-red-600">{error}</p>}

      <div className="mt-4 flex items-center gap-3">
        <button
          onClick={save}
          disabled={busy}
          className="rounded-xl bg-teal-600 px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-teal-700 disabled:opacity-60"
        >
          {busy ? "保存中…" : saved ? "已保存 ✓" : "保存识别规则"}
        </button>
        <p className="text-xs text-zinc-400">留空则用内置默认规则。</p>
      </div>
    </div>
  );
}
