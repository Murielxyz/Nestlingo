import { notFound } from "next/navigation";
import {
  listWordCards,
  listWordThemes,
  getUserSettings,
  friendlyQueryError,
} from "@/lib/supabase/queries";
import { themeMeta, themeOf } from "@/lib/word-themes";
import { ThemeDetail } from "@/components/theme-detail";
import type { WordTheme } from "@/lib/types";

/**
 * 词群「某个主题」的列表页：显示该主题下所有生词，
 * 顶部提供 背 / 测 / 收录词 / 删除分类，每个词可 发音 / 移出。
 * 内置主题 key（beauty/game/…）或自定义分类 id 都指向这里。
 */
export default async function ThemeListPage({
  params,
}: {
  params: Promise<{ key: string }>;
}) {
  const { key } = await params;

  let cards: Awaited<ReturnType<typeof listWordCards>> = [];
  let themes: WordTheme[] = [];
  let hiddenThemes: string[] = [];
  let error: string | null = null;

  try {
    cards = await listWordCards();
  } catch (err) {
    error = friendlyQueryError(err);
  }
  // 自定义分类表可能还没建，出错就退回空，不影响内置主题。
  try {
    themes = await listWordThemes();
  } catch {
    themes = [];
  }
  try {
    hiddenThemes = (await getUserSettings()).hidden_themes;
  } catch {
    hiddenThemes = [];
  }

  const builtin = themeMeta(key);
  const custom = themes.find((t) => t.id === key);
  if (!builtin && !custom) notFound();

  const label = builtin?.label ?? custom?.name ?? key;
  const isCustom = !builtin;

  // 本主题下的词；「未归类」的词（含隐藏主题回流到「未分类」的）供「收录」弹窗选择。
  const themeCards = cards.filter((c) => themeOf(c, themes) === key);
  const unclassified = cards.filter((c) => {
    const k = themeOf(c, themes);
    return k === "other" || hiddenThemes.includes(k);
  });

  return (
    <div className="mx-auto max-w-2xl">
      {error && (
        <div className="mb-4 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
          {error}
        </div>
      )}
      <ThemeDetail
        themeKey={key}
        label={label}
        isCustom={isCustom}
        cards={themeCards}
        unclassified={unclassified}
        hiddenThemes={hiddenThemes}
      />
    </div>
  );
}
