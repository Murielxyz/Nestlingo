import { listFavorites, friendlyQueryError } from "@/lib/supabase/queries";
import { CompanionFavorites } from "@/components/companion-favorites";
import type { MaterialWithNote } from "@/lib/types";

export default async function CompanionFavoritesPage() {
  let data: { records: Record<string, unknown>[]; materials: MaterialWithNote[] } | null = null;
  let error: string | null = null;
  try {
    data = await listFavorites();
  } catch (err) {
    error = friendlyQueryError(err);
  }
  return <CompanionFavorites initial={data} error={error} />;
}
