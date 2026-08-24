import {
  listMaterials,
  listMaterialCollections,
  friendlyQueryError,
} from "@/lib/supabase/queries";
import { MaterialsView } from "@/components/materials-view";

export default async function MaterialsPage() {
  let materials: Awaited<ReturnType<typeof listMaterials>> = [];
  let collections: Awaited<ReturnType<typeof listMaterialCollections>> = [];
  let error: string | null = null;

  try {
    [materials, collections] = await Promise.all([
      listMaterials(),
      listMaterialCollections(),
    ]);
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
        <MaterialsView materials={materials} collections={collections} />
      )}
    </div>
  );
}
