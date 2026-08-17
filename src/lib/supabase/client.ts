import { createBrowserClient } from "@supabase/ssr";
import { supabaseUrl, supabaseAnonKey } from "./env";

/**
 * 浏览器端（客户端组件）使用的 Supabase client。
 * 只在组件被调用时创建，避免在服务端被误用。
 */
export function createClient() {
  return createBrowserClient(supabaseUrl, supabaseAnonKey);
}
