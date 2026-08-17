import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import { supabaseUrl, supabaseAnonKey } from "./env";

/**
 * 在 proxy.ts 里调用：判断登录状态并做跳转。
 *
 * 这里用 getSession()（本地解码 cookie，不联网）而不是 getUser()（联网校验），
 * 是为了让每次页面跳转不被「去 Supabase 校验会话」的往返延迟拖慢。
 * 真正的会话刷新 / 校验交给 (app) 布局里的 getUser() 完成。
 */
export async function updateSession(request: NextRequest) {
  let supabaseResponse = NextResponse.next({ request });

  const supabase = createServerClient(supabaseUrl, supabaseAnonKey, {
    cookies: {
      getAll() {
        return request.cookies.getAll();
      },
      setAll(cookiesToSet, headers) {
        cookiesToSet.forEach(({ name, value }) =>
          request.cookies.set(name, value)
        );
        supabaseResponse = NextResponse.next({ request });
        cookiesToSet.forEach(({ name, value, options }) =>
          supabaseResponse.cookies.set(name, value, options)
        );
        Object.entries(headers).forEach(([key, value]) =>
          supabaseResponse.headers.set(key, value)
        );
      },
    },
  });

  const {
    data: { session },
  } = await supabase.auth.getSession();

  const pathname = request.nextUrl.pathname;
  const isLogin = pathname.startsWith("/login");
  const isAuthCallback = pathname.startsWith("/auth");

  // 未登录 → 去登录页（登录页和 auth 回调除外）
  if (!session && !isLogin && !isAuthCallback) {
    const url = request.nextUrl.clone();
    url.pathname = "/login";
    url.search = "";
    return NextResponse.redirect(url);
  }

  // 已登录却访问登录页 → 直接进应用
  if (session && isLogin) {
    const url = request.nextUrl.clone();
    url.pathname = "/notes";
    url.search = "";
    return NextResponse.redirect(url);
  }

  return supabaseResponse;
}
