"use client";

// 设置页「账户」分组：emoji 头像（预设 emoji + 背景色）+ 昵称 + 邮箱 + 退出登录。
// 昵称 / 头像存进 Supabase auth 的 user_metadata（跨设备同步，无需改表结构），
// 编辑后本地立即生效；下次进页由服务端 getSession 读回。

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Pencil } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { SettingsGroup } from "./settings-row";

const EMOJIS = ["🐣", "🐻", "🦊", "🐱", "🐰", "🐨", "🦉", "🐳", "🌿", "🌸", "🍀", "☕", "🌙", "⭐"];

// 背景色用固定柔和色值（头像底色，不跟主题 hue 联动，保证 emoji 在浅底上清晰）。
const COLORS = [
  { value: "#e6f0ec", label: "鼠尾草绿" },
  { value: "#e7ebf5", label: "雾霾蓝" },
  { value: "#f6e9e7", label: "藕粉" },
  { value: "#efe8f6", label: "香芋紫" },
  { value: "#f3efe3", label: "燕麦咖" },
];

export type ProfileMeta = { name?: string; emoji?: string; color?: string };

export function ProfileForm({ email, initial }: { email: string; initial: ProfileMeta }) {
  const router = useRouter();
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState(initial.name ?? "");
  const [emoji, setEmoji] = useState(initial.emoji ?? "");
  const [color, setColor] = useState(initial.color ?? "#e6f0ec");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const displayName = name.trim() || email.split("@")[0] || "语巢用户";
  const avatarBg = color || "#e6f0ec";

  async function save() {
    setBusy(true);
    setError(null);
    const supabase = createClient();
    const { error } = await supabase.auth.updateUser({
      data: {
        name: name.trim() || null,
        avatar_emoji: emoji || null,
        avatar_color: color,
      },
    });
    setBusy(false);
    if (error) {
      setError(error.message);
      return;
    }
    // updateUser 不会刷新本地 access token 里的 user_metadata，服务端 getSession 读到的是旧值；
    // 补一次 refreshSession 让新 metadata 立刻写回 token，刷新后服务端就能读到新昵称/头像。
    await supabase.auth.refreshSession();
    setEditing(false);
    router.refresh();
  }

  return (
    <SettingsGroup title="账户">
      {/* 头像 + 昵称 + 邮箱 */}
      <div className="flex items-center gap-4 px-4 py-4">
        <div
          className="flex h-14 w-14 shrink-0 items-center justify-center rounded-full text-2xl leading-none"
          style={{ background: avatarBg }}
        >
          {emoji || (email ? email[0].toUpperCase() : "语")}
        </div>
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-semibold text-zinc-900">{displayName}</p>
          <p className="truncate text-xs text-zinc-400">{email || "未登录"}</p>
        </div>
        <button
          onClick={() => setEditing((v) => !v)}
          aria-label="编辑资料"
          className={`shrink-0 rounded-lg p-2 transition-colors ${
            editing ? "bg-teal-50 text-teal-600" : "text-zinc-400 hover:bg-zinc-100 hover:text-zinc-700"
          }`}
        >
          <Pencil className="h-4 w-4" />
        </button>
      </div>

      {/* 编辑态：昵称 + emoji + 背景色 */}
      {editing && (
        <div className="space-y-4 border-t border-zinc-100 px-4 py-4">
          <div>
            <label className="mb-1.5 block text-xs font-medium text-zinc-600">昵称</label>
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="给自己起个名字"
              className="w-full rounded-lg border border-zinc-200 bg-white px-3 py-2 text-sm text-zinc-800 focus:border-teal-500 focus:outline-none"
            />
          </div>

          <div>
            <p className="mb-1.5 text-xs font-medium text-zinc-600">头像</p>
            <div className="flex flex-wrap gap-2">
              {EMOJIS.map((e) => (
                <button
                  key={e}
                  onClick={() => setEmoji(e)}
                  className={`flex h-10 w-10 items-center justify-center rounded-full text-xl transition-colors ${
                    emoji === e ? "ring-2 ring-teal-400 ring-offset-2" : "hover:bg-zinc-100"
                  }`}
                >
                  {e}
                </button>
              ))}
            </div>
          </div>

          <div>
            <p className="mb-1.5 text-xs font-medium text-zinc-600">背景色</p>
            <div className="flex flex-wrap gap-2">
              {COLORS.map((c) => (
                <button
                  key={c.value}
                  onClick={() => setColor(c.value)}
                  title={c.label}
                  aria-label={c.label}
                  className={`rounded-full transition-transform ${
                    color === c.value ? "ring-2 ring-teal-400 ring-offset-2" : "hover:scale-105"
                  }`}
                >
                  <span
                    className="block h-9 w-9 rounded-full border border-black/10"
                    style={{ background: c.value }}
                  />
                </button>
              ))}
            </div>
          </div>

          {error && <p className="text-sm text-red-600">{error}</p>}

          <div className="flex gap-2">
            <button onClick={save} disabled={busy} className="btn-brand flex-1">
              {busy ? "保存中…" : "保存"}
            </button>
            <button
              onClick={() => setEditing(false)}
              className="rounded-xl border border-zinc-200 px-4 py-2 text-sm text-zinc-600 transition-colors hover:bg-zinc-50"
            >
              取消
            </button>
          </div>
        </div>
      )}

      {/* 退出登录 */}
      <div className="border-t border-zinc-100 px-4 py-3">
        <LogoutButton />
      </div>
    </SettingsGroup>
  );
}

function LogoutButton() {
  const router = useRouter();
  const [busy, setBusy] = useState(false);

  async function logout() {
    setBusy(true);
    const supabase = createClient();
    await supabase.auth.signOut();
    router.replace("/login");
    router.refresh();
  }

  return (
    <button
      onClick={logout}
      disabled={busy}
      className="w-full rounded-xl border border-zinc-200 px-4 py-2.5 text-sm text-zinc-600 transition-colors hover:bg-zinc-50 hover:text-zinc-900 disabled:opacity-60"
    >
      {busy ? "退出中…" : "退出登录"}
    </button>
  );
}
