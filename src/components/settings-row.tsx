// 设置页「手机 app 分组列表」排版：section 小标题 + 白卡分组 + 左标签右控件行（iOS 观感）。
// 纯展示组件，可被 server / client 组件共用。

export function SettingsGroup({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <section>
      <h3 className="mb-2 px-1 text-xs font-medium text-zinc-400">{title}</h3>
      <div className="divide-y divide-zinc-100 overflow-hidden rounded-2xl border border-black/5 bg-white/80 shadow-sm backdrop-blur">
        {children}
      </div>
    </section>
  );
}

export function SettingsRow({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children?: React.ReactNode;
}) {
  return (
    <div className="flex items-center justify-between gap-3 px-4 py-3.5">
      <div className="min-w-0">
        <p className="text-sm text-zinc-800">{label}</p>
        {hint && <p className="mt-0.5 text-xs text-zinc-400">{hint}</p>}
      </div>
      {children}
    </div>
  );
}
