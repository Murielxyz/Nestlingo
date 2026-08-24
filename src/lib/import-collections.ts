// 词群「从合集导入」的数据层：把某篇笔记下的所有 生词+例句 卡聚合成一个可导入的「合集」。
// 供两处复用：词群页「新建分类」+ 主题详情「收录词」弹窗的第 4 种方式。
// 纯客户端（Supabase client），不走服务端查询。

import { createClient } from "@/lib/supabase/client";
import type { CardWithNote } from "@/lib/types";

/** 一个可导入的合集：某篇笔记（source）下的所有 生词+例句 卡。 */
export type ImportableCollection = {
  noteId: string;
  title: string;
  cards: CardWithNote[];
};

/**
 * 列出可从合集导入的合集（按 note_id 聚合 生词+例句 卡）。
 * @param excludeThemeId 传某个主题 id 时，会跳过「该主题已收录」的卡（避免重复收录）。
 */
export async function listImportableCollections(
  excludeThemeId?: string
): Promise<ImportableCollection[]> {
  const supabase = createClient();

  let existingIds = new Set<string>();
  if (excludeThemeId) {
    const { data: existing } = await supabase
      .from("cards")
      .select("id")
      .eq("theme", excludeThemeId);
    existingIds = new Set((existing ?? []).map((r) => r.id));
  }

  const { data: cardRows, error } = await supabase
    .from("cards")
    .select("*")
    .in("kind", ["word", "example"])
    .not("note_id", "is", null);
  if (error) throw error;
  const rows = (cardRows ?? []) as CardWithNote[];

  const byNote = new Map<string, CardWithNote[]>();
  for (const c of rows) {
    const nid = c.note_id as string;
    if (!byNote.has(nid)) byNote.set(nid, []);
    byNote.get(nid)!.push(c);
  }
  const noteIds = Array.from(byNote.keys());

  const titleMap = new Map<string, string>();
  if (noteIds.length > 0) {
    const { data: notes } = await supabase
      .from("notes")
      .select("id, title")
      .in("id", noteIds);
    for (const n of notes ?? []) titleMap.set(n.id, n.title ?? "无标题");
  }

  const result: ImportableCollection[] = [];
  for (const nid of noteIds) {
    const cards = (byNote.get(nid) ?? []).filter((c) => !existingIds.has(c.id));
    if (cards.length === 0) continue;
    result.push({ noteId: nid, title: titleMap.get(nid) ?? "无标题", cards });
  }
  return result;
}
