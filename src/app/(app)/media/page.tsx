import { listMediaItems, friendlyQueryError } from "@/lib/supabase/queries";
import { MediaBrowser } from "@/components/media-browser";
import type { MediaItem } from "@/lib/types";

export default async function MediaPage() {
  let items: MediaItem[] = [];
  let error: string | null = null;
  try {
    items = await listMediaItems();
  } catch (err) {
    error = friendlyQueryError(err);
  }

  if (error) {
    return (
      <div>
        <h1 className="mb-6 text-2xl font-bold text-zinc-900">媒体</h1>
        <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
          {error}
        </div>
      </div>
    );
  }

  return <MediaBrowser items={items} />;
}
