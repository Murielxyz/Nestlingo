import { NextResponse, type NextRequest } from "next/server";
import { updateSession } from "@/lib/supabase/middleware";
import { isSupabaseConfigured } from "@/lib/supabase/env";

/**
 * Next.js 16 里 middleware 更名为 proxy。
 * 这里做乐观登录校验：未登录的用户挡在登录页外。
 * 真正的数据安全由 Supabase RLS 兜底。
 */
export async function proxy(request: NextRequest) {
  // 尚未配置 Supabase 时放行，避免应用无法打开。
  if (!isSupabaseConfigured()) {
    return NextResponse.next();
  }
  return await updateSession(request);
}

export const config = {
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico)$).*)",
  ],
};
