"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { MoreHorizontal, FileText, Plus, RefreshCw, SquareCheckBig, Search, Pencil, Check, X, Trash2 } from "lucide-react";
import { createClient, detachMaterialsFromNote } from "@/lib/supabase/client";
import { cardLang, LANG_ORDER, LANG_LABEL, type Lang } from "@/lib/lang-detect";
import { parseCards, type ParsedCard } from "@/lib/parse-cards";
import { NoteCards } from "./note-cards";
import { BackButton } from "./back-button";
import type { Card } from "@/lib/types";

const KINDS: { key: string; label: string }[] = [
  { key: "word", label: "生词" },
  { key: "example", label: "例句" },
  { key: "grammar", label: "语法" },
];

/**
 * 一篇笔记的闪卡页主体：标题（与返回键同一行，同其它次级页）+ 「全部/生词/例句/语法」标签页 + 过滤后的卡片列表。
 * - 网页端（md+）：搜索行右侧直接放 选择 / 添加 / 背诵 三个按钮（仿闪卡页）。
 * - 手机端：这三个动作收进右侧 ⋯ 菜单（添加 / 选择 / 背诵），「选择」→ NoteCards 底部浮出 全选 / 删除所选 小条（批量删）。
 * - 「添加」→ 底部弹出表单（移动端上下排列）。
 * - 有分类卡时才显示标签页。
 */
export function NoteCardsTabs({
  title,
  cards,
  noteId,
  sourceType,
}: {
  title: string;
  cards: Card[];
  noteId: string;
  sourceType?: string | null;
}) {
  const router = useRouter();
  const [filter, setFilter] = useState<string>("all");
  const [menuOpen, setMenuOpen] = useState(false);
  const [adding, setAdding] = useState(false);
  const [selecting, setSelecting] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  const [renaming, setRenaming] = useState(false);
  const [name, setName] = useState(title);
  // 文字搜索框已从 NoteCards 提到本页（放在标题栏搜索按钮正下方、类型标签上方），这里管它的词与聚焦。
  const [searchQuery, setSearchQuery] = useState("");
  const searchRef = useRef<HTMLInputElement>(null);

  const startHref = `/review?note=${noteId}&back=${encodeURIComponent(`/notes/${noteId}/cards`)}`;

  // 移动端点标题栏放大镜「由关到开」时聚焦一次。
  const prevSearchOpen = useRef(searchOpen);
  useEffect(() => {
    if (searchOpen && !prevSearchOpen.current && searchRef.current) {
      searchRef.current.focus();
    }
    prevSearchOpen.current = searchOpen;
  }, [searchOpen]);

  /** 重命名这篇合集（标题是笔记 title；改完刷新让父级同步）。 */
  async function commitRename() {
    const n = name.trim();
    if (!n || n === title) {
      setRenaming(false);
      return;
    }
    const supabase = createClient();
    // 纯卡片文件没有独立笔记，改名合集=改名标题；普通笔记改名合集不碰原始笔记标题（写 cards_title）。
    const payload = sourceType === "cards" ? { title: n } : { cards_title: n };
    await supabase.from("notes").update(payload).eq("id", noteId);
    setRenaming(false);
    router.refresh();
  }

  /** 删除这个闪卡合集：纯闪卡文件连笔记一起删，普通笔记只删里面的卡片（正文保留）。 */
  async function deleteCollection() {
    const isCardFile = sourceType === "cards";
    const msg = isCardFile
      ? `删除闪卡合集「${title}」及里面的卡片？此操作不可恢复。`
      : `删除「${title}」下的全部闪卡？笔记正文会保留。`;
    if (!window.confirm(msg)) return;
    const supabase = createClient();
    if (isCardFile) {
      await detachMaterialsFromNote(noteId);
      await supabase.from("notes").delete().eq("id", noteId);
    } else {
      await supabase.from("cards").delete().eq("note_id", noteId);
    }
    setMenuOpen(false);
    router.push("/cards");
    router.refresh();
  }

  const counts = new Map<string, number>();
  for (const c of cards) {
    if (c.kind) counts.set(c.kind, (counts.get(c.kind) ?? 0) + 1);
  }
  const presentKinds = KINDS.filter((k) => (counts.get(k.key) ?? 0) > 0);
  // 只有「生词」一种类型时不显示「全部/生词」筛选（单一类型没意义）；
  // 出现例句/语法等其他类型才显示分类标签。
  const hasKinds = presentKinds.some((k) => k.key !== "word");

  // 删光某一类后，若还停在那一类，就退回「全部」，避免出现空列表。
  const effectiveFilter =
    filter !== "all" && (counts.get(filter) ?? 0) === 0 ? "all" : filter;

  // 只按「全部 / 生词 / 例句 / 语法」类型过滤；文字搜索交给 NoteCards 自己处理，避免笔记内页出现双搜索框。
  const visible =
    effectiveFilter === "all"
      ? cards
      : cards.filter((c) => c.kind === effectiveFilter);

  return (
    <div>
      {/* 标题栏：返回 ← + 标题 + 右侧 ⋯ 菜单（标题与返回同一行，同其它次级页） */}
      <header className="page-header mb-4 flex items-center gap-2">
        <BackButton fallback="/cards" />
        {renaming ? (
          <>
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              autoFocus
              onKeyDown={(e) => {
                if (e.key === "Enter") void commitRename();
                if (e.key === "Escape") setRenaming(false);
              }}
              className="min-w-0 flex-1 rounded-lg border border-teal-300 px-2 py-1 text-lg font-bold text-zinc-900 focus:outline-none"
            />
            <button
              onClick={() => void commitRename()}
              className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-lg text-teal-600 hover:bg-teal-50"
              aria-label="保存标题"
            >
              <Check className="h-5 w-5" />
            </button>
            <button
              onClick={() => setRenaming(false)}
              className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-lg text-zinc-400 hover:bg-zinc-100"
              aria-label="取消重命名"
            >
              <X className="h-5 w-5" />
            </button>
          </>
        ) : (
          <h1 className="min-w-0 flex-1 truncate text-lg font-bold text-zinc-900">
            {title}
          </h1>
        )}
        {!renaming && (
          <button
            onClick={() => {
              if (searchOpen) setSearchQuery("");
              setSearchOpen((v) => !v);
            }}
            className={`md:hidden inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-lg transition-colors ${
              searchOpen
                ? "bg-teal-50 text-teal-600"
                : "text-zinc-500 hover:bg-zinc-100 hover:text-zinc-700"
            }`}
            aria-label="搜索卡片"
            title="搜索卡片"
          >
            <Search className="h-5 w-5" />
          </button>
        )}
        <div className={`relative shrink-0 ${renaming ? "hidden" : ""}`}>
          <button
            onClick={() => setMenuOpen((v) => !v)}
            className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-lg text-zinc-500 transition-colors hover:bg-zinc-100 hover:text-zinc-700"
            aria-label="更多操作"
          >
            <MoreHorizontal className="h-5 w-5" />
          </button>
          {menuOpen && (
            <>
              <button
                className="fixed inset-0 z-10 cursor-default"
                onClick={() => setMenuOpen(false)}
                aria-label="关闭菜单"
              />
              <div className="absolute right-0 top-full z-20 mt-1 w-40 overflow-hidden rounded-lg border border-zinc-200 bg-white py-1 shadow-lg">
                {sourceType !== "cards" && (
                  <button
                    onClick={() => {
                      setMenuOpen(false);
                      router.push(`/notes/${noteId}`);
                    }}
                    className="flex w-full items-center gap-2 px-3 py-2.5 text-sm text-zinc-700 hover:bg-zinc-50"
                  >
                    <FileText className="h-4 w-4" /> 查看原始笔记
                  </button>
                )}
                <button
                  onClick={() => {
                    setAdding(true);
                    setMenuOpen(false);
                  }}
                  className="flex w-full items-center gap-2 px-3 py-2.5 text-sm text-zinc-700 hover:bg-zinc-50 md:hidden"
                >
                  <Plus className="h-4 w-4" /> 添加
                </button>
                <button
                  onClick={() => {
                    setMenuOpen(false);
                    router.push(startHref);
                  }}
                  className="flex w-full items-center gap-2 px-3 py-2.5 text-sm text-zinc-700 hover:bg-zinc-50 md:hidden"
                >
                  <RefreshCw className="h-4 w-4" /> 背诵
                </button>
                <button
                  onClick={() => {
                    setSelecting((v) => !v);
                    setMenuOpen(false);
                  }}
                  className="flex w-full items-center gap-2 px-3 py-2.5 text-sm text-zinc-700 hover:bg-zinc-50"
                >
                  <SquareCheckBig className="h-4 w-4" />
                  {selecting ? "退出选择" : "选择"}
                </button>
                <button
                  onClick={() => {
                    setName(title);
                    setRenaming(true);
                    setMenuOpen(false);
                  }}
                  className="flex w-full items-center gap-2 px-3 py-2.5 text-sm text-zinc-700 hover:bg-zinc-50"
                >
                  <Pencil className="h-4 w-4" /> 重命名
                </button>
                <button
                  onClick={() => void deleteCollection()}
                  className="flex w-full items-center gap-2 px-3 py-2.5 text-sm text-red-600 hover:bg-red-50"
                >
                  <Trash2 className="h-4 w-4" /> 删除合集
                </button>
              </div>
            </>
          )}
        </div>
      </header>

      {/* 搜索行：搜索框（手机点标题栏放大镜展开 / 桌面常驻）+ 右侧 选择/添加/背诵（桌面），紧贴标题栏搜索按钮下方、类型标签上方 */}
      <div className="mb-4 flex items-center gap-2">
        <div className={`relative min-w-0 flex-1 ${searchOpen ? "block" : "hidden"} md:block`}>
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-zinc-400" />
          <input
            ref={searchRef}
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="搜索这个合集里的词 / 释义…"
            autoFocus={!!searchOpen}
            className="w-full rounded-xl border border-zinc-200 bg-white py-2.5 pl-9 pr-9 text-sm focus:border-teal-500 focus:outline-none placeholder:text-sm"
          />
          {searchQuery && (
            <button
              onClick={() => setSearchQuery("")}
              className="absolute right-3 top-1/2 -translate-y-1/2 text-sm text-zinc-400 hover:text-zinc-600"
              aria-label="清空搜索"
            >
              ✕
            </button>
          )}
        </div>
        <div className="hidden shrink-0 items-center gap-1.5 md:flex">
          <button
            onClick={() => router.push(startHref)}
            className="inline-flex items-center gap-1 whitespace-nowrap rounded-lg border border-zinc-200 px-3 py-2 text-sm text-zinc-600 transition-colors hover:border-teal-300 hover:text-teal-700"
          >
            <RefreshCw className="h-4 w-4" /> 背诵
          </button>
          <button
            onClick={() => setAdding(true)}
            className="inline-flex items-center gap-1 whitespace-nowrap rounded-lg bg-teal-600 px-3 py-2 text-sm font-semibold text-white transition-colors hover:bg-teal-700"
          >
            <Plus className="h-4 w-4" /> 添加
          </button>
        </div>
      </div>

      {hasKinds && (
        <div className="mb-4 flex flex-wrap gap-1.5">
          <button
            onClick={() => setFilter("all")}
            className={`rounded-full px-3.5 py-2 text-sm transition-colors ${
              effectiveFilter === "all"
                ? "bg-teal-600 font-semibold text-white"
                : "border border-zinc-200 text-zinc-600 hover:bg-zinc-50"
            }`}
          >
            全部 {cards.length}
          </button>
          {presentKinds.map((k) => (
            <button
              key={k.key}
              onClick={() => setFilter(k.key)}
              className={`rounded-full px-3.5 py-2 text-sm transition-colors ${
                effectiveFilter === k.key
                  ? "bg-teal-600 font-semibold text-white"
                  : "border border-zinc-200 text-zinc-600 hover:bg-zinc-50"
              }`}
            >
              {k.label} {counts.get(k.key)}
            </button>
          ))}
        </div>
      )}

      <NoteCards
        cards={visible}
        selecting={selecting}
        onSetSelecting={setSelecting}
        hideSearch
        query={searchQuery}
        onQueryChange={setSearchQuery}
      />

      {adding && (
        <AddNoteSheet
          noteId={noteId}
          defaultLang={collectionLang(cards)}
          onClose={() => setAdding(false)}
        />
      )}
    </div>
  );
}

/** 该合集的主导语言（按卡片语言多数决），给「添加」表单做默认语言。 */
function collectionLang(cards: Card[]): Lang {
  const counts = new Map<Lang, number>();
  for (const c of cards) {
    const l = cardLang(c);
    counts.set(l, (counts.get(l) ?? 0) + 1);
  }
  let best: Lang = "other";
  let max = 0;
  for (const [l, n] of counts) if (n > max) {
    max = n;
    best = l;
  }
  return best;
}

/** 「添加到这本笔记」弹窗：支持直接粘贴识别（同闪卡页 AddCardsModal）。
 *  粘贴一段文本（词表 / Excel 表格 / 「词 — 释义」清单）→「识别成卡片」→ 可编辑列表 →「确认添加」整批入库。
 *  默认语言取合集主导语言；纯原文的语法卡（如泰语礼貌词）正面保持原文、不塞中文语法解释。 */
function AddNoteSheet({
  noteId,
  defaultLang,
  onClose,
}: {
  noteId: string;
  defaultLang: Lang;
  onClose: () => void;
}) {
  const router = useRouter();
  const [paste, setPaste] = useState("");
  const [lang, setLang] = useState<Lang>(defaultLang);
  const [drafts, setDrafts] = useState<ParsedCard[] | null>(null);
  const [busy, setBusy] = useState(false);

  function recognize() {
    const parsed = parseCards(paste);
    setDrafts(parsed.length ? parsed : null);
  }

  function patchDraft(i: number, patch: Partial<ParsedCard>) {
    setDrafts((prev) => prev?.map((c, ci) => (ci === i ? { ...c, ...patch } : c)) ?? null);
  }

  function removeDraft(i: number) {
    setDrafts((prev) => prev?.filter((_, ci) => ci !== i) ?? null);
  }

  function addBlank() {
    setDrafts((prev) => [...(prev ?? []), { front: "", back: "" }]);
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    const rows = (drafts ?? []).filter((c) => c.front.trim());
    if (rows.length === 0) return;
    setBusy(true);
    const supabase = createClient();
    const values = rows.map((c) => ({
      note_id: noteId,
      front: c.front.trim(),
      back: c.back.trim(),
      lang,
      kind: c.kind ?? null,
    }));
    const { error } = await supabase.from("cards").insert(values);
    setBusy(false);
    if (error) return;
    onClose();
    router.refresh();
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 sm:items-center sm:p-4"
      onClick={onClose}
    >
      <form
        onSubmit={submit}
        onClick={(e) => e.stopPropagation()}
        className="flex max-h-[85vh] w-full flex-col gap-3 overflow-y-auto rounded-t-3xl bg-white p-4 pt-5 shadow-xl sm:max-w-md sm:rounded-2xl"
      >
        <h2 className="text-base font-semibold text-zinc-900">添加闪卡</h2>

        <div className="flex items-center gap-2">
          <label className="shrink-0 text-xs text-zinc-400">语言</label>
          <select
            value={lang}
            onChange={(e) => setLang(e.target.value as Lang)}
            className="min-w-0 flex-1 rounded-lg border border-zinc-200 bg-white px-3 py-2 text-sm text-zinc-600 focus:border-teal-500 focus:outline-none"
          >
            {LANG_ORDER.map((l) => (
              <option key={l} value={l}>
                {LANG_LABEL[l]}
              </option>
            ))}
          </select>
        </div>

        {!drafts ? (
          <>
            <textarea
              value={paste}
              onChange={(e) => setPaste(e.target.value)}
              rows={6}
              autoFocus
              placeholder={"粘贴多个词条，可一键识别成卡片：\n词 — 释义  /  Excel表格  /  词表…"}
              className="w-full rounded-lg border border-zinc-300 px-3 py-2.5 text-sm focus:border-teal-500 focus:outline-none placeholder:text-sm"
            />
            <button
              type="button"
              onClick={recognize}
              disabled={!paste.trim()}
              className="rounded-lg bg-teal-600 px-4 py-2.5 text-sm font-semibold text-white hover:bg-teal-700 disabled:opacity-50"
            >
              识别成卡片
            </button>
          </>
        ) : (
          <div className="space-y-2">
            {drafts.length === 0 && (
              <p className="py-2 text-center text-xs text-zinc-400">没识别到卡片，请检查粘贴内容。</p>
            )}
            {drafts.map((c, i) => (
              <div key={i} className="rounded-lg border border-zinc-200 p-2.5">
                <div className="flex items-center gap-1.5">
                  <input
                    value={c.front}
                    onChange={(e) => patchDraft(i, { front: e.target.value })}
                    placeholder="正面（要记的词）"
                    className="min-w-0 flex-1 rounded-md border border-zinc-200 px-2.5 py-1.5 text-sm focus:border-teal-500 focus:outline-none placeholder:text-sm"
                  />
                  {c.kind && (
                    <span className="shrink-0 rounded bg-teal-50 px-1.5 py-0.5 text-[10px] font-medium text-teal-600">
                      {KINDS.find((k) => k.key === c.kind)?.label}
                    </span>
                  )}
                  <button
                    type="button"
                    onClick={() => removeDraft(i)}
                    className="shrink-0 rounded-md px-1.5 py-1 text-zinc-300 hover:text-red-500"
                    aria-label="删除这行"
                  >
                    ✕
                  </button>
                </div>
                <textarea
                  value={c.back}
                  onChange={(e) => patchDraft(i, { back: e.target.value })}
                  rows={2}
                  placeholder="背面（释义 / 读音，可换行加例句）"
                  className="mt-1.5 w-full rounded-md border border-zinc-200 px-2.5 py-1.5 text-sm focus:border-teal-500 focus:outline-none placeholder:text-sm"
                />
              </div>
            ))}
            <button
              type="button"
              onClick={addBlank}
              className="w-full rounded-lg border border-dashed border-zinc-200 py-2 text-sm text-zinc-400 hover:text-teal-600"
            >
              + 加一行
            </button>
            <button
              type="button"
              onClick={() => setDrafts(null)}
              className="w-full rounded-lg py-1 text-xs text-zinc-400 hover:text-zinc-600"
            >
              重新粘贴
            </button>
          </div>
        )}

        <div className="flex gap-2">
          <button
            type="button"
            onClick={onClose}
            className="flex-1 rounded-lg border border-zinc-200 px-4 py-2.5 text-sm text-zinc-600 hover:bg-zinc-50"
          >
            取消
          </button>
          <button
            type="submit"
            disabled={busy || !drafts || drafts.every((c) => !c.front.trim())}
            className="flex-1 rounded-lg bg-teal-600 px-4 py-2.5 text-sm font-semibold text-white hover:bg-teal-700 disabled:opacity-60"
          >
            {busy
              ? "添加中…"
              : `确认添加${drafts ? `（${drafts.filter((c) => c.front.trim()).length}张）` : ""}`}
          </button>
        </div>
      </form>
    </div>
  );
}
