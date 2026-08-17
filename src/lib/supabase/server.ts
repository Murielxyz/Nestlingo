import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import { supabaseUrl, supabaseAnonKey } from "./env";

/**
 * 服务端（Server Component / Route Handler / Server Action）使用的 Supabase client。
 * 每次渲染都新建，绝不跨请求复用。
 */
export async function createClient() {
  const cookieStore = await cookies();

  return createServerClient(supabaseUrl, supabaseAnonKey, {
    cookies: {
      getAll() {
        return cookieStore.getAll();
      },
      setAll(cookiesToSet) {
        try {
          cookiesToSet.forEach(({ name, value, options }) =>
            cookieStore.set(name, value, options)
          );
        } catch {
          // Server Component 里无法写 cookie；会话刷新由 proxy.ts 负责。
        }
      },
    },
  });
}
