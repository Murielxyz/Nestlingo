/**
 * 品牌 logo：青色渐变圆角方块 + 白色「巢 + 蛋 + 嫩芽」。
 * 纯展示组件（无 hooks），可同时被服务端和客户端组件引用。
 * favicon 用同一图形（见 src/app/icon.svg）。
 */
export function BrandMark({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 64 64" className={className} aria-hidden="true">
      {/* 圆角方块用纯色填充，避免渐变 id 冲突/解析失败导致整块透明 */}
      <rect width="64" height="64" rx="15" fill="#0d9488" />
      {/* 巢（碗形弧线） */}
      <path d="M15 45 C15 57 49 57 49 45 Z" fill="#ffffff" />
      {/* 蛋 */}
      <ellipse cx="32" cy="31" rx="8.5" ry="10.5" fill="#ffffff" />
      {/* 嫩芽 */}
      <path d="M32 20c0-6.5 6-8 6-8-0.7 6.5-6 8-6 8z" fill="#99f6e4" />
    </svg>
  );
}
