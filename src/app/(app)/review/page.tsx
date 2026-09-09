import Link from "next/link";
import {
  listReviewCards,
  getNote,
  noteDisplayTitle,
  getUserSettings,
  getReviewOverview,
  listCollectionCards,
  listAllCards,
  listWeakCards,
  listTestErrors,
  listThemeCards,
  listThemeReviewItems,
  listWordThemes,
  friendlyQueryError,
} from "@/lib/supabase/queries";
import { themeLabelOf } from "@/lib/word-themes";
import { cardLang, LANG_ORDER, LANG_LABEL, LANG_COLOR, type Lang } from "@/lib/lang-detect";
import type { WordTheme } from "@/lib/types";
import { ReviewSession } from "@/components/review-session";
import { ClozeSession } from "@/components/cloze-session";
import { TestSession } from "@/components/test-session";
import { MixedSession } from "@/components/mixed-session";
import { TestPick } from "@/components/test-pick";
import { ReviewHome } from "@/components/review-home";
import { StoryMode } from "@/components/story-mode";
import { TestErrors } from "@/components/test-errors";
import { EmptyState } from "@/components/empty-state";
import { BackButton } from "@/components/back-button";
import { Activity, PartyPopper, RefreshCw, BookOpen } from "lucide-react";

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

/** 综合测试里实际出现的语言（按正面文字自动检测，去重、固定顺序）。 */
function presentLangsOf(cards: { front: string; back?: string | null; lang?: string | null }[]): Lang[] {
  const s = new Set<Lang>();
  for (const c of cards) s.add(cardLang(c));
  return LANG_ORDER.filter((l) => s.has(l));
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
    lang?: string;
    back?: string;
  }>;
}) {
  const { note, kind, mode, scope, theme, lang, back } = await searchParams;

  // ===== 待加强的卡（背） =====
  if (scope === "weak") {
    let items: Awaited<ReturnType<typeof listWeakCards>> = [];
    let error: string | null = null;
    try {
      items = await listWeakCards();
    } catch (err) {
      error = friendlyQueryError(err);
    }
    let shuffleDefault = false;
    try {
      shuffleDefault = (await getUserSettings()).review_shuffle;
    } catch {
      shuffleDefault = false;
    }
    return (
      <div>
        <header className="page-header mb-6 flex items-center gap-3">
          <BackButton fallback="/review" />
          <h1 className="text-lg font-bold text-zinc-900">待复习的卡</h1>
        </header>

        {error ? (
          <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
            {error}
          </div>
        ) : items.length === 0 ? (
          <EmptyState
            icon={<Activity className="h-10 w-10" />}
            title="没有待复习的闪卡"
            description="最近没有答错的闪卡，继续保持。"
          />
        ) : (
          <ReviewSession items={items} dailyGoal={items.length} shuffleDefault={shuffleDefault} />
        )}
      </div>
    );
  }

  // ===== 错题集 =====
  if (scope === "errors") {
    let items: Awaited<ReturnType<typeof listTestErrors>> = [];
    let error: string | null = null;
    try {
      items = await listTestErrors();
    } catch (err) {
      error = friendlyQueryError(err);
    }
    return (
      <div>
        <header className="page-header mb-6 flex items-center gap-3">
          <BackButton fallback="/review" />
          <h1 className="text-lg font-bold text-zinc-900">错题集</h1>
        </header>

        {error ? (
          <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
            {error}
          </div>
        ) : items.length === 0 ? (
          <EmptyState
            icon={<PartyPopper className="h-10 w-10" />}
            title="没有错题"
            description="测试里选错的卡会出现在这里，供你单独再背。"
          />
        ) : (
          <TestErrors items={items} />
        )}
      </div>
    );
  }

  // ===== 测试 =====
  if (mode === "test") {
    let cards: Awaited<ReturnType<typeof listAllCards>> = [];
    let error: string | null = null;
    let title = "综合测试";
    let presentLangs: Lang[] = [];
    const backHref = back ?? (theme ? "/cards?view=theme" : "/review");
    // 只有「综合测试」（不指定合集/主题）才显示语言 chip。
    const isComprehensive = !theme && !note;
    try {
      if (theme) {
        let themeCards = await listThemeCards(theme);
        title = themeLabelOf(theme, await loadUserThemes());
        // 从词群页带语言进来 → 只测这一种语言，与主题详情页显示一致。
        if (lang && LANG_ORDER.includes(lang as Lang)) {
          themeCards = themeCards.filter((c) => cardLang(c) === lang);
        }
        cards = themeCards;
      } else if (note) {
        const noteId = note === "orphans" ? null : note;
        const cardKind = parseKind(kind);
        cards = await listCollectionCards(noteId, cardKind);
        title = noteId ? noteDisplayTitle(await getNote(noteId)) || "测试" : "独立闪卡";
        if (cardKind) title += kindSuffixOf(cardKind);
      } else {
        const all = await listAllCards();
        presentLangs = presentLangsOf(all);
        // 指定了语言且该语言确实存在 → 只测这一种；否则测全部。
        if (lang && presentLangs.includes(lang as Lang)) {
          cards = all.filter((c) => cardLang(c) === lang);
          title = `${LANG_LABEL[lang as Lang]}测试`;
        } else {
          cards = all;
        }
      }
    } catch (err) {
      error = friendlyQueryError(err);
    }
    return (
      <div>
        <header className="page-header mb-6 flex items-center gap-3">
          <BackButton fallback={backHref} />
          <h1 className="text-lg font-bold text-zinc-900">测试 · {title}</h1>
        </header>

        {/* 综合测试的语言筛选 chip（只有多种语言时才显示，避免混用） */}
        {isComprehensive && presentLangs.length > 1 && (
          <div className="mb-4 flex flex-wrap gap-1.5">
            <Link
              href="/review?mode=test"
              className={`rounded-full px-3 py-2 text-sm font-medium transition-colors ${
                !lang
                  ? "bg-zinc-800 text-white"
                  : "border border-zinc-200 text-zinc-500 hover:bg-zinc-50"
              }`}
            >
              全部语言
            </Link>
            {presentLangs.map((l) => (
              <Link
                key={l}
                href={`/review?mode=test&lang=${l}`}
                className={`rounded-full px-3 py-2 text-sm font-medium transition-colors ${
                  lang === l
                    ? "bg-zinc-800 text-white"
                    : `${LANG_COLOR[l]} border border-transparent hover:opacity-80`
                }`}
              >
                {LANG_LABEL[l]}
              </Link>
            ))}
          </div>
        )}

        {error ? (
          <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
            {error}
          </div>
        ) : (
          <TestSession
            key={`${note ?? ""}|${kind ?? ""}|${theme ?? ""}|${lang ?? ""}`}
            cards={cards}
            title={title}
            backHref={backHref}
          />
        )}
      </div>
    );
  }

  // ===== 故事模式 =====
  if (mode === "story") {
    // 基于「正在背的合集」：从复习主页的合集进入，带 note/kind 参数。
    const noteId = note === "orphans" ? null : note ?? null;
    const cardKind = parseKind(kind);
    const hasCollection = note !== undefined;
    let pool: { id: string; front: string; back: string | null }[] = [];
    let storyError: string | null = null;
    let storyTitle: string | null = null;

    if (hasCollection) {
      try {
        const cards = await listCollectionCards(noteId, cardKind);
        // 优先用生词卡编故事；这个合集没有生词卡就退回普通卡。
        const words = cards.filter((c) => c.kind === "word" && c.front.trim());
        const source =
          words.length > 0 ? words : cards.filter((c) => c.front.trim());
        pool = source.map((c) => ({ id: c.id, front: c.front, back: c.back }));
        storyTitle = noteId
          ? noteDisplayTitle(await getNote(noteId)) || "合集"
          : "独立闪卡";
        if (cardKind) storyTitle += kindSuffixOf(cardKind);
      } catch (err) {
        storyError = friendlyQueryError(err);
      }
    }

    return (
      <div>
        <header className="page-header mb-6 flex items-center gap-3">
          <BackButton fallback="/review" />
          <h1 className="text-lg font-bold text-zinc-900">
            故事模式{storyTitle ? ` · ${storyTitle}` : ""}
          </h1>
        </header>

        {!hasCollection ? (
          <EmptyState
            icon={<BookOpen className="h-10 w-10" />}
            title="请先选择合集"
            description="回闪卡主页，从「正在背的合集」点「故事模式」进入。"
          />
        ) : storyError ? (
          <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
            {storyError}
          </div>
        ) : (
          <StoryMode cards={pool} />
        )}
      </div>
    );
  }

  // ===== 完形填空 =====
  if (mode === "cloze") {
    const cardKind = parseKind(kind);
    let items: Awaited<ReturnType<typeof listReviewCards>> = [];
    let error: string | null = null;
    let title: string | null = null;
    let dailyGoal = 20;

    try {
      if (theme) {
        items = await listThemeReviewItems(theme);
        title = themeLabelOf(theme, await loadUserThemes());
      } else if (note) {
        const noteId = note === "orphans" ? null : note;
        items = await listReviewCards(noteId, cardKind);
        title = noteId ? noteDisplayTitle(await getNote(noteId)) || null : "独立闪卡";
        if (cardKind) title += kindSuffixOf(cardKind);
      }
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
        <header className="page-header mb-6 flex items-center gap-3">
          <BackButton fallback={theme ? "/cards?view=theme" : "/review"} />
          <h1 className="text-lg font-bold text-zinc-900">
            完形填空{title ? ` · ${title}` : ""}
          </h1>
        </header>

        {error ? (
          <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
            {error}
          </div>
        ) : !note && !theme ? (
          <EmptyState
            icon={<Activity className="h-10 w-10" />}
            title="请先选择合集"
            description="回闪卡主页，从「正在背的合集」点「完形填空」进入。"
          />
        ) : (
          <ClozeSession
            key={`${note ?? ""}|${kind ?? ""}|${theme ?? ""}|cloze`}
            items={items}
            dailyGoal={dailyGoal}
            backHref={theme ? "/cards?view=theme" : "/review"}
          />
        )}
      </div>
    );
  }

  // ===== 测试选择页 =====
  if (mode === "test-pick") {
    const noteId = note === "orphans" ? null : note ?? null;
    const cardKind = parseKind(kind);
    let title: string | null = null;
    if (note !== undefined) {
      try {
        title = noteId ? noteDisplayTitle(await getNote(noteId)) || null : "独立闪卡";
      } catch {
        title = null;
      }
      if (cardKind) title = title ? `${title}${kindSuffixOf(cardKind)}` : null;
    }
    return <TestPick noteId={noteId} kind={cardKind} title={title} />;
  }

  // ===== 混合练习 =====
  if (mode === "mixed") {
    const noteId = note === "orphans" ? null : note ?? null;
    const cardKind = parseKind(kind);
    let cards: Awaited<ReturnType<typeof listCollectionCards>> = [];
    let error: string | null = null;
    let title: string | null = null;
    const backHref = back ?? "/review";
    try {
      cards = await listCollectionCards(noteId, cardKind);
      title = noteId ? noteDisplayTitle(await getNote(noteId)) || null : "独立闪卡";
      if (cardKind) title = title ? `${title}${kindSuffixOf(cardKind)}` : null;
    } catch (err) {
      error = friendlyQueryError(err);
    }
    return (
      <div>
        <header className="page-header mb-6 flex items-center gap-3">
          <BackButton fallback={backHref} />
          <h1 className="text-lg font-bold text-zinc-900">
            混合练习{title ? ` · ${title}` : ""}
          </h1>
        </header>
        {error ? (
          <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
            {error}
          </div>
        ) : (
          <MixedSession cards={cards} backHref={backHref} />
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
        noteTitle = noteDisplayTitle(n) || null;
      } else {
        noteTitle = "独立闪卡";
      }
    } catch (err) {
      error = friendlyQueryError(err);
    }
    const displayTitle = noteTitle ? `${noteTitle}${kindSuffixOf(cardKind)}` : null;

    let shuffleDefault = false;
    try {
      const s = await getUserSettings();
      dailyGoal = s.daily_goal;
      shuffleDefault = s.review_shuffle;
    } catch {
      dailyGoal = 20;
    }

    return (
      <div>
        <header className="page-header mb-6 flex items-center gap-3">
          <BackButton fallback={back ?? "/review"} />
          <h1 className="text-lg font-bold text-zinc-900">
            {displayTitle ? `背诵「${displayTitle}」` : "背诵"}
          </h1>
        </header>

        {error ? (
          <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
            {error}
          </div>
        ) : items.length === 0 ? (
          <EmptyState
            icon={<PartyPopper className="h-10 w-10" />}
            title="这个合集都学完了"
            description="回闪卡列表选别的背，或明天到期再来。"
          />
        ) : (
          <ReviewSession items={items} dailyGoal={dailyGoal} shuffleDefault={shuffleDefault} />
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
    // 从词群页带语言进来 → 只背这一种语言，与主题详情页显示一致。
    if (lang && LANG_ORDER.includes(lang as Lang)) {
      items = items.filter((i) => cardLang(i.card) === lang);
    }

    let shuffleDefault = false;
    try {
      const s = await getUserSettings();
      dailyGoal = s.daily_goal;
      shuffleDefault = s.review_shuffle;
    } catch {
      dailyGoal = 20;
    }

    return (
      <div>
        <header className="page-header mb-6 flex items-center gap-3">
          <BackButton fallback={back ?? "/cards?view=theme"} />
          <h1 className="text-lg font-bold text-zinc-900">
            背诵「{themeTitle}」
          </h1>
        </header>

        {error ? (
          <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
            {error}
          </div>
        ) : items.length === 0 ? (
          <EmptyState
            icon={<PartyPopper className="h-10 w-10" />}
            title="这个主题都学完了"
            description="回闪卡页换一个主题，或明天到期再来。"
          />
        ) : (
          <ReviewSession items={items} dailyGoal={dailyGoal} canRememberCollection={false} shuffleDefault={shuffleDefault} />
        )}
      </div>
    );
  }

  // ===== 主页 =====
  let overview: Awaited<ReturnType<typeof getReviewOverview>> | null = null;
  let errorCards: Awaited<ReturnType<typeof listTestErrors>> = [];
  let error: string | null = null;
  try {
    overview = await getReviewOverview();
  } catch (err) {
    error = friendlyQueryError(err);
  }
  // 错题集预览（主页展示前几条），失败不阻塞主页。
  try {
    errorCards = await listTestErrors();
  } catch {
    errorCards = [];
  }

  return (
    <div className="mx-auto max-w-2xl">
      {error ? (
        <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
          {error}
        </div>
      ) : overview ? (
        <ReviewHome
          stats={overview.stats}
          collections={overview.collections}
          weakCards={overview.weakCards}
          errorCards={errorCards}
        />
      ) : (
        <EmptyState icon={<RefreshCw className="h-10 w-10" />} title="加载中…" description="" />
      )}
    </div>
  );
}
