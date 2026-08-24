import type { Metadata, Viewport } from "next";
import "./globals.css";
import { PwaRegister } from "@/components/pwa-register";

export const metadata: Metadata = {
  title: {
    default: "语巢 · Nestlingo",
    template: "%s · 语巢",
  },
  description: "积词成巢 —— 你的语言学习工作台。粘贴任何内容，一键变成闪卡。",
  applicationName: "语巢 · Nestlingo",
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
      className="h-full antialiased"
    >
      <body className="min-h-full">
        {children}
        <PwaRegister />
      </body>
    </html>
  );
}
