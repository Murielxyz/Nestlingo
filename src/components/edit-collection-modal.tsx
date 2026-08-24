"use client";

import { useState } from "react";
import { X, Loader2, Save } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { LANG_ORDER, LANG_LABEL, type Lang } from "@/lib/lang-detect";
import { MATERIAL_TYPE_LABEL } from "@/lib/types";
import type { MaterialCollection, MaterialType } from "@/lib/types";

const TYPE_ORDER: MaterialType[] = [
  "youtube",
  "audio",
  "spotify",
  "link",
  "podcast",
  "file",
  "generated",
];

function collectionLang(c: MaterialCollection): Lang {
  const l = c.lang as Lang | null | undefined;
  return l && l in LANG_LABEL ? l : "other";
}

const input =
  "w-full rounded-lg border border-zinc-200 px-3 py-2 text-sm text-zinc-800 focus:border-teal-500 focus:outline-none";

/** 编辑合集弹窗：改名，以及定义语言 / 类型标签（没定义时筛选按里面素材兜底，不定义就留空）。 */
export function EditCollectionModal({
  collection,
  onClose,
  onSaved,
}: {
  collection: MaterialCollection;
  onClose: () => void;
  onSaved: (updated: MaterialCollection) => void;
}) {
  const [name, setName] = useState(collection.name);
  const [lang, setLang] = useState<Lang | "">(collectionLang(collection) === "other" && !collection.lang ? "" : (collection.lang as Lang) ?? "");
  const [type, setType] = useState<MaterialType | "">(collection.type ?? "");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function save() {
    setSaving(true);
    setError(null);
    const supabase = createClient();
    const { data, error } = await supabase
      .from("material_collections")
      .update({ name: name.trim(), lang: lang || null, type: type || null })
      .eq("id", collection.id)
      .select()
      .single();
    setSaving(false);
    if (error || !data) {
      setError(error?.message ?? "保存失败");
      return;
    }
    onSaved(data as MaterialCollection);
    onClose();
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div className="max-h-[85vh] w-full max-w-md overflow-y-auto rounded-2xl bg-white p-5 shadow-xl">
        <div className="mb-3 flex items-center justify-between">
          <h3 className="text-base font-semibold text-zinc-900">编辑合集</h3>
          <button
            onClick={onClose}
            className="rounded-lg px-2 py-1 text-zinc-400 hover:bg-zinc-100 hover:text-zinc-700"
            aria-label="关闭"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="space-y-3">
          <input value={name} onChange={(e) => setName(e.target.value)} placeholder="合集名" className={input} />
          <div className="flex flex-wrap gap-2">
            <select
              value={type}
              onChange={(e) => setType(e.target.value as MaterialType | "")}
              className="w-auto flex-none rounded-lg border border-zinc-200 px-3 py-2 text-sm"
            >
              <option value="">类型：不定义</option>
              {TYPE_ORDER.map((t) => (
                <option key={t} value={t}>
                  {MATERIAL_TYPE_LABEL[t]}
                </option>
              ))}
            </select>
            <select
              value={lang}
              onChange={(e) => setLang(e.target.value as Lang | "")}
              className="w-auto flex-none rounded-lg border border-zinc-200 px-3 py-2 text-sm"
            >
              <option value="">语言：不定义</option>
              {LANG_ORDER.map((l) => (
                <option key={l} value={l}>
                  {LANG_LABEL[l]}
                </option>
              ))}
            </select>
          </div>
          <p className="text-xs text-zinc-400">
            定义后，筛选 / 详情按这个标签归类；留空则按里面素材的语言 / 类型兜底。
          </p>
        </div>

        {error && (
          <p className="mt-3 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-600">
            {error}
          </p>
        )}

        <div className="mt-4 flex justify-end gap-2">
          <button
            onClick={onClose}
            className="rounded-lg border border-zinc-200 px-4 py-2 text-sm text-zinc-600 hover:bg-zinc-50"
          >
            取消
          </button>
          <button
            onClick={save}
            disabled={saving || !name.trim()}
            className="inline-flex items-center gap-1.5 rounded-lg bg-teal-600 px-4 py-2 text-sm font-semibold text-white hover:bg-teal-700 disabled:opacity-60"
          >
            {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
            {saving ? "保存中…" : "保存"}
          </button>
        </div>
      </div>
    </div>
  );
}
