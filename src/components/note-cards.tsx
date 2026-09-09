"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Search, Trash2 } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import type { Card } from "@/lib/types";
import { CardTile } from "./card-tile";
import { LANG_ORDER, LANG_LABEL, LANG_COLOR, type Lang } from "@/lib/lang-detect";

/**
 * 一组卡片（按来源展开后的卡片列表 / 独立卡片块）。
 * 默认只显示干净的翻面卡片（点一下翻面记忆）。
 * 传 selecting / onSetSelecting 时进入「选择」模式：底部浮出「全选 / 删除所选」小条（批量删）。
 * 「添加」「开始背诵」等入口在集合详情页的头部 ⋯ 菜单，列表里不再放。
 * 单张的翻面 / 编辑 / 「✨ AI 解释」统一走 CardTile（与按主题视图完全一致）。
 */
export function NoteCards({
  cards,
  selecting = false,
  onSetSelecting,
  actions,
  searchOpen = true,
  query: controlledQuery,
  onQueryChange,
  hideSearch = false,
}: {
  cards: Card[];
  /** 是否处于批量选择模式（由集合详情页头部 ⋯ 菜单「选择」驱动；独立闪卡块不传即用不到）。 */
  selecting?: boolean;
  onSetSelecting?: (v: boolean) => void;
  /** 搜索框右侧的操作按钮（网页端：选择 / 添加 / 背诵，仿闪卡页）；仅桌面端显示。 */
  actions?: React.ReactNode;
  /** 是否展示搜索框（移动端由集合详情页标题栏放大镜控制显隐；桌面端恒显）。 */
  searchOpen?: boolean;
  /** 受控搜索词（父级把搜索框提到筛选区上方时传入）；未传则内部自理。 */
  query?: string;
  onQueryChange?: (v: string) => void;
  /** 隐藏自带搜索框（搜索框已由父级渲染）。 */
  hideSearch?: boolean;
}) {
  const router = useRouter();
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [langOpen, setLangOpen] = useState(false);
  const [internalQuery, setInternalQuery] = useState("");
  const query = controlledQuery ?? internalQuery;
  const setQuery = onQueryChange ?? setInternalQuery;
  const searchRef = useRef<HTMLInputElement>(null);
  // 只在移动端点标题栏放大镜「由关到开」时聚焦一次；独立闪卡块常驻搜索（初始即开）不抢焦点。
  const prevSearchOpen = useRef(searchOpen);
  useEffect(() => {
    if (searchOpen && !prevSearchOpen.current && searchRef.current) {
      searchRef.current.focus();
    }
    prevSearchOpen.current = searchOpen;
  }, [searchOpen]);

  // 退出选择模式时清空已选 + 收起语言面板，下次进入从零开始。
  useEffect(() => {
    if (!selecting) {
      setSelected(new Set());
      setLangOpen(false);
    }
  }, [selecting]);

  // 搜索：按正面 / 背面文字过滤（不区分大小写）。
  const q = query.trim().toLowerCase();
  const visible = q
    ? cards.filter(
        (c) =>
          c.front.toLowerCase().includes(q) ||
          (c.back ?? "").toLowerCase().includes(q)
      )
    : cards;
  const allVisibleSelected =
    visible.length > 0 && visible.every((c) => selected.has(c.id));

  function toggleSelect(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function toggleAll() {
    setSelected(() =>
      allVisibleSelected ? new Set() : new Set(visible.map((c) => c.id))
    );
  }

  async function deleteSelected() {
    // 只删「当前可见 ∧ 选中」的卡：搜索会把部分卡藏起来，不能顺手删掉看不到的。
    const toDelete = visible.filter((c) => selected.has(c.id)).map((c) => c.id);
    if (toDelete.length === 0) return;
    if (!window.confirm(`删除选中的 ${toDelete.length} 张闪卡？`)) return;
    const supabase = createClient();
    const { error } = await supabase
      .from("cards")
      .delete()
      .in("id", toDelete);
    if (error) return;
    setSelected(new Set());
    onSetSelecting?.(false);
    router.refresh();
  }

  /** 批量修改选中卡片的语言（同卡片编辑里的「语言」下拉）。 */
  async function batchLang(lang: Lang) {
    const ids = cards.filter((c) => selected.has(c.id)).map((c) => c.id);
    if (ids.length === 0) return;
    const supabase = createClient();
    await supabase.from("cards").update({ lang }).in("id", ids);
    setLangOpen(false);
    router.refresh();
  }

  return (
    <div className="space-y-4">
      {/* 搜索行（右上可放操作按钮——网页端：选择 / 添加 / 背诵，仿闪卡页搜索行）；移动端由父级 searchOpen 控制显隐、桌面端恒显。 */}
      {!hideSearch && cards.length > 0 && (
        <div className="flex items-center gap-2">
          <div className={`relative min-w-0 flex-1 ${searchOpen ? "block" : "hidden"} md:block`}>
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-zinc-400" />
            <input
              ref={searchRef}
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="搜索这个合集里的词 / 释义…"
              className="w-full rounded-xl border border-zinc-200 bg-white py-2.5 pl-9 pr-3 text-sm focus:border-teal-500 focus:outline-none placeholder:text-sm"
            />
          </div>
          {actions && (
            <div className="hidden shrink-0 items-center gap-1.5 md:flex">{actions}</div>
          )}
        </div>
      )}

      {cards.length === 0 ? (
        <div className="rounded-xl border border-dashed border-zinc-300 px-4 py-10 text-center text-sm text-zinc-500">
          还没有闪卡。去笔记里「⋯ → 转成闪卡」生成，或点右上角「添加」。
        </div>
      ) : visible.length === 0 ? (
        <div className="rounded-xl border border-dashed border-zinc-300 px-4 py-10 text-center text-sm text-zinc-500">
          没有匹配「{query.trim()}」的闪卡。
        </div>
      ) : (
        <ul className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          {visible.map((card) => (
            <li key={card.id}>
              <CardTile
                card={card}
                selecting={selecting}
                checked={selected.has(card.id)}
                onToggleSelect={() => toggleSelect(card.id)}
              />
            </li>
          ))}
        </ul>
      )}

      {/* 选择模式：底部浮出「全选 / 换语言 / 删除（取消）」小条——全选左，删除所选右；没选中时右侧显示「取消」直接退出，不用再拉菜单。
          换语言点开后上方弹出语言 chips（默认收起，不占地方，避免破坏现有布局）。 */}
      {selecting && cards.length > 0 && (
        <div className="sticky bottom-4 z-20">
          {langOpen && selected.size > 0 && (
            <div className="mx-auto mb-2 flex max-w-sm flex-wrap items-center gap-1.5 rounded-2xl border border-zinc-200 bg-white p-2 shadow-lg">
              <span className="px-1 text-xs text-zinc-400">换成</span>
              {LANG_ORDER.map((l) => (
                <button
                  key={l}
                  onClick={() => void batchLang(l)}
                  className={`rounded-full border border-transparent px-2.5 py-1 text-xs font-medium transition-colors hover:opacity-80 ${LANG_COLOR[l]}`}
                >
                  {LANG_LABEL[l]}
                </button>
              ))}
            </div>
          )}
          <div className="mx-auto flex max-w-sm items-center justify-between rounded-full border border-zinc-200 bg-white px-4 py-2.5 shadow-lg">
            <button
              onClick={toggleAll}
              className="text-sm font-medium text-teal-600 transition-colors hover:underline"
            >
              {allVisibleSelected ? "取消全选" : "全选"}
            </button>
            <span className="text-sm text-zinc-400">已选 {selected.size}</span>
            <button
              onClick={() => setLangOpen((v) => !v)}
              disabled={selected.size === 0}
              className="text-sm font-medium text-zinc-600 transition-colors hover:text-teal-700 disabled:opacity-50"
            >
              语言
            </button>
            <button
              onClick={() => (selected.size === 0 ? onSetSelecting?.(false) : deleteSelected())}
              className={
                selected.size === 0
                  ? "text-sm font-medium text-zinc-500 transition-colors hover:text-zinc-700"
                  : "text-sm font-medium text-red-600 transition-colors hover:text-red-700"
              }
            >
              {selected.size === 0 ? "取消" : "删除所选"}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
