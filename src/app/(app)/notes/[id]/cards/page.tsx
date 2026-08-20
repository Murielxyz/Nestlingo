import Link from "next/link";
import { notFound } from "next/navigation";
import { FileText, RefreshCw } from "lucide-react";
import { getNote, listCards, friendlyQueryError } from "@/lib/supabase/queries";
import { NoteCardsTabs } from "@/components/note-cards-tabs";
import { BackButton } from "@/components/back-button";
import type { Card } from "@/lib/types";

export default async function NoteCardsPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;

  const note = await getNote(id);
  if (!note) notFound();

  let cards: Card[] = [];
  let error: string | null = null;
  try {
    cards = await listCards(id);
  } catch (err) {
    error = friendlyQueryError(err);
  }

  return (
    <div>
      {/* 原路返回 + 查看原始笔记 / 开始背诵 */}
      <div className="mb-4 flex items-center justify-between gap-3">
        <BackButton />
        <div className="flex items-center gap-4">
          {note.source_type !== "cards" && (
            <Link
              href={`/notes/${id}`}
              className="inline-flex items-center gap-1 text-sm text-teal-600 transition-colors hover:text-teal-700"
            >
              <FileText className="h-4 w-4" />
              查看原始笔记
            </Link>
          )}
          {cards.length > 0 && (
            <Link
              href={`/review?note=${id}`}
              className="inline-flex items-center gap-1 rounded-lg bg-teal-600 px-3.5 py-1.5 text-sm font-semibold text-white transition-colors hover:bg-teal-700"
            >
              <RefreshCw className="h-4 w-4" />
              开始背诵
            </Link>
          )}
        </div>
      </div>

      {error ? (
        <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
          {error}
        </div>
      ) : (
        <NoteCardsTabs title={note.title} cards={cards} noteId={id} />
      )}
    </div>
  );
}
