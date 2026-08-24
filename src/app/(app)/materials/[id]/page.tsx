import { notFound } from "next/navigation";
import { getMaterial } from "@/lib/supabase/queries";
import { MaterialWatch } from "@/components/material-watch";

export default async function MaterialPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;

  let material: Awaited<ReturnType<typeof getMaterial>> = null;
  try {
    material = await getMaterial(id);
  } catch {
    material = null;
  }
  if (!material) notFound();

  return <MaterialWatch material={material} />;
}
