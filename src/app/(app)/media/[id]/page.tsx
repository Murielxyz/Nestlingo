import { notFound } from "next/navigation";
import { getMediaItem } from "@/lib/supabase/queries";
import { MediaDetail } from "@/components/media-detail";

export default async function MediaDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const item = await getMediaItem(id);
  if (!item) notFound();

  return <MediaDetail item={item} />;
}
