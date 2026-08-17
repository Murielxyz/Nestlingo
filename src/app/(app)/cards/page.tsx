import { listCardGroups, listOrphanCards, friendlyQueryError } from "@/lib/supabase/queries";
import { AddCardsButton } from "@/components/add-cards-button";
import { ExportCardsButton } from "@/components/export-cards-button";
import { CardsView } from "@/components/cards-view";
import { EmptyState } from "@/components/empty-state";
import type { Card, CardFolderGroup } from "@/lib/types";

export default async function CardsPage() {
  let groups: CardFolderGroup[] = [];
  let orphans: Card[] = [];
  let error: string | null = null;
  try {
    [groups, orphans] = await Promise.all([listCardGroups(), listOrphanCards()]);
  } catch (err) {
    error = friendlyQueryError(err);
  }

  const totalNotes = groups.reduce((s, g) => s + g.notes.length, 0);

  return (
    <div>
      <header className="mb-6 flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-zinc-900">闪卡</h1>
        </div>
        <div className="flex items-center gap-2">
          <ExportCardsButton />
          <AddCardsButton />
        </div>
      </header>

      {error ? (
        <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
          {error}
        </div>
      ) : totalNotes === 0 && orphans.length === 0 ? (
        <EmptyState
          icon="🃏"
          title="还没有闪卡"
          description="在笔记里点「⋯ → 转成闪卡」自动生成，或点右上角「＋ 添加闪卡」粘贴内容。"
        />
      ) : (
        <CardsView groups={groups} orphans={orphans} />
      )}
    </div>
  );
}
