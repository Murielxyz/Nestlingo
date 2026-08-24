import { notFound } from "next/navigation";
import {
  getMaterialCollection,
  listMaterialsByCollection,
  listMaterialCollections,
} from "@/lib/supabase/queries";
import { CollectionDetail } from "@/components/collection-detail";

export default async function CollectionPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;

  let collection: Awaited<ReturnType<typeof getMaterialCollection>> = null;
  let materials: Awaited<ReturnType<typeof listMaterialsByCollection>> = [];
  let collections: Awaited<ReturnType<typeof listMaterialCollections>> = [];
  try {
    [collection, materials, collections] = await Promise.all([
      getMaterialCollection(id),
      listMaterialsByCollection(id),
      listMaterialCollections(),
    ]);
  } catch {
    collection = null;
  }
  if (!collection) notFound();

  return <CollectionDetail collection={collection} materials={materials} collections={collections} />;
}
