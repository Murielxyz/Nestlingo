"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { parseCards, type ParsedCard } from "@/lib/parse-cards";

/**
 * 「添加闪卡」：粘贴任意文本（Excel 表格 / Word / 别的笔记），
 * 解析成卡片，确认后作为「独立卡片」入库（不挂在某篇笔记下）。
 */
export function AddCardsButton() {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button
        onClick={() => setOpen(true)}
        className="rounded-lg bg-teal-600 px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-teal-700"
      >
        ＋ 添加闪卡
      </button>
      {open && <AddCardsModal onClose={() => setOpen(false)} />}
    </>
  );
}

function AddCardsModal({ onClose }: { onClose: () => void }) {
  const router = useRouter();
  const [source, setSource] = useState("");
  const [title, setTitle] = useState("");
  const [cards, setCards] = useState<ParsedCard[]>([]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  function parse() {
    setCards(parseCards(source));
    setError(null);
  }

  function update(i: number, field: "front" | "back", value: string) {
    setCards((prev) =>
      prev.map((c, idx) => (idx === i ? { ...c, [field]: value } : c))
    );
  }

  function remove(i: number) {
    setCards((prev) => prev.filter((_, idx) => idx !== i));
  }

  async function save() {
    const rows = cards
      .filter((c) => c.front.trim())
      .map((c, i) => ({
        front: c.front.trim(),
        back: c.back.trim(),
        position: i,
      }));
    if (rows.length === 0) {
      setError("没有可入库的卡片。");
      return;
    }
    setSaving(true);
    setError(null);
    const supabase = createClient();
    // 先建一个「卡片文件」（空笔记，source_type 标记为 cards），再把卡挂进去，
    // 这样卡片页 / 复习页能按文件分组，而不是散落的独立卡片。
    const { data: note, error: noteErr } = await supabase
      .from("notes")
      .insert({ title: title.trim() || "未命名卡片集", source_type: "cards" })
      .select("id")
      .single();
    if (noteErr || !note) {
      setSaving(false);
      setError(noteErr?.message ?? "创建卡片文件失败。");
      return;
    }
    const { error } = await supabase
      .from("cards")
      .insert(rows.map((r) => ({ ...r, note_id: note.id })));
    setSaving(false);
    if (error) {
      setError(error.message);
      return;
    }
    setDone(true);
    router.refresh();
  }

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 sm:items-center sm:p-4">
      <div className="flex max-h-[88vh] w-full flex-col rounded-t-2xl bg-white shadow-xl sm:max-w-lg sm:rounded-2xl">
        <header className="flex items-start justify-between border-b border-zinc-100 px-4 py-3">
          <div>
            <h2 className="text-base font-semibold text-zinc-900">添加闪卡</h2>
            <p className="mt-0.5 text-xs text-zinc-500">
              粘贴内容自动识别成卡片，存成一个卡片文件。
            </p>
          </div>
          <button
            onClick={onClose}
            className="rounded-lg px-2 py-1 text-zinc-400 hover:bg-zinc-100 hover:text-zinc-700"
            aria-label="关闭"
          >
            ✕
          </button>
        </header>

        {done ? (
          <div className="px-4 py-10 text-center">
            <p className="text-3xl">✅</p>
            <p className="mt-3 text-sm text-zinc-700">
              已把 {cards.length} 张卡片放进「{title.trim() || "未命名卡片集"}」。
            </p>
            <button
              onClick={onClose}
              className="mt-6 rounded-lg bg-teal-600 px-5 py-2 text-sm font-semibold text-white hover:bg-teal-700"
            >
              完成
            </button>
          </div>
        ) : (
          <>
            <div className="space-y-3 border-b border-zinc-100 px-4 py-3">
              <input
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder="文件标题（例如：泰语生词 · 第 1 课）"
                className="w-full rounded-lg border border-zinc-200 px-3 py-2 text-sm font-medium text-zinc-800 focus:border-teal-500 focus:outline-none"
              />
              <textarea
                value={source}
                onChange={(e) => setSource(e.target.value)}
                rows={4}
                placeholder="粘贴内容，例如：&#10;词汇	读音	释义&#10;สวัสดี	sà-wàt-dii	你好"
                className="w-full rounded-lg border border-zinc-200 bg-zinc-50 px-3 py-2 text-xs text-zinc-700 focus:border-teal-500 focus:outline-none"
              />
              <button
                onClick={parse}
                className="w-full rounded-lg border border-teal-200 px-4 py-2 text-sm font-medium text-teal-600 hover:bg-teal-50"
              >
                识别成卡片
              </button>
            </div>

            <div className="flex-1 space-y-3 overflow-y-auto px-4 py-3">
              {cards.length === 0 ? (
                <p className="text-center text-sm text-zinc-400">
                  粘贴内容后点「识别成卡片」。
                </p>
              ) : (
                cards.map((c, i) => (
                  <div key={i} className="space-y-2 rounded-xl border border-zinc-200 bg-zinc-50/60 p-3">
                    <input
                      value={c.front}
                      onChange={(e) => update(i, "front", e.target.value)}
                      placeholder="正面"
                      className="w-full rounded-lg border border-zinc-200 bg-white px-3 py-1.5 text-sm font-medium text-zinc-900 focus:border-teal-500 focus:outline-none"
                    />
                    <textarea
                      value={c.back}
                      onChange={(e) => update(i, "back", e.target.value)}
                      placeholder="背面（可换行加例句）"
                      rows={2}
                      className="w-full rounded-lg border border-zinc-200 bg-white px-3 py-1.5 text-sm text-zinc-600 focus:border-teal-500 focus:outline-none"
                    />
                    <button
                      onClick={() => remove(i)}
                      className="text-xs text-zinc-400 hover:text-red-600"
                    >
                      删除这一张
                    </button>
                  </div>
                ))
              )}
            </div>

            <footer className="flex gap-2 border-t border-zinc-100 px-4 py-3">
              <button
                onClick={onClose}
                className="flex-1 rounded-lg border border-zinc-200 px-4 py-2 text-sm text-zinc-600 hover:bg-zinc-50"
              >
                取消
              </button>
              <button
                onClick={save}
                disabled={saving || cards.length === 0}
                className="flex-1 rounded-lg bg-teal-600 px-4 py-2 text-sm font-semibold text-white hover:bg-teal-700 disabled:opacity-60"
              >
                {saving ? "入库中…" : `确认入库 ${cards.length} 张`}
              </button>
            </footer>

            {error && <p className="px-4 pb-3 text-sm text-red-600">{error}</p>}
          </>
        )}
      </div>
    </div>
  );
}
