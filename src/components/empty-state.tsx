/**
 * 空状态占位卡片（纯展示，无 hooks）。
 */
export function EmptyState({
  icon,
  title,
  description,
}: {
  icon: string;
  title: string;
  description: string;
}) {
  return (
    <div className="flex flex-col items-center justify-center text-center rounded-2xl border-2 border-dashed border-zinc-200 bg-white/60 py-16 px-6">
      <div className="text-4xl mb-3">{icon}</div>
      <h2 className="text-base font-semibold text-zinc-800">{title}</h2>
      <p className="mt-1 text-sm text-zinc-500 max-w-xs">{description}</p>
    </div>
  );
}
