import {
  listCardGroups,
  listOrphanCards,
  friendlyQueryError,
} from "@/lib/supabase/queries";
import { CardsView } from "@/components/cards-view";
import type { Card, CardFolderGroup } from "@/lib/types";

/** 闪卡管理页：复习页「查看更多」进入，返回去复习。页头内置 ⋯ 菜单（添加/选择合集批量/导出全部）。 */
export default async function CardsPage() {
  let groups: CardFolderGroup[] = [];
  let orphans: Card[] = [];
  let sourceError: string | null = null;

  try {
    [groups, orphans] = await Promise.all([listCardGroups(), listOrphanCards()]);
  } catch (err) {
    sourceError = friendlyQueryError(err);
  }

  return <CardsView groups={groups} orphans={orphans} sourceError={sourceError} />;
}
