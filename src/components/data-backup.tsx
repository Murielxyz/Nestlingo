"use client";

// 数据备份：导出全部数据（JSON）或导出闪卡（CSV）。
// 全量 JSON 包含笔记、闪卡、复习进度、设置、文件夹、词群分类，可用于备份 / 迁移。

import { useState } from "react";
import { FileJson, FileSpreadsheet } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { downloadText, exportCardsCsv } from "@/lib/export-data";
import { SettingsGroup } from "./settings-row";
import type { Card } from "@/lib/types";

export function DataBackup() {
  const [busy, setBusy] = useState<"json" | "csv" | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function exportAll() {
    setBusy("json");
    setError(null);
    try {
      const supabase = createClient();
      const [notes, cards, states, settings, folders, themes] = await Promise.all([
        supabase.from("notes").select("*"),
        supabase.from("cards").select("*"),
        supabase.from("review_state").select("*"),
        supabase.from("user_settings").select("*"),
        supabase.from("folders").select("*"),
        supabase.from("word_themes").select("*"),
      ]);
      const payload = {
        exported_at: new Date().toISOString(),
        notes: notes.data ?? [],
        cards: cards.data ?? [],
        review_state: states.data ?? [],
        user_settings: settings.data ?? [],
        folders: folders.data ?? [],
        word_themes: themes.data ?? [],
      };
      downloadText("语巢备份.json", JSON.stringify(payload, null, 2), "application/json");
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  }

  async function exportCsv() {
    setBusy("csv");
    setError(null);
    try {
      const supabase = createClient();
      const { data } = await supabase
        .from("cards")
        .select("*")
        .order("created_at", { ascending: true });
      exportCardsCsv((data ?? []) as Card[]);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="space-y-3">
      <SettingsGroup title="数据">
        <button
          onClick={exportAll}
          disabled={busy !== null}
          className="flex w-full items-center justify-between gap-3 px-4 py-3.5 transition-colors hover:bg-zinc-50 disabled:opacity-60"
        >
          <div className="min-w-0 text-left">
            <p className="text-sm text-zinc-800">导出全部数据</p>
            <p className="mt-0.5 text-xs text-zinc-400">JSON，含笔记 / 闪卡 / 进度 / 设置 / 文件夹 / 词群</p>
          </div>
          <span className="shrink-0 text-zinc-400">
            {busy === "json" ? (
              <span className="text-xs">导出中…</span>
            ) : (
              <FileJson className="h-4 w-4" />
            )}
          </span>
        </button>

        <button
          onClick={exportCsv}
          disabled={busy !== null}
          className="flex w-full items-center justify-between gap-3 px-4 py-3.5 transition-colors hover:bg-zinc-50 disabled:opacity-60"
        >
          <div className="min-w-0 text-left">
            <p className="text-sm text-zinc-800">导出闪卡</p>
            <p className="mt-0.5 text-xs text-zinc-400">CSV，可用 Anki / Excel 打开</p>
          </div>
          <span className="shrink-0 text-zinc-400">
            {busy === "csv" ? (
              <span className="text-xs">导出中…</span>
            ) : (
              <FileSpreadsheet className="h-4 w-4" />
            )}
          </span>
        </button>
      </SettingsGroup>

      {error && <p className="px-1 text-sm text-red-600">{error}</p>}
    </div>
  );
}
