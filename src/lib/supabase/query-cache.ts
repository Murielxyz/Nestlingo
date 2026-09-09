// 极简服务端短 TTL 缓存：单用户自用，缓存那些「每次导航都要重新查」的 Supabase 读。
// Keyed by 用户 + 查询名 + 参数，避免跨请求重复往返 Supabase。写操作由浏览器端
// createClient() 拦截（见 client.ts）自动调 /api/cache/purge 清空，保证写后刷新读到的是新数据。
//
// 说明：这是进程内缓存，Vercel serverless 实例可能随时回收，命中率不保证 100%，
// 但同一实例在窗口期内连续处理多次请求时能消掉绝大多数往返。TTL 取一个「对单人自用足够新鲜」的短值。

/** 缓存条目的驻留时长（毫秒）。到点后下次读会重新打 Supabase。 */
export const QUERY_CACHE_TTL_MS = 15_000;

type Entry = { at: number; value: unknown };
const store = new Map<string, Entry>();

/** 命中且未过期就返回缓存值，否则执行 fn 并写入缓存。fn 抛错则不缓存。 */
export async function cached<T>(key: string, fn: () => Promise<T>): Promise<T> {
  const hit = store.get(key);
  if (hit && Date.now() - hit.at < QUERY_CACHE_TTL_MS) return hit.value as T;
  const value = await fn();
  store.set(key, { at: Date.now(), value });
  return value;
}

/** 清空全部缓存（写操作后调用）。 */
export function clearQueryCache() {
  store.clear();
}

/** 仅在开发/调试时用：当前缓存条数。 */
export function queryCacheSize() {
  return store.size;
}
