"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { isSupabaseConfigured } from "@/lib/supabase/env";
import { SetupNotice } from "@/components/setup-notice";
import { BrandMark } from "@/components/brand-mark";

/** 给 Promise 加超时：超时后抛出异常，避免网络不通时界面永远卡在「登录中」。 */
function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("timeout")), ms);
    promise.then(
      (v) => {
        clearTimeout(timer);
        resolve(v);
      },
      (e) => {
        clearTimeout(timer);
        reject(e);
      }
    );
  });
}

export default function LoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  if (!isSupabaseConfigured()) {
    return <SetupNotice />;
  }

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    setLoading(true);

    const supabase = createClient();

    try {
      // 加 15 秒超时：网络不通时不会永远卡在「登录中」。
      const { error } = await withTimeout(
        supabase.auth.signInWithPassword({ email, password }),
        15000
      );

      if (error) {
        setError(
          error.message === "Invalid login credentials"
            ? "邮箱或密码不正确。"
            : error.message
        );
        return;
      }

      router.replace("/notes");
      router.refresh();
    } catch {
      // 网络错误 / 超时：signInWithPassword 会直接抛异常（而不是返回 error）。
      setError(
        "无法连接 Supabase 服务器（网络错误或超时）。请检查网络后重试。"
      );
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-teal-50 to-violet-50 p-4">
      <div className="w-full max-w-sm bg-white rounded-2xl shadow-xl p-8">
        <div className="text-center mb-6">
          <BrandMark className="mx-auto mb-3 h-14 w-14" />
          <h1 className="text-2xl font-bold text-zinc-900">语巢</h1>
          <p className="text-sm font-medium tracking-wide text-zinc-400">Nestlingo</p>
          <p className="text-sm text-zinc-500 mt-1">记录即背诵 · 语言学习工作台</p>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label
              htmlFor="email"
              className="block text-sm font-medium text-zinc-700 mb-1"
            >
              邮箱
            </label>
            <input
              id="email"
              type="email"
              required
              autoComplete="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="w-full rounded-lg border border-zinc-300 px-3 py-2 text-sm focus:border-teal-500 focus:outline-none focus:ring-2 focus:ring-teal-200"
              placeholder="you@example.com"
            />
          </div>

          <div>
            <label
              htmlFor="password"
              className="block text-sm font-medium text-zinc-700 mb-1"
            >
              密码
            </label>
            <input
              id="password"
              type="password"
              required
              autoComplete="current-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="w-full rounded-lg border border-zinc-300 px-3 py-2 text-sm focus:border-teal-500 focus:outline-none focus:ring-2 focus:ring-teal-200"
              placeholder="••••••••"
            />
          </div>

          {error && (
            <p className="text-sm text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2">
              {error}
            </p>
          )}

          <button
            type="submit"
            disabled={loading}
            className="w-full rounded-lg bg-teal-600 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-teal-700 disabled:opacity-60"
          >
            {loading ? "登录中…" : "登录"}
          </button>
        </form>

        <p className="mt-6 text-center text-xs text-zinc-400">
          私有笔记 · 仅限本人登录
        </p>
      </div>
    </div>
  );
}
