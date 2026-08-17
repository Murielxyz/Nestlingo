// Supabase 连接配置。值来自 .env.local 中的 NEXT_PUBLIC_* 环境变量。
export const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
export const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? "";

// 是否已正确填入 Supabase 配置。未填好时应用会显示「配置引导」而不是报错。
export function isSupabaseConfigured(): boolean {
  return supabaseUrl.startsWith("https://") && supabaseAnonKey.length > 20;
}
