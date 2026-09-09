"use client";

// 精读「高亮即解释」结果缓存：同一个词解释过一次后保留一段时间，
// 再选同一词直接命中缓存、不再重复烧 token。
// 只存 localStorage（解释结果随浏览器走，换设备不共享），TTL 7 天、最多 200 条、超出淘汰最旧。

import type { ExplainResult } from "@/app/api/ai/explain/route";

const KEY = "ln_explain_cache";
const TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7 天
const MAX_ENTRIES = 200;

type Entry = { result: ExplainResult; ts: number };
type Store = Record<string, Entry>;

function readStore(): Store {
  try {
    const raw = window.localStorage.getItem(KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === "object" ? (parsed as Store) : {};
  } catch {
    return {};
  }
}

function writeStore(store: Store): void {
  try {
    window.localStorage.setItem(KEY, JSON.stringify(store));
  } catch {
    // localStorage 不可用（隐私模式 / 配额满）时静默失败，不阻塞解释流程。
  }
}

/** 命中且未过期 → 返回缓存结果；否则返回 null（会走一次正常请求）。 */
export function getCachedExplain(text: string): ExplainResult | null {
  const key = text.trim();
  if (!key) return null;
  const entry = readStore()[key];
  if (!entry) return null;
  if (Date.now() - entry.ts > TTL_MS) return null;
  return entry.result;
}

/** 保存解释结果，超出上限时淘汰最旧的条目。 */
export function setCachedExplain(text: string, result: ExplainResult): void {
  const key = text.trim();
  if (!key || !result) return;
  const store = readStore();
  store[key] = { result, ts: Date.now() };
  const keys = Object.keys(store);
  if (keys.length > MAX_ENTRIES) {
    keys
      .sort((a, b) => (store[a].ts ?? 0) - (store[b].ts ?? 0))
      .slice(0, keys.length - MAX_ENTRIES)
      .forEach((k) => delete store[k]);
  }
  writeStore(store);
}
