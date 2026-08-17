import { notFound } from "next/navigation";
import { getCard } from "@/lib/supabase/queries";
import { CardDetail } from "@/components/card-detail";

/** 允许的来源页面（对应返回箭头的去向），其它值一律走默认返回。 */
const FROM_PAGES: Record<string, string> = {
  "/review": "/review",
  "/groups": "/groups",
  "/cards": "/cards",
};

export default async function CardPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ from?: string }>;
}) {
  const { id } = await params;
  const { from } = await searchParams;

  const card = await getCard(id);
  if (!card) notFound();

  // 返回去向：优先跟来源页走（复习/词群/闪卡列表）；否则按归属回笔记闪卡列表或「闪卡」主页。
  const backHref =
    (from && FROM_PAGES[from]) ||
    (card.note_id ? `/notes/${card.note_id}/cards` : "/cards");

  return <CardDetail card={card} backHref={backHref} />;
}
