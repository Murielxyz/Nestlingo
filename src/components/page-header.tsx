import type { ReactNode } from "react";
import { BackButton } from "./back-button";

/**
 * 统一页面头：返回 ← + 标题 + 右侧动作，嵌在页面渐变背景里，底部 hairline 与内容切分。
 * 用于一级 / 次级页顶部，替换各页手写的 <header> + <BackButton> + 标题。
 * 需作为「max-w-5xl px-4 py-6」容器的直接子元素（.page-header 用负外边距抵消容器留白贴满整宽）。
 */
export function PageHeader({
  title,
  backHref,
  actions,
  className = "",
}: {
  title: ReactNode;
  /** 传了才渲染返回箭头；一级页通常不传。 */
  backHref?: string;
  /** 右侧动作区（按钮 / ⋯ 菜单）。 */
  actions?: ReactNode;
  className?: string;
}) {
  return (
    <header className={`page-header mb-5 flex items-center gap-2 ${className}`}>
      {backHref ? (
        <BackButton
          fallback={backHref}
          className="rounded-lg p-1.5 text-zinc-500 transition-colors hover:bg-zinc-100 hover:text-zinc-900"
        />
      ) : null}
      <h1 className="min-w-0 flex-1 truncate text-2xl font-bold text-zinc-900">
        {title}
      </h1>
      {actions ? (
        <div className="flex shrink-0 items-center gap-1.5">{actions}</div>
      ) : null}
    </header>
  );
}
