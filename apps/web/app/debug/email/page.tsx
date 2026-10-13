import { notFound } from "next/navigation";
import DebugEmailForm from "./debug-email-form";

/**
 * 调试页门禁：生产环境整体关停，与 POST /api/debug/email 保持同一口径。
 *
 * 为什么要连页面一起关：光关接口会留下一个公开的 /debug/email 页面，
 * 上面还挂着一个 "Send test email" 按钮 —— 点了必然 404，属于废 UI；
 * 更糟的是它等于对外的接口广告，与「接口返回 404 而不是 403，
 * 不暴露这里曾经有个接口」的初衷直接矛盾。
 *
 * NODE_ENV 在构建期被内联，所以这里是常量折叠：生产镜像里该分支恒为真，
 * 页面在构建期就变成 404。本地 / 开发环境保留，用于排查 email_send_failed。
 */
const DISABLED_IN_PRODUCTION = process.env.NODE_ENV === "production";

export default function DebugEmailPage() {
  if (DISABLED_IN_PRODUCTION) notFound();
  return <DebugEmailForm />;
}
