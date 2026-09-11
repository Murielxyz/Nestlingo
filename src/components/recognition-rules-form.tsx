"use client";

// 闪卡识别规则：让用户自定义「正面 / 背面 / 拓展」三类表头关键词、
// 自定义分隔规则（命中即拆正反面），以及一组全局开关（读音位置 / 分句 / 换行 / 识别范围）。
// 排版参考 workbuddy 的规则列表设计，但原解析逻辑不变。
// 粘贴进笔记的表格，表头命中这些关键词时会被正确归到对应角色（转成闪卡时生效）。

import { useState } from "react";
import { useRouter } from "next/navigation";
import { ChevronDown, Plus, Trash2 } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import type { RecognitionRules, SplitRule } from "@/lib/types";
import { RECOGNITION_PRESETS, EMPTY_RULES } from "@/lib/recognition-presets";

const FIELDS: { key: "front" | "back" | "extra"; label: string; placeholder: string }[] = [
  { key: "front", label: "正面", placeholder: "泰语、单词、word…" },
  { key: "back", label: "背面（释义）", placeholder: "中文、释义、meaning…" },
  { key: "extra", label: "拓展（例句）", placeholder: "例句、拓展…" },
];

const MODE_LABEL: Record<SplitRule["mode"], string> = {
  "double-space": "两个空格",
  tab: "制表符",
  colon: "冒号（：）",
  custom: "自定义正则",
};

const KIND_LABEL: Record<SplitRule["kind"], string> = {
  general: "普通",
  word: "生词",
  example: "例句",
  grammar: "语法",
};

const APPLIES_LABEL: Record<SplitRule["appliesTo"], string> = {
  all: "全部内容",
  callout: "仅彩色区块（生词/例句/语法）",
};

const NEW_RULE: SplitRule = {
  name: "",
  mode: "double-space",
  customPattern: "",
  kind: "general",
  appliesTo: "all",
};

type Values = {
  front: string;
  back: string;
  extra: string;
  calloutOnly: boolean;
  wrapBackSpaces: boolean;
  splitBySemicolon: boolean;
  customRules: SplitRule[];
};

function join(rules: RecognitionRules | null): Values {
  const r = rules ?? EMPTY_RULES;
  return {
    front: r.front.join("、"),
    back: r.back.join("、"),
    extra: r.extra.join("、"),
    calloutOnly: r.calloutOnly ?? false,
    wrapBackSpaces: r.wrapBackSpaces ?? true,
    splitBySemicolon: r.splitBySemicolon ?? false,
    customRules: (r.customRules ?? []).map((rule) => ({ ...rule })),
  };
}

function split(s: string): string[] {
  return s
    .split(/[,，、;；\s]+/)
    .map((k) => k.trim())
    .filter(Boolean);
}

function RuleToggle({
  checked,
  onChange,
  label,
  hint,
}: {
  checked: boolean;
  onChange: (v: boolean) => void;
  label: string;
  hint?: string;
}) {
  return (
    <label className="flex items-start gap-2.5">
      <input
        type="checkbox"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
        className="mt-0.5 h-4 w-4 shrink-0 accent-teal-600"
      />
      <span className="text-sm text-zinc-700">
        {label}
        {hint && <span className="block text-xs text-zinc-400">{hint}</span>}
      </span>
    </label>
  );
}

export function RecognitionRulesForm({ initial }: { initial: RecognitionRules | null }) {
  const router = useRouter();
  const [values, setValues] = useState<Values>(() => join(initial));
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // 自定义规则手风琴：一次只展开一条（规则多了列表不拉太长）。
  const [expandedRule, setExpandedRule] = useState<number | null>(null);

  function setField(key: "front" | "back" | "extra", value: string) {
    setValues((prev) => ({ ...prev, [key]: value }));
    setSaved(false);
  }

  function applyPreset(key: string) {
    const preset = RECOGNITION_PRESETS.find((p) => p.key === key);
    if (!preset) return;
    setValues(join(preset.rules));
    setSaved(false);
  }

  function addRule() {
    setValues((prev) => ({ ...prev, customRules: [...prev.customRules, { ...NEW_RULE }] }));
    setExpandedRule(values.customRules.length); // 新规则排在最后，展开它方便直接填
    setSaved(false);
  }

  function updateRule(i: number, patch: Partial<SplitRule>) {
    setValues((prev) => ({
      ...prev,
      customRules: prev.customRules.map((r, idx) => (idx === i ? { ...r, ...patch } : r)),
    }));
    setSaved(false);
  }

  function removeRule(i: number) {
    setValues((prev) => ({
      ...prev,
      customRules: prev.customRules.filter((_, idx) => idx !== i),
    }));
    setExpandedRule(null); // 删完收起，避免展开索引错位
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
      extra: split(values.extra),
      separator: null,
      calloutOnly: values.calloutOnly,
      wrapBackSpaces: values.wrapBackSpaces,
      splitBySemicolon: values.splitBySemicolon,
      // 没名字的规则、或「自定义正则」没填正则的规则，视为无效，丢弃。
      customRules: values.customRules.filter((r) => {
        if (!r.name.trim()) return false;
        if (r.mode === "custom") return Boolean(r.customPattern?.trim());
        return true;
      }),
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
      <div className="mb-5">
        <p className="mb-1.5 text-xs font-medium text-zinc-500">预设</p>
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

      {/* 表头关键词 */}
      <div className="mb-5">
        <p className="mb-1.5 text-xs font-medium text-zinc-500">表头关键词</p>
        <div className="space-y-3">
          {FIELDS.map((f) => (
            <div key={f.key}>
              <label className="mb-1 block text-xs font-medium text-zinc-600">{f.label}</label>
              <input
                value={values[f.key]}
                onChange={(e) => setField(f.key, e.target.value)}
                placeholder={f.placeholder}
                className="w-full rounded-lg border border-zinc-200 px-3 py-2 text-sm placeholder:text-sm text-zinc-800 focus:border-teal-500 focus:outline-none"
              />
            </div>
          ))}
        </div>
      </div>

      {/* 分隔规则（新增规则） */}
      <div className="mb-5">
        <div className="mb-1.5 flex items-center justify-between">
          <p className="text-xs font-medium text-zinc-500">分隔规则</p>
          <button
            onClick={addRule}
            className="inline-flex items-center gap-1 text-xs font-medium text-teal-600 transition-colors hover:text-teal-700"
          >
            <Plus className="h-3.5 w-3.5" />
            新增规则
          </button>
        </div>
        <p className="mb-2 text-xs text-zinc-400">
          内置已支持 词—释义 / 词：释义 / 词&nbsp;&nbsp;释义（两个空格）/ 表格。自定义规则命中时优先按它拆。
        </p>

        {values.customRules.length === 0 ? (
          <p className="rounded-lg border border-dashed border-zinc-200 px-3 py-3 text-center text-xs text-zinc-400">
            还没有自定义规则。点「新增规则」加一个（如按斜杠 / 或自定义正则分隔）。
          </p>
        ) : (
          <div className="space-y-2">
            {values.customRules.map((rule, i) => {
              const isOpen = expandedRule === i;
              return (
                <div key={i} className="rounded-xl border border-zinc-200 bg-zinc-50/60">
                  {/* 标题行：默认收起，点一下展开 / 收起（规则多了列表不拉太长） */}
                  <div
                    onClick={() => setExpandedRule(isOpen ? null : i)}
                    className="flex cursor-pointer items-center gap-2 px-3 py-2.5"
                  >
                    <ChevronDown
                      className={`h-4 w-4 shrink-0 text-zinc-400 transition-transform ${
                        isOpen ? "rotate-180" : ""
                      }`}
                    />
                    <span className="min-w-0 flex-1 truncate text-sm font-medium text-zinc-800">
                      {rule.name.trim() || "未命名规则"}
                    </span>
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        removeRule(i);
                      }}
                      className="shrink-0 rounded-md p-1 text-zinc-400 transition-colors hover:bg-red-50 hover:text-red-600"
                      aria-label="删除规则"
                    >
                      <Trash2 className="h-4 w-4" />
                    </button>
                  </div>

                  {isOpen && (
                    <div className="border-t border-zinc-100 p-3">
                      <input
                        value={rule.name}
                        onChange={(e) => updateRule(i, { name: e.target.value })}
                        placeholder="规则名称（如：斜杠分隔）"
                        className="w-full rounded-lg border border-zinc-200 bg-white px-3 py-1.5 text-sm font-medium text-zinc-800 focus:border-teal-500 focus:outline-none placeholder:text-sm"
                      />
                      <div className="mt-2 grid grid-cols-2 gap-2">
                        <select
                          value={rule.mode}
                          onChange={(e) => updateRule(i, { mode: e.target.value as SplitRule["mode"] })}
                          className="rounded-lg border border-zinc-200 bg-white px-2 py-1.5 text-sm text-zinc-700 focus:border-teal-500 focus:outline-none"
                        >
                          {(Object.keys(MODE_LABEL) as SplitRule["mode"][]).map((m) => (
                            <option key={m} value={m}>
                              {MODE_LABEL[m]}
                            </option>
                          ))}
                        </select>
                        <select
                          value={rule.kind}
                          onChange={(e) => updateRule(i, { kind: e.target.value as SplitRule["kind"] })}
                          className="rounded-lg border border-zinc-200 bg-white px-2 py-1.5 text-sm text-zinc-700 focus:border-teal-500 focus:outline-none"
                        >
                          {(Object.keys(KIND_LABEL) as SplitRule["kind"][]).map((k) => (
                            <option key={k} value={k}>
                              {KIND_LABEL[k]}
                            </option>
                          ))}
                        </select>

                        {rule.mode === "custom" && (
                          <input
                            value={rule.customPattern ?? ""}
                            onChange={(e) => updateRule(i, { customPattern: e.target.value })}
                            placeholder="正则，如 | 或 =="
                            className="col-span-2 rounded-lg border border-zinc-200 bg-white px-3 py-1.5 text-sm text-zinc-700 focus:border-teal-500 focus:outline-none placeholder:text-sm"
                          />
                        )}

                        <select
                          value={rule.appliesTo}
                          onChange={(e) =>
                            updateRule(i, { appliesTo: e.target.value as SplitRule["appliesTo"] })
                          }
                          className="col-span-2 rounded-lg border border-zinc-200 bg-white px-2 py-1.5 text-sm text-zinc-700 focus:border-teal-500 focus:outline-none"
                        >
                          {(Object.keys(APPLIES_LABEL) as SplitRule["appliesTo"][]).map((a) => (
                            <option key={a} value={a}>
                              {APPLIES_LABEL[a]}
                            </option>
                          ))}
                        </select>
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* 背面分行：哪些标记会让闪卡背面换行（同一类设置，放一组多选，不再单列一条） */}
      <div className="mb-5">
        <p className="mb-2 text-xs font-medium text-zinc-500">背面分行</p>
        <p className="mb-2 text-xs text-zinc-400">遇到下面这些标记时，闪卡背面就换行（可多选）。</p>

        <div className="space-y-2">
          <RuleToggle
            checked={values.wrapBackSpaces}
            onChange={(v) => {
              setValues((prev) => ({ ...prev, wrapBackSpaces: v }));
              setSaved(false);
            }}
            label="两个空格"
            hint="反面里释义和例句之间用两个空格隔开时，各自换行"
          />
          <RuleToggle
            checked={values.splitBySemicolon}
            onChange={(v) => {
              setValues((prev) => ({ ...prev, splitBySemicolon: v }));
              setSaved(false);
            }}
            label="分号 ；"
            hint="反面里的例句用分号分隔时，每句一行"
          />
        </div>
      </div>

      {/* 识别范围：从哪里取内容 */}
      <div className="mb-5">
        <p className="mb-2 text-xs font-medium text-zinc-500">识别范围</p>

        <div className="space-y-2">
          <RuleToggle
            checked={values.calloutOnly}
            onChange={(v) => {
              setValues((prev) => ({ ...prev, calloutOnly: v }));
              setSaved(false);
            }}
            label="只在彩色区块内识别"
            hint="只识别 生词/例句/语法 区块，不扫普通段落"
          />
        </div>
      </div>

      {error && <p className="mt-3 text-sm text-red-600">{error}</p>}

      <button onClick={save} disabled={busy} className="btn-brand w-full">
        {busy ? "保存中…" : saved ? "已保存 ✓" : "保存识别规则"}
      </button>
      <p className="mt-2 text-xs text-zinc-400">改完点下方保存；留空则用内置默认规则。</p>
    </div>
  );
}
