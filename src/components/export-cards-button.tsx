"use client";

// 卡片页右上角的「导出」按钮：把当前全部闪卡导出为 CSV。

import { useState } from "react";
import { Download } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { exportCardsCsv } from "@/lib/export-data";
import type { Card } from "@/lib/types";

export function ExportCardsButton() {
  const [busy, setBusy] = useState(false);

  async function exportCsv() {
    setBusy(true);
    try {
      const supabase = createClient();
      const { data } = await supabase
        .from("cards")
        .select("*")
        .order("created_at", { ascending: true });
      exportCardsCsv((data ?? []) as Card[]);
    } finally {
      setBusy(false);
    }
  }

  return (
    <button
      onClick={exportCsv}
      disabled={busy}
      className="inline-flex items-center gap-1.5 rounded-lg border border-zinc-200 px-3 py-2 text-sm font-medium text-zinc-700 transition-colors hover:bg-zinc-50 disabled:opacity-60"
    >
      <Download className="h-4 w-4" />
      {busy ? "导出中…" : "导出全部"}
    </button>
  );
}
