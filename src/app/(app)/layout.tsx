import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { isSupabaseConfigured } from "@/lib/supabase/env";
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

  return (
    <div className="min-h-screen">
      <OfflineBanner />
      <AppShell userEmail={session.user.email ?? ""}>{children}</AppShell>
    </div>
  );
}
