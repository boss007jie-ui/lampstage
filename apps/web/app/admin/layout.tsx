/**
 * /admin 服务端守卫。
 *
 * page.tsx 是客户端组件，本身无法在渲染前鉴权。这里用服务端 layout
 * 在渲染任何后台 UI 之前先验 isAdmin()：非管理员（含未登录）直接 302 回首页，
 * 连后台界面外壳都看不到。数据层（/api/admin/*）已有 403 兜底，这里是第二道防线。
 */
import { redirect } from "next/navigation";
import { isAdmin } from "@/lib/auth";

export const dynamic = "force-dynamic";

export default async function AdminLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  if (!(await isAdmin())) {
    redirect("/");
  }
  return <>{children}</>;
}
