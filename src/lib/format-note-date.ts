/** 把 ISO 时间串（如 updated_at）转成简短、友好的日期标识，供笔记列表/卡片右下角显示。
 *  规则：今天→「HH:mm」；昨天→「昨天」；一周内→「N 天前」；同年→「M月D日」；更早→「YYYY/M/D」。
 *  纯原生实现，无第三方依赖。 */
export function formatNoteDate(iso: string | null | undefined): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";

  const now = new Date();
  const startOfDay = (x: Date) =>
    new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime();
  const dayDiff = Math.round((startOfDay(now) - startOfDay(d)) / 86_400_000);

  if (dayDiff === 0) {
    const hh = String(d.getHours()).padStart(2, "0");
    const mm = String(d.getMinutes()).padStart(2, "0");
    return `${hh}:${mm}`;
  }
  if (dayDiff === 1) return "昨天";
  if (dayDiff > 1 && dayDiff < 7) return `${dayDiff} 天前`;
  if (d.getFullYear() === now.getFullYear()) return `${d.getMonth() + 1}月${d.getDate()}日`;
  return `${d.getFullYear()}/${d.getMonth() + 1}/${d.getDate()}`;
}
