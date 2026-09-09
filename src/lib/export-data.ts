// 导出工具：把闪卡 / 全量数据转成 CSV 或 JSON，并在浏览器里触发下载。
// 只在客户端组件里调用（用到 document / Blob / URL）。

import type { Card } from "@/lib/types";

/** 在浏览器里触发一次文件下载。 */
export function downloadText(filename: string, text: string, mime = "text/plain") {
  const blob = new Blob([text], { type: `${mime};charset=utf-8` });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

/** 单个 CSV 单元格转义（含逗号/引号/换行时套双引号）。 */
function esc(cell: string): string {
  if (/[",\r\n]/.test(cell)) return `"${cell.replace(/"/g, '""')}"`;
  return cell;
}

/** 把闪卡导出为 CSV（带 BOM，Excel 打开中文不乱码）。只导「正面 / 背面」两列，不带表头。
 *  不带表头：导入 Anki 时第一行就是数据，不会被当成一张卡，也无需在 Anki 里勾「第一行是字段名」。 */
export function exportCardsCsv(cards: Card[], filename = "闪卡.csv") {
  const rows = cards.map((c) => [c.front, c.back ?? ""]);
  const csv =
    "﻿" +
    rows.map((r) => r.map((cell) => esc(cell ?? "")).join(",")).join("\n");
  downloadText(filename, csv, "text/csv");
}
