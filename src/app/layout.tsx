import type { Metadata, Viewport } from "next";
import { Inter } from "next/font/google";
import "./globals.css";
import { PwaRegister } from "@/components/pwa-register";
import { ThemeSync } from "@/components/theme-sync";

// 自托管 Inter（最接近苹果 SF Pro 的系统字体），仅作为非苹果设备的兜底：
// 真 iPhone / Mac 仍走 -apple-system 的原生 SF Pro，安卓 / 网页端才落到 Inter，
// 让全平台都贴近 iOS 观感。构建期下载并本地托管，浏览器不再请求 Google。
const inter = Inter({
  subsets: ["latin"],
  variable: "--font-inter",
  display: "swap",
});

export const metadata: Metadata = {
  title: {
    default: "语巢 · Nestlingo",
    template: "%s · 语巢",
  },
  description: "积词成巢 —— 你的语言学习工作台。粘贴任何内容，一键变成闪卡。",
  applicationName: "语巢 · Nestlingo",
  // 关键：manifest.ts 只生成 /manifest.webmanifest，不会自动加 <link rel="manifest">；
  // 不显式声明，Chrome 就检测不到 manifest，判定不了「可安装 PWA」，
  // 安卓上「安装应用 / 添加到主屏幕」入口不会出现。
  manifest: "/manifest.webmanifest",
  appleWebApp: {
    capable: true,
    title: "语巢",
    statusBarStyle: "default",
  },
  icons: {
    apple: "/icons/apple-touch-icon.png",
  },
};

export const viewport: Viewport = {
  themeColor: "#fafbfa",
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
  userScalable: false,
  viewportFit: "cover",
  // 键盘弹起时保持布局视口不变（只缩放可视视口），sticky 工具栏才不会跟着被顶上去
  interactiveWidget: "resizes-visual",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html
      lang="zh-CN"
      suppressHydrationWarning
      className={`h-full antialiased ${inter.variable}`}
    >
      <head>
        {/* 首屏前读取主题色，设 data-theme，避免闪回默认色（设置页「外观」写 localStorage） */}
        <script
          dangerouslySetInnerHTML={{
            __html: `try{var t=localStorage.getItem("ln_theme_color");if(t&&["sage","blue","rose","lavender","oat"].indexOf(t)>=0)document.documentElement.setAttribute("data-theme",t);}catch(e){}`,
          }}
        />
      </head>
      <body className="min-h-full">
        {children}
        <ThemeSync />
        <PwaRegister />
      </body>
    </html>
  );
}
