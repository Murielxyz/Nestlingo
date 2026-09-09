import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { isSupabaseConfigured } from "@/lib/supabase/env";
import { cached } from "@/lib/supabase/query-cache";
import { AppShell } from "@/components/app-shell";
import { OfflineBanner } from "@/components/offline-banner";
import { SetupNotice } from "@/components/setup-notice";

export default async function AppLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  if (!isSupabaseConfigured()) {
    return <SetupNotice />;
  }

  const supabase = await createClient();
  const {
    data: { session },
  } = await supabase.auth.getSession();

  if (!session) {
    redirect("/login");
  }

  // 本地 JWT 可能因 token 过期 / 被吊销而仍能解码，补一次网络校验（getUser）确认用户仍有效。
  // 单用户自用下会话长期有效，用短 TTL 缓存按「用户 + token 过期时间」分 key，
  // 省掉每次导航的网络往返；token 过期或会话刷新时 key 变 → 重新校验，不会误放陈旧用户。
  let user: { id: string } | null = null;
  try {
    user = await cached(`auth:${session.user.id}:${session.expires_at ?? ""}`, async () => {
      const { data } = await supabase.auth.getUser();
      return data.user;
    });
  } catch {
    user = null;
  }
  if (!user) {
    redirect("/login");
  }

  return (
    <div className="min-h-screen">
      <OfflineBanner />
      <AppShell userEmail={session.user.email ?? ""}>{children}</AppShell>
    </div>
  );
}
