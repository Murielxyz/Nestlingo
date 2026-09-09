import { notFound } from "next/navigation";
import { getNote, noteDisplayTitle, listCards, friendlyQueryError } from "@/lib/supabase/queries";
import { NoteCardsTabs } from "@/components/note-cards-tabs";
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
      {error ? (
        <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
          {error}
        </div>
      ) : (
        <NoteCardsTabs
          title={noteDisplayTitle(note)}
          cards={cards}
          noteId={id}
          sourceType={note.source_type}
        />
      )}
    </div>
  );
}
