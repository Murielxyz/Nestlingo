"use client";

import { useState } from "react";
import { X, Loader2, Save } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { LANG_ORDER, LANG_LABEL, type Lang } from "@/lib/lang-detect";
import { MATERIAL_TYPE_LABEL } from "@/lib/types";
import type { Material, MaterialCollection, MaterialType } from "@/lib/types";

const TYPE_ORDER: MaterialType[] = [
  "youtube",
  "audio",
  "spotify",
  "link",
  "podcast",
  "file",
  "generated",
];

function materialLang(m: Material): Lang {
  const l = m.lang as Lang | null | undefined;
  return l && l in LANG_LABEL ? l : "other";
}

const input =
  "w-full rounded-lg border border-zinc-200 px-3 py-2 text-sm text-zinc-800 focus:border-teal-500 focus:outline-none";

/** 编辑素材弹窗：改标题 / 来源 / 语言 / 类型 / 归属合集（从不归合集到任意合集、或移出）。 */
export function EditMaterialModal({
  material,
  collections,
  onClose,
  onSaved,
}: {
  material: Material;
  collections: MaterialCollection[];
  onClose: () => void;
  onSaved: () => void;
}) {
  const [title, setTitle] = useState(material.title);
  const [source, setSource] = useState(material.source ?? "");
  const [lang, setLang] = useState<Lang>(materialLang(material));
  const [type, setType] = useState<MaterialType>(material.type);
  const [collectionId, setCollectionId] = useState(material.collection_id ?? "");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function save() {
    setSaving(true);
    setError(null);
    const supabase = createClient();
    const { error } = await supabase
      .from("materials")
      .update({
        title: title.trim() || material.url,
        source: source.trim() || null,
        lang,
        type,
        collection_id: collectionId || null,
      })
      .eq("id", material.id);
    setSaving(false);
    if (error) {
      setError(error.message);
      return;
    }
    onSaved();
    onClose();
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div className="max-h-[85vh] w-full max-w-md overflow-y-auto rounded-2xl bg-white p-5 shadow-xl">
        <div className="mb-3 flex items-center justify-between">
          <h3 className="text-base font-semibold text-zinc-900">编辑素材</h3>
          <button
            onClick={onClose}
            className="rounded-lg px-2 py-1 text-zinc-400 hover:bg-zinc-100 hover:text-zinc-700"
            aria-label="关闭"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="space-y-3">
          <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="标题" className={input} />
          <input
            value={source}
            onChange={(e) => setSource(e.target.value)}
            placeholder="来源（频道 / 作者 / 站名）"
            className={input}
          />
          <div className="flex flex-wrap gap-2">
            <select
              value={lang}
              onChange={(e) => setLang(e.target.value as Lang)}
              className="w-auto flex-none rounded-lg border border-zinc-200 px-3 py-2 text-sm"
            >
              {LANG_ORDER.map((l) => (
                <option key={l} value={l}>
                  {LANG_LABEL[l]}
                </option>
              ))}
            </select>
            <select
              value={type}
              onChange={(e) => setType(e.target.value as MaterialType)}
              className="w-auto flex-none rounded-lg border border-zinc-200 px-3 py-2 text-sm"
            >
              {TYPE_ORDER.map((t) => (
                <option key={t} value={t}>
                  {MATERIAL_TYPE_LABEL[t]}
                </option>
              ))}
            </select>
          </div>
          <select
            value={collectionId}
            onChange={(e) => setCollectionId(e.target.value)}
            className={input}
          >
            <option value="">不归合集（单条）</option>
            {collections.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
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
            disabled={saving}
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
