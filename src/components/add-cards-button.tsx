"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { FileUp, CircleCheck } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { parseCards, type ParsedCard } from "@/lib/parse-cards";
import { detectCardLang } from "@/lib/lang-detect";
import type { RecognitionRules } from "@/lib/types";

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
        className="inline-flex items-center gap-1 rounded-lg bg-teal-600 px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-teal-700"
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
  const [rules, setRules] = useState<RecognitionRules | null>(null);
  const [fileBusy, setFileBusy] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // 拉取自定义识别规则，识别时按它归类表头。
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const supabase = createClient();
      const { data } = await supabase
        .from("user_settings")
        .select("recognition_rules")
        .limit(1)
        .maybeSingle();
      if (!cancelled) {
        setRules((data?.recognition_rules ?? null) as RecognitionRules | null);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  function parse() {
    setCards(parseCards(source, rules));
    setError(null);
  }

  // 导入 Excel / CSV / Word 文件：读成文本后填进输入框，再让用户点「识别成卡片」。
  async function handleFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    setFileBusy(true);
    setError(null);
    try {
      const ext = file.name.split(".").pop()?.toLowerCase() ?? "";
      const buf = await file.arrayBuffer();
      let text = "";
      if (ext === "docx") {
        // Word：动态加载 mammoth，抽成纯文本（词表/表格按行铺开）。
        const mammoth = await import("mammoth");
        const res = await mammoth.extractRawText({ arrayBuffer: buf });
        text = res.value;
      } else {
        // Excel（xlsx/xls）/ CSV：读第一张表，转成「制表符分隔」文本，识别成表格。
        const XLSX = await import("xlsx");
        const wb = XLSX.read(buf, { type: "array" });
        const sheet = wb.Sheets[wb.SheetNames[0]];
        if (!sheet) throw new Error("文件里没有可读的工作表。");
        const rows = XLSX.utils.sheet_to_json(sheet, { header: 1 }) as unknown[][];
        text = rows
          .map((r) =>
            r.map((cell) => (cell == null ? "" : String(cell)).trim()).join("\t")
          )
          .join("\n");
      }
      if (!text.trim()) {
        setError("没有从文件里读到内容，请确认不是空的文件。");
        return;
      }
      setSource(text);
      // 文件名当默认标题（用户可再改）。
      if (!title.trim()) setTitle(file.name.replace(/\.[^.]+$/, ""));
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setFileBusy(false);
    }
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
        kind: c.kind ?? null,
        lang: detectCardLang({ front: c.front.trim(), back: c.back.trim() }),
        position: i,
      }));
    if (rows.length === 0) {
      setError("没有可入库的闪卡。");
      return;
    }
    setSaving(true);
    setError(null);
    const supabase = createClient();
    // 先建一个「闪卡文件」（空笔记，source_type 标记为 cards），再把卡挂进去，
    // 这样卡片页 / 复习页能按文件分组，而不是散落的独立卡片。
    const { data: note, error: noteErr } = await supabase
      .from("notes")
      .insert({ title: title.trim() || "未命名闪卡集", source_type: "cards" })
      .select("id")
      .single();
    if (noteErr || !note) {
      setSaving(false);
      setError(noteErr?.message ?? "创建闪卡文件失败。");
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
              粘贴内容自动识别成卡片，存成一个闪卡文件。
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
            <CircleCheck className="mx-auto h-10 w-10 text-teal-500" />
            <p className="mt-3 text-sm text-zinc-700">
              已把 {cards.length} 张闪卡放进「{title.trim() || "未命名闪卡集"}」。
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
              <div className="flex items-center justify-between gap-2">
                <span className="text-xs text-zinc-400">支持导入 Excel / CSV / Word</span>
                <button
                  type="button"
                  onClick={() => fileInputRef.current?.click()}
                  disabled={fileBusy}
                  className="inline-flex items-center gap-1.5 rounded-lg border border-zinc-200 px-3 py-1.5 text-xs font-medium text-zinc-600 transition-colors hover:bg-zinc-50 disabled:opacity-60"
                >
                  <FileUp className="h-3.5 w-3.5" />
                  {fileBusy ? "读取中…" : "导入文件"}
                </button>
                <input
                  ref={fileInputRef}
                  type="file"
                  accept=".xlsx,.xls,.csv,.docx"
                  className="hidden"
                  onChange={handleFile}
                />
              </div>
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
