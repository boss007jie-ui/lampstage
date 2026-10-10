// Keep account migration details in private diagnostics; the client receives a stable code.
export function isProviderMigrationError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : typeof error === "string" ? error : "";
  return /已迁移|migrated/i.test(message) && /openlux\.ai/i.test(message);
}

export function publicGenerationFailure(reason: string | null): string | null {
  return isProviderMigrationError(reason) ? "图片服务账号已迁移，请管理员更新图片配置后重试。" : reason;
}
