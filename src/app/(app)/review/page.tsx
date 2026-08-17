import Link from "next/link";
import {
  listReviewCards,
  getNote,
  getUserSettings,
  getReviewOverview,
  listCollectionCards,
  listAllCards,
  listWeakCards,
  listThemeCards,
  listThemeReviewItems,
  listWordThemes,
  friendlyQueryError,
} from "@/lib/supabase/queries";
import { themeLabelOf } from "@/lib/word-themes";
import type { WordTheme } from "@/lib/types";
import { ReviewSession } from "@/components/review-session";
import { TestSession } from "@/components/test-session";
import { ReviewHome } from "@/components/review-home";
import { EmptyState } from "@/components/empty-state";

const KIND_LABEL: Record<string, string> = {
  word: "生词",
  example: "例句",
  grammar: "语法",
};

function parseKind(k?: string): string | null {
  return k && KIND_LABEL[k] ? k : null;
}

function kindSuffixOf(k?: string | null): string {
  return k && KIND_LABEL[k] ? ` · ${KIND_LABEL[k]}` : "";
}

/** 拉取用户自定义词群分类（新表可能还没建，出错就返回空，不影响内置主题）。 */
async function loadUserThemes(): Promise<WordTheme[]> {
  try {
    return await listWordThemes();
  } catch {
    return [];
  }
}

/**
 * 复习页：
 * - 无参数：主页（正在背的合集 + 合集选择 + 待加强）。
 * - ?scope=weak：背诵待加强的卡。
 * - ?mode=test（可选 note/kind/theme）：测试（综合 / 某合集 / 某主题）。
 * - ?note=…（可选 kind）：背诵某一个文件（到期卡片，SM-2）。
 * - ?theme=…：背诵某一个主题下的生词。
 */
export default async function ReviewPage({
  searchParams,
}: {
  searchParams: Promise<{
    note?: string;
    kind?: string;
    mode?: string;
    scope?: string;
    theme?: string;
  }>;
}) {
  const { note, kind, mode, scope, theme } = await searchParams;

  // ===== 待加强的卡（背） =====
  if (scope === "weak") {
    let items: Awaited<ReturnType<typeof listWeakCards>> = [];
    let error: string | null = null;
    try {
      items = await listWeakCards();
    } catch (err) {
      error = friendlyQueryError(err);
    }
    return (
      <div>
        <header className="mb-6 flex items-center gap-3">
          <Link
            href="/review"
            className="rounded-lg px-2 py-1 text-lg text-zinc-500 transition-colors hover:bg-zinc-100 hover:text-zinc-800"
            aria-label="返回"
          >
            ←
          </Link>
          <h1 className="text-2xl font-bold text-zinc-900">待加强的卡</h1>
        </header>

        {error ? (
          <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
            {error}
          </div>
        ) : items.length === 0 ? (
          <EmptyState
            icon="💪"
            title="没有待加强的卡"
            description="最近没有答错的卡片，继续保持。"
          />
        ) : (
          <ReviewSession items={items} dailyGoal={items.length} />
        )}
      </div>
    );
  }

  // ===== 测试 =====
  if (mode === "test") {
    let cards: Awaited<ReturnType<typeof listAllCards>> = [];
    let error: string | null = null;
    let title = "综合测试";
    const backHref = theme ? "/groups" : "/review";
    try {
      if (theme) {
        cards = await listThemeCards(theme);
        title = themeLabelOf(theme, await loadUserThemes());
      } else if (note) {
        const noteId = note === "orphans" ? null : note;
        const cardKind = parseKind(kind);
        cards = await listCollectionCards(noteId, cardKind);
        title = noteId ? ((await getNote(noteId))?.title ?? "测试") : "独立卡片";
        if (cardKind) title += kindSuffixOf(cardKind);
      } else {
        cards = await listAllCards();
      }
    } catch (err) {
      error = friendlyQueryError(err);
    }
    return (
      <div>
        <header className="mb-6 flex items-center gap-3">
          <Link
            href={backHref}
            className="rounded-lg px-2 py-1 text-lg text-zinc-500 transition-colors hover:bg-zinc-100 hover:text-zinc-800"
            aria-label="返回"
          >
            ←
          </Link>
          <h1 className="text-2xl font-bold text-zinc-900">测试 · {title}</h1>
        </header>

        {error ? (
          <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
            {error}
          </div>
        ) : (
          <TestSession cards={cards} title={title} backHref={backHref} />
        )}
      </div>
    );
  }

  // ===== 背诵某一个文件 =====
  if (note) {
    const noteId = note === "orphans" ? null : note;
    const cardKind = parseKind(kind);
    let items: Awaited<ReturnType<typeof listReviewCards>> = [];
    let error: string | null = null;
    let noteTitle: string | null = null;
    let dailyGoal = 20;

    try {
      items = await listReviewCards(noteId, cardKind);
      if (noteId) {
        const n = await getNote(noteId);
        noteTitle = n?.title ?? null;
      } else {
        noteTitle = "独立卡片";
      }
    } catch (err) {
      error = friendlyQueryError(err);
    }
    const displayTitle = noteTitle ? `${noteTitle}${kindSuffixOf(cardKind)}` : null;

    try {
      dailyGoal = (await getUserSettings()).daily_goal;
    } catch {
      dailyGoal = 20;
    }

    return (
      <div>
        <header className="mb-6 flex items-center gap-3">
          <Link
            href="/review"
            className="rounded-lg px-2 py-1 text-lg text-zinc-500 transition-colors hover:bg-zinc-100 hover:text-zinc-800"
            aria-label="返回"
          >
            ←
          </Link>
          <h1 className="text-2xl font-bold text-zinc-900">
            {displayTitle ? `背诵「${displayTitle}」` : "背诵"}
          </h1>
        </header>

        {error ? (
          <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
            {error}
          </div>
        ) : items.length === 0 ? (
          <EmptyState
            icon="🎉"
            title="这个文件都复习完了"
            description="回文件列表选别的背，或明天到期再来。"
          />
        ) : (
          <ReviewSession items={items} dailyGoal={dailyGoal} />
        )}
      </div>
    );
  }

  // ===== 背诵某一个主题 =====
  if (theme) {
    const themeTitle = themeLabelOf(theme, await loadUserThemes());
    let items: Awaited<ReturnType<typeof listThemeReviewItems>> = [];
    let error: string | null = null;
    let dailyGoal = 20;

    try {
      items = await listThemeReviewItems(theme);
    } catch (err) {
      error = friendlyQueryError(err);
    }

    try {
      dailyGoal = (await getUserSettings()).daily_goal;
    } catch {
      dailyGoal = 20;
    }

    return (
      <div>
        <header className="mb-6 flex items-center gap-3">
          <Link
            href="/groups"
            className="rounded-lg px-2 py-1 text-lg text-zinc-500 transition-colors hover:bg-zinc-100 hover:text-zinc-800"
            aria-label="返回"
          >
            ←
          </Link>
          <h1 className="text-2xl font-bold text-zinc-900">
            背诵「{themeTitle}」生词
          </h1>
        </header>

        {error ? (
          <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
            {error}
          </div>
        ) : items.length === 0 ? (
          <EmptyState
            icon="🎉"
            title="这个主题都复习完了"
            description="回词群页换一个主题，或明天到期再来。"
          />
        ) : (
          <ReviewSession items={items} dailyGoal={dailyGoal} />
        )}
      </div>
    );
  }

  // ===== 主页 =====
  let overview: Awaited<ReturnType<typeof getReviewOverview>> | null = null;
  let error: string | null = null;
  try {
    overview = await getReviewOverview();
  } catch (err) {
    error = friendlyQueryError(err);
  }

  return (
    <div>
      {error ? (
        <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
          {error}
        </div>
      ) : overview ? (
        <ReviewHome
          stats={overview.stats}
          collections={overview.collections}
          weakCards={overview.weakCards}
        />
      ) : (
        <EmptyState icon="🔁" title="加载中…" description="" />
      )}
    </div>
  );
}
