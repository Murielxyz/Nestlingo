import Link from "next/link";
import {
  listCardGroups,
  listOrphanCards,
  listWordCards,
  listWordThemes,
  getUserSettings,
  friendlyQueryError,
} from "@/lib/supabase/queries";
import { AddCardsButton } from "@/components/add-cards-button";
import { ExportCardsButton } from "@/components/export-cards-button";
import { CardsView } from "@/components/cards-view";
import { GroupBrowser } from "@/components/group-browser";
import { EmptyState } from "@/components/empty-state";
import { PageHeader } from "@/components/page-header";
import { Layers, Tags } from "lucide-react";
import type { Card, CardFolderGroup } from "@/lib/types";

type View = "source" | "theme";

/** 顶部「按来源 / 按主题」切换：用链接 + 查询参数切换，可分享、可从详情页退回。 */
function ViewSwitch({ view }: { view: View }) {
  const tab = (active: boolean) =>
    `inline-flex items-center gap-1.5 rounded-lg px-4 py-2 text-sm font-medium transition-colors ${
      active ? "bg-teal-600 text-white shadow-sm" : "text-zinc-500 hover:text-zinc-900"
    }`;
  return (
    <div className="mb-5 inline-flex items-center gap-1 rounded-xl border border-zinc-200 bg-white p-1">
      <Link href="/cards" className={tab(view === "source")}>
        <Layers className="h-4 w-4" />
        按来源
      </Link>
      <Link href="/cards?view=theme" className={tab(view === "theme")}>
        <Tags className="h-4 w-4" />
        按主题
      </Link>
    </div>
  );
}

export default async function CardsPage({
  searchParams,
}: {
  searchParams: Promise<{ view?: string }>;
}) {
  const { view: viewParam } = await searchParams;
  const view: View = viewParam === "theme" ? "theme" : "source";

  // 按来源：所有卡按「来源笔记」分组。
  let groups: CardFolderGroup[] = [];
  let orphans: Card[] = [];
  // 按主题：只归类生词（kind='word'）到场景主题。
  let wordCards: Awaited<ReturnType<typeof listWordCards>> = [];
  let themes: Awaited<ReturnType<typeof listWordThemes>> = [];
  let hiddenThemes: string[] = [];
  let sourceError: string | null = null;
  let themeError: string | null = null;

  try {
    [groups, orphans] = await Promise.all([listCardGroups(), listOrphanCards()]);
  } catch (err) {
    sourceError = friendlyQueryError(err);
  }
  try {
    wordCards = await listWordCards();
  } catch (err) {
    themeError = friendlyQueryError(err);
  }
  // 自定义分类表 / 设置可能还没迁移，出错就退回空（不影响内置主题）。
  try {
    themes = await listWordThemes();
  } catch {
    themes = [];
  }
  try {
    hiddenThemes = (await getUserSettings()).hidden_themes ?? [];
  } catch {
    hiddenThemes = [];
  }

  const totalNotes = groups.reduce((s, g) => s + g.notes.length, 0);
  const activeError = view === "theme" ? themeError : sourceError;

  return (
    <div>
      {/* 页头只留标题；「按来源/按主题」切换左对齐放在标题下方（与素材页 Tab 同侧） */}
      <PageHeader title="闪卡" />

      <ViewSwitch view={view} />

      {activeError ? (
        <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
          {activeError}
        </div>
      ) : totalNotes === 0 && orphans.length === 0 ? (
        <>
          {/* 空态也要保留「添加闪卡」，因为此时最需要它 */}
          <div className="mb-4 flex flex-wrap items-center justify-end gap-2">
            <ExportCardsButton />
            <AddCardsButton />
          </div>
          <EmptyState
            icon={<Layers className="h-10 w-10" />}
            title="还没有闪卡"
            description="在笔记里点「⋯ → 转成闪卡」自动生成，或点右上角「＋ 添加闪卡」粘贴内容。"
          />
        </>
      ) : view === "theme" ? (
        <GroupBrowser cards={wordCards} themes={themes} hiddenThemes={hiddenThemes} />
      ) : (
        <CardsView
          groups={groups}
          orphans={orphans}
          actions={
            <>
              <ExportCardsButton />
              <AddCardsButton />
            </>
          }
        />
      )}
    </div>
  );
}
