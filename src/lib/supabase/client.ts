import { createBrowserClient } from "@supabase/ssr";
import { supabaseUrl, supabaseAnonKey } from "./env";

/**
 * 浏览器端（客户端组件）使用的 Supabase client。
 * 只在组件被调用时创建，避免在服务端被误用。
 */
export function createClient() {
  return createBrowserClient(supabaseUrl, supabaseAnonKey);
}

/**
 * 删除笔记前，把指向它的素材解绑：撤销「已导入」，回退成「待处理」。
 * 避免删除后素材列表仍留着一个已失效的 note_id，点击跳 /notes/{id} 撞 404。
 * 在删笔记之前调用（此时 .eq("note_id") 仍能匹配到）。
 */
export async function detachMaterialsFromNote(noteId: string) {
  return createClient()
    .from("materials")
    .update({ status: "pending", note_id: null })
    .eq("note_id", noteId);
}
