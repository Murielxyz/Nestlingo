import { listWordCards, listWordThemes, friendlyQueryError } from "@/lib/supabase/queries";
import { GroupBrowser } from "@/components/group-browser";
import { EmptyState } from "@/components/empty-state";

export default async function GroupsPage() {
  let cards: Awaited<ReturnType<typeof listWordCards>> = [];
  let themes: Awaited<ReturnType<typeof listWordThemes>> = [];
  let error: string | null = null;
  try {
    cards = await listWordCards();
  } catch (err) {
    error = friendlyQueryError(err);
  }
  // 自定义分类表可能还没建（schema 未迁移），出错就退回空，不影响内置主题。
  try {
    themes = await listWordThemes();
  } catch {
    themes = [];
  }

  return (
    <div>
      <header className="mb-6">
        <h1 className="text-2xl font-bold text-zinc-900">词群</h1>
        <p className="mt-1 text-sm text-zinc-500">
          生词按语言自动归类，再按单词本身的相关性（美容 / 游戏 / 运动…）智能分组记忆。
        </p>
      </header>

      {error ? (
        <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
          {error}
        </div>
      ) : cards.length === 0 ? (
        <EmptyState
          icon="🗂️"
          title="还没有生词"
          description="在笔记里点「词 → 生词」区块记录，转成闪卡后这里会自动按语言归类。"
        />
      ) : (
        <GroupBrowser cards={cards} themes={themes} />
      )}
    </div>
  );
}
