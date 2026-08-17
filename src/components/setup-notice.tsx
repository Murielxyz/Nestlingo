import { BrandMark } from "./brand-mark";

/**
 * 尚未配置 Supabase 时显示的引导页。
 * 纯展示组件（无 hooks），可同时被服务端和客户端组件引用。
 */
export function SetupNotice() {
  return (
    <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-teal-50 to-violet-50 p-6">
      <div className="w-full max-w-lg bg-white rounded-2xl shadow-xl p-8">
        <div className="text-center mb-6">
          <BrandMark className="mx-auto mb-3 h-14 w-14" />
          <h1 className="text-2xl font-bold text-zinc-900">语巢 · 首次配置</h1>
          <p className="text-sm text-zinc-500 mt-1">
            还差最后一步，就能开始记录和背诵了。
          </p>
        </div>

        <ol className="space-y-4 text-sm text-zinc-700">
          <li className="flex gap-3">
            <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-teal-600 text-white text-xs font-bold">
              1
            </span>
            <span>
              打开{" "}
              <a
                href="https://supabase.com"
                target="_blank"
                rel="noopener noreferrer"
                className="text-teal-600 underline"
              >
                supabase.com
              </a>{" "}
              注册并新建一个项目（免费）。
            </span>
          </li>
          <li className="flex gap-3">
            <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-teal-600 text-white text-xs font-bold">
              2
            </span>
            <span>
              项目控制台左侧 <strong>Settings → API</strong>，复制
              <strong> Project URL</strong> 和 <strong>anon public</strong> key。
            </span>
          </li>
          <li className="flex gap-3">
            <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-teal-600 text-white text-xs font-bold">
              3
            </span>
            <span>
              把两个值填进项目根目录的 <code className="rounded bg-zinc-100 px-1">.env.local</code>{" "}
              文件，然后重启 <code className="rounded bg-zinc-100 px-1">npm run dev</code>。
            </span>
          </li>
        </ol>

        <div className="mt-6 rounded-lg bg-amber-50 border border-amber-200 p-3 text-xs text-amber-800">
          提示：完整步骤（含建表 SQL、关闭邮箱验证、部署）见项目根目录的{" "}
          <code className="rounded bg-amber-100 px-1">README.md</code>。
        </div>
      </div>
    </div>
  );
}
