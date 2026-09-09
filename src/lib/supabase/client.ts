import { createBrowserClient } from "@supabase/ssr";
import { supabaseUrl, supabaseAnonKey } from "./env";

/**
 * 浏览器端（客户端组件）使用的 Supabase client。
 * 只在组件被调用时创建，避免在服务端被误用。
 *
 * 返回的 client 会拦截 `.from(...)` 上的 insert/update/delete/upsert：
 * 一发起写操作就通知服务端清掉 Supabase 读缓存（见 query-cache.ts），
 * 这样组件里做完写、再 router.refresh()，服务端重新渲染时读到的才是新数据。
 * 用 fire-and-forget 的 fetch，不阻塞写本身。
 */
export function createClient() {
  const client = createBrowserClient(supabaseUrl, supabaseAnonKey);
  const from = client.from.bind(client);
  client.from = ((table: string) => {
    const builder = from(table);
    return new Proxy(builder, {
      get(target, prop, receiver) {
        const value = Reflect.get(target, prop, receiver);
        if (
          typeof value === "function" &&
          (prop === "insert" || prop === "update" || prop === "delete" || prop === "upsert")
        ) {
          return (...args: unknown[]) => {
            mutePurge();
            return value.apply(target, args);
          };
        }
        return typeof value === "function" ? value.bind(target) : value;
      },
    });
  }) as typeof client.from;
  return client;
}

/** 写操作一开始就清服务端缓存（不等写完成；新的读发生在写之后，读到的是新数据）。 */
function mutePurge() {
  try {
    void fetch("/api/cache/purge", { method: "POST" }).catch(() => {});
  } catch {
    // 忽略：清缓存失败只影响短暂读到旧值，不打断写。
  }
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
