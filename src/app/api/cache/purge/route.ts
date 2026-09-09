// POST /api/cache/purge —— 清空服务端 Supabase 读缓存。
// 浏览器端每次写操作后调用（见 client.ts 的 createClient() 拦截），保证写后 router.refresh()
// 重新渲染的服务端查询能读到最新数据，而不是命中 15s 内的旧缓存。

import { NextResponse } from "next/server";
import { clearQueryCache } from "@/lib/supabase/query-cache";

export const runtime = "nodejs";

export async function POST() {
  clearQueryCache();
  return NextResponse.json({ ok: true });
}
