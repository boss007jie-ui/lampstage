/**
 * 验证码登录 + cookie session 工具。
 *
 * 设计要点：
 * - 验证码 6 位数字，5 分钟过期，存进 VerificationCode 表（hash 存盘，不存明文）
 * - 验证通过后，新用户自动 grant 20 次额度（在事务里写 CreditTransaction(grant)）
 * - Session：cuid 字符串塞 cookie，30 天有效期；server 端用 Session 表查
 * - 不引入 NextAuth 第三方包，自己实现，控制力最大
 *
 * Dev 环境：发码时把 6 位数字直接 console.log，方便联调；不接短信/邮件网关。
 */
import { cookies } from "next/headers";
import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { prisma } from "./db";

const CODE_TTL_MS = 5 * 60 * 1000; // 5 分钟
const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30 天
const SESSION_COOKIE = "lamp_session";
const NEW_USER_GRANT = 20;
const RATE_LIMIT_MS = 60 * 1000; // 同一 identifier 60 秒内只能发一次

export type IdentifierType = "email" | "phone";

function hashCode(code: string, salt: string): string {
  return createHash("sha256").update(`${salt}:${code}`).digest("hex");
}

function generateCode(): string {
  // 6 位数字，crypto-strong
  const buf = randomBytes(4);
  const num = buf.readUInt32BE(0) % 1_000_000;
  return num.toString().padStart(6, "0");
}

function detectType(identifier: string): IdentifierType {
  if (identifier.includes("@")) return "email";
  return "phone";
}

function normalizeIdentifier(identifier: string, type: IdentifierType): string {
  return type === "email" ? identifier.trim().toLowerCase() : identifier.trim();
}

/**
 * 发验证码。返回 { sent: true } 表示已发出；
 * 已发送过且未过期且未消费 → 直接走限流（不重复发）。
 */
export async function sendCode(identifier: string): Promise<{
  sent: boolean;
  reason?: string;
  /** 仅 dev 模式：返回明文验证码方便联调。生产留空。 */
  devCode?: string;
}> {
  const type = detectType(identifier);
  const id = normalizeIdentifier(identifier, type);
  if (!validIdentifier(id, type)) {
    return { sent: false, reason: "invalid_identifier" };
  }

  // 限流：60s 内同一 identifier 不重发
  const recent = await prisma.verificationCode.findFirst({
    where: { identifier: id, type, consumed: false },
    orderBy: { created_at: "desc" },
  });
  if (recent && Date.now() - recent.created_at.getTime() < RATE_LIMIT_MS) {
    return { sent: false, reason: "rate_limited" };
  }

  const code = generateCode();
  const codeHash = hashCode(code, id);
  await prisma.verificationCode.create({
    data: {
      identifier: id,
      code_hash: codeHash,
      type,
      expires_at: new Date(Date.now() + CODE_TTL_MS),
    },
  });

  if (process.env.NODE_ENV !== "production") {
    // eslint-disable-next-line no-console
    console.log(`[dev] verification code for ${id}: ${code}`);
    return { sent: true, devCode: code };
  }
  // TODO: 生产环境接短信/邮件网关
  return { sent: true };
}

/**
 * 验证验证码并完成登录。
 *
 * 成功流程（事务内）：
 * 1. 找到最新未消费、未过期的 code 记录，比对 hash
 * 2. 标记 code consumed
 * 3. upsert User（按 email 或 phone）
 * 4. 如果是新建用户，grant 20 额度 + 写一条 CreditTransaction(grant)
 * 5. 创建 Session
 * 6. 写 cookie
 */
export async function verifyCodeAndSignIn(
  identifier: string,
  code: string,
): Promise<
  | { ok: true; userId: string; isNewUser: boolean; creditBalance: number }
  | { ok: false; reason: "invalid_identifier" | "no_code" | "expired" | "wrong_code" }
> {
  const type = detectType(identifier);
  const id = normalizeIdentifier(identifier, type);
  if (!validIdentifier(id, type)) {
    return { ok: false, reason: "invalid_identifier" };
  }

  const record = await prisma.verificationCode.findFirst({
    where: { identifier: id, type, consumed: false },
    orderBy: { created_at: "desc" },
  });
  if (!record) return { ok: false, reason: "no_code" };
  if (record.expires_at.getTime() < Date.now()) {
    return { ok: false, reason: "expired" };
  }

  const expected = hashCode(code, id);
  const a = Buffer.from(record.code_hash, "hex");
  const b = Buffer.from(expected, "hex");
  if (a.length !== b.length || !timingSafeEqual(a, b)) {
    return { ok: false, reason: "wrong_code" };
  }

  const result = await prisma.$transaction(async (tx) => {
    await tx.verificationCode.update({
      where: { id: record.id },
      data: { consumed: true },
    });

    const where = type === "email" ? { email: id } : { phone: id };
    const existing = await tx.user.findUnique({ where });

    let user;
    let isNewUser = false;
    if (existing) {
      user = existing;
    } else {
      isNewUser = true;
      user = await tx.user.create({
        data:
          type === "email"
            ? { email: id, credit_balance: NEW_USER_GRANT }
            : { phone: id, credit_balance: NEW_USER_GRANT },
      });
      await tx.creditTransaction.create({
        data: {
          user_id: user.id,
          type: "grant",
          amount: NEW_USER_GRANT,
          note: "new_user_signup_grant",
        },
      });
    }

    const session = await tx.session.create({
      data: {
        user_id: user.id,
        expires_at: new Date(Date.now() + SESSION_TTL_MS),
      },
    });

    return { user, session, isNewUser };
  });

  // 写 cookie（在事务外，cookies() 是请求级的）
  cookies().set(SESSION_COOKIE, result.session.id, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: SESSION_TTL_MS / 1000,
    expires: result.session.expires_at,
  });

  return {
    ok: true,
    userId: result.user.id,
    isNewUser: result.isNewUser,
    creditBalance: result.user.credit_balance,
  };
}

/** 取当前会话用户。未登录或过期返回 null。 */
export async function getCurrentUser() {
  const sid = cookies().get(SESSION_COOKIE)?.value;
  if (!sid) return null;
  const session = await prisma.session.findUnique({
    where: { id: sid },
    include: { user: true },
  });
  if (!session) return null;
  if (session.expires_at.getTime() < Date.now()) return null;
  return session.user;
}

/** 退出登录。 */
export async function signOut(): Promise<void> {
  const sid = cookies().get(SESSION_COOKIE)?.value;
  if (sid) {
    await prisma.session
      .delete({ where: { id: sid } })
      .catch(() => undefined);
  }
  cookies().delete(SESSION_COOKIE);
}

function validIdentifier(id: string, type: IdentifierType): boolean {
  if (type === "email") {
    return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(id);
  }
  // 简化的国内手机号校验：11 位数字、1 开头
  return /^1\d{10}$/.test(id);
}
