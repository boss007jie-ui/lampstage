import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "灯境 AI · 一张灯具图，生成可直接上架的家居场景图",
  description:
    "为灯具卖家快速生成适用于淘宝、天猫、1688、Shopify 和独立站的专业场景图，减少拍摄成本，加快上新速度。",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="zh-CN">
      <body className="bg-white text-[#061b31] antialiased">{children}</body>
    </html>
  );
}
