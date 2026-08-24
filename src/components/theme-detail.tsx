"use client";

// 词群「某个主题」的列表页：专注「看词 + 管理」。
// 排版参考「闪卡合集」的卡片网格（两列、正反面直接展示、不翻面）；
// 词群特有：右上「收录词」一个主按钮，每张卡「发音 + 移出」，底部低调「删除分类」。
// 批量「选择 / 全选 / 删除分类」在词群主页（外层）做，这里不重复，保持清爽。

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Plus, Tag, Search } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { BackButton } from "./back-button";
import { cardLang, type Lang } from "@/lib/lang-detect";
import type { CardWithNote } from "@/lib/types";
import { themeMeta } from "@/lib/word-themes";
import { CollectWordsModal } from "@/components/collect-words-modal";
import { CardTile } from "./card-tile";

export function ThemeDetail({
  themeKey,
  label,
  isCustom,
  cards,
  unclassified,
  hiddenThemes,
  lang = null,
}: {
  themeKey: string;
  label: string;
  isCustom: boolean;
  cards: CardWithNote[];
  unclassified: CardWithNote[];
  hiddenThemes: string[];
  lang?: Lang | null;
}) {
  const router = useRouter();
  const [collecting, setCollecting] = useState(false);
  const [busy, setBusy] = useState(false);
  const [query, setQuery] = useState("");
  const Icon = themeMeta(themeKey)?.icon ?? Tag;
  // 背诵返回时回到进入原处；从词群页带语言进来则回到「该语言的这个主题」列表。
  const backHref = `/groups/${themeKey}${lang ? `?lang=${lang}` : ""}`;

  // 搜索：按正面 / 背面文字过滤（不区分大小写）；从词群页带语言进来时同语言才显示。
  const q = query.trim().toLowerCase();
  const visible = cards.filter(
    (c) =>
      (!lang || cardLang(c) === lang) &&
      (!q ||
        c.front.toLowerCase().includes(q) ||
        (c.back ?? "").toLowerCase().includes(q))
  );

  // 从主题里移出某个词 = 清掉它的 theme 标签（不删卡片）。
  async function remove(cardId: string) {
    const supabase = createClient();
    const { error } = await supabase
      .from("cards")
      .update({ theme: null })
      .eq("id", cardId);
    if (!error) router.refresh();
  }

  // 删除分类：自定义分类直接删行；内置主题改成「隐藏」，词回到未分类。
  async function deleteTheme() {
    const supabase = createClient();
    if (isCustom) {
      if (
        !window.confirm(
          `删除分类「${label}」？里面的词会回到「未分类」，不会被删除。`
        )
      ) {
        return;
      }
      setBusy(true);
      // 先清掉该分类下卡片的 theme 标记，删除后这些卡才不会冒出「裸UUID」鬼分组。
      await supabase.from("cards").update({ theme: null }).eq("theme", themeKey);
      const { error } = await supabase.from("word_themes").delete().eq("id", themeKey);
      setBusy(false);
      if (error) return;
      router.push("/cards?view=theme");
      router.refresh();
      return;
    }

    if (
      !window.confirm(
        `删除分类「${label}」？它会在闪卡页里消失，里面的词回到「未分类」，词不会被删除。`
      )
    ) {
      return;
    }
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) return;
    setBusy(true);
    const next = Array.from(new Set([...hiddenThemes, themeKey]));
    const { error } = await supabase
      .from("user_settings")
      .upsert({ user_id: user.id, hidden_themes: next }, { onConflict: "user_id" });
    setBusy(false);
    if (!error) {
      router.push("/cards?view=theme");
      router.refresh();
    }
  }

  return (
    <div>
      <header className="page-header mb-5 flex items-center gap-3">
        <BackButton fallback="/cards?view=theme" />
        <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-teal-50">
          <Icon className="h-5 w-5 text-teal-600" />
        </span>
        <h1 className="text-xl font-bold text-zinc-900">{label}</h1>
        <span className="text-xs text-zinc-400">{cards.length} 条</span>
        <div className="ml-auto flex items-center gap-1.5">
          <Link
            href={`/review?theme=${themeKey}&back=${encodeURIComponent(backHref)}${lang ? `&lang=${lang}` : ""}`}
            className="rounded-lg border border-teal-200 px-3 py-1.5 text-sm font-semibold text-teal-600 transition-colors hover:bg-teal-50"
          >
            背
          </Link>
          <Link
            href={`/review?theme=${themeKey}&mode=test&back=${encodeURIComponent(backHref)}${lang ? `&lang=${lang}` : ""}`}
            className="rounded-lg border border-zinc-200 px-3 py-1.5 text-sm text-zinc-600 transition-colors hover:bg-zinc-50"
          >
            测
          </Link>
          <button
            onClick={() => setCollecting(true)}
            className="inline-flex items-center gap-1 rounded-lg bg-teal-600 px-3 py-1.5 text-sm font-semibold text-white transition-colors hover:bg-teal-700"
          >
            <Plus className="h-4 w-4" />
            收录词
          </button>
        </div>
      </header>

      {/* 搜索 */}
      {cards.length > 0 && (
        <div className="relative mb-4">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-zinc-400" />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={`搜索「${label}」里的词 / 例句 / 释义…`}
            className="w-full rounded-xl border border-zinc-200 bg-white py-2 pl-9 pr-3 text-sm focus:border-teal-500 focus:outline-none"
          />
        </div>
      )}

      {/* 词列表：卡片网格（翻面 + 就地编辑 + AI 解释，与按来源一致） */}
      {cards.length === 0 ? (
        <div className="rounded-xl border border-dashed border-zinc-300 px-4 py-10 text-center text-sm text-zinc-500">
          这个分类还没有内容，点右上角「收录词」把未归类的词/例句收进来。
        </div>
      ) : visible.length === 0 ? (
        <div className="rounded-xl border border-dashed border-zinc-300 px-4 py-10 text-center text-sm text-zinc-500">
          没有匹配「{query.trim()}」的词。
        </div>
      ) : (
        <ul className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          {visible.map((c) => (
            <li key={c.id}>
              <CardTile
                card={c}
                menu={true}
                menuItems={[{ label: "移出", onClick: () => remove(c.id) }]}
              />
            </li>
          ))}
        </ul>
      )}

      {/* 删除分类：低频危险操作，放底部低调处理 */}
      <div className="mt-6 flex justify-end border-t border-zinc-100 pt-3">
        <button
          onClick={deleteTheme}
          disabled={busy}
          className="text-xs text-zinc-400 transition-colors hover:text-red-600 disabled:opacity-60"
        >
          删除分类
        </button>
      </div>

      {collecting && (
        <CollectWordsModal
          themeKey={themeKey}
          themeLabel={label}
          unclassified={unclassified}
          onClose={() => setCollecting(false)}
          onDone={() => {
            setCollecting(false);
            router.refresh();
          }}
        />
      )}
    </div>
  );
}
