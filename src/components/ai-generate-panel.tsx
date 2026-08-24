"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { X, Sparkles, Loader2, FolderPlus } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { detectLang, LANG_ORDER, LANG_LABEL, type Lang } from "@/lib/lang-detect";
import type { MaterialCollection } from "@/lib/types";

/** AI 生成素材面板：输入题材 + 语言 → AI 整理成一份可学习正文，存成一条 type=generated 素材。
 *  生成后进入其观看页查看/导入笔记。生成前必须选一个合集（未归类不显示）。 */
export function AiGeneratePanel({
  collections,
  defaultCollectionId,
  onClose,
}: {
  collections: MaterialCollection[];
  defaultCollectionId?: string;
  onClose: () => void;
}) {
  const router = useRouter();
  const [topic, setTopic] = useState("");
  const [lang, setLang] = useState<Lang>("other");
  const [collectionId, setCollectionId] = useState(defaultCollectionId ?? "");
  const [newColName, setNewColName] = useState("");
  const [showNewCol, setShowNewCol] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const input =
    "w-full rounded-lg border border-zinc-200 px-3 py-2 text-sm text-zinc-800 focus:border-teal-500 focus:outline-none";

  async function generate() {
    const t = topic.trim();
    if (!t) {
      setError("先输入一个题材，例如「日语 N3 语法」或「餐厅点餐韩语」。");
      return;
    }
    setBusy(true);
    setError(null);
    const supabase = createClient();

    // 填了新合集名就新建一个（覆盖下拉里已选的），否则用下拉选中的合集。
    let cid = collectionId;
    const newName = newColName.trim();
    if (newName) {
      const { data, error: cErr } = await supabase
        .from("material_collections")
        .insert({ name: newName })
        .select("id")
        .single();
      if (cErr || !data) {
        setError(cErr?.message ?? "创建合集失败");
        setBusy(false);
        return;
      }
      cid = data.id;
    }
    if (!cid) {
      setError("请选择一个合集，或点「新建」输入新合集名。");
      setBusy(false);
      return;
    }

    try {
      const res = await fetch("/api/materials/generate", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ topic: t, lang }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error ?? "生成失败");
      if (!data.content?.trim()) throw new Error("AI 没返回内容，请换个题材再试。");

      const { data: inserted, error: insErr } = await supabase
        .from("materials")
        .insert({
          url: "",
          type: "generated",
          title: data.title || `AI 生成：${t}`,
          content: data.content,
          lang: detectLang(t),
          collection_id: cid,
          status: "pending",
        })
        .select("id")
        .single();
      if (insErr || !inserted) throw new Error(insErr?.message ?? "保存失败");

      router.push(`/materials/${inserted.id}`);
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setBusy(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={onClose}>
      <div
        className="max-h-[85vh] w-full max-w-lg overflow-y-auto rounded-2xl bg-white p-5 shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
      <div className="mb-3 flex items-center justify-between">
        <h3 className="text-sm font-semibold text-zinc-800">AI 生成素材</h3>
        <button
          onClick={onClose}
          className="rounded-lg px-2 py-1 text-zinc-400 hover:bg-zinc-100 hover:text-zinc-700"
          aria-label="关闭"
        >
          <X className="h-4 w-4" />
        </button>
      </div>

      <div className="space-y-2">
        <textarea
          value={topic}
          onChange={(e) => setTopic(e.target.value)}
          placeholder="想整理什么？例如「日语 N3 全部语法知识点」"
          rows={2}
          className={input}
        />
        <div className="space-y-2">
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

          <div className="space-y-1.5">
            <div className="flex items-center gap-2">
              <select
                value={collectionId}
                onChange={(e) => setCollectionId(e.target.value)}
                className="min-w-0 flex-1 rounded-lg border border-zinc-200 px-3 py-2 text-sm text-zinc-800 focus:border-teal-500 focus:outline-none"
              >
                <option value="">选择一个合集…</option>
                {collections.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </select>
              <button
                type="button"
                onClick={() => setShowNewCol((v) => !v)}
                className="inline-flex shrink-0 items-center gap-1 rounded-lg border border-teal-200 px-3 py-2 text-sm font-medium text-teal-600 transition-colors hover:bg-teal-50"
              >
                <FolderPlus className="h-4 w-4" />
                新建
              </button>
            </div>
            {showNewCol && (
              <input
                value={newColName}
                onChange={(e) => setNewColName(e.target.value)}
                placeholder="输入新合集名"
                autoFocus
                className={input}
              />
            )}
          </div>
        </div>
      </div>

      {error && (
        <p className="mt-2 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-600">
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
          onClick={generate}
          disabled={busy || !topic.trim()}
          className="inline-flex items-center gap-1.5 rounded-lg bg-teal-600 px-4 py-2 text-sm font-semibold text-white hover:bg-teal-700 disabled:opacity-60"
        >
          {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />}
          {busy ? "生成中…" : "生成"}
        </button>
      </div>
      </div>
    </div>
  );
}
