import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

/**
 * 处理邮箱验证 / 魔法链接登录后的回调：用 code 换取会话，再跳回应用。
 */
export async function GET(request: Request) {
  const { searchParams, origin } = new URL(request.url);
  const code = searchParams.get("code");
  const next = searchParams.get("next") ?? "/notes";

  if (code) {
    const supabase = await createClient();
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    if (!error) {
      return NextResponse.redirect(`${origin}${next}`);
    }
  }

  return NextResponse.redirect(`${origin}/login?error=auth`);
}
