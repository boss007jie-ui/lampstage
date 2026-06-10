/**
 * 额度原子操作：扣减、退款。
 *
 * 设计：
 * - 所有改 credit_balance 的地方走这里，绝不直接 update
 * - 必须在 Prisma 事务里调用（接 tx 参数）
 * - 同时写 CreditTransaction 留痕
 */
import type { Prisma } from "@prisma/client";

const NEW_USER_GRANT = 20;

/**
 * 扣减额度。原子的：先 SELECT FOR UPDATE 锁定行，再更新。
 *
 * 余额 < amount 抛 InsufficientCreditsError，调用方需捕获并回滚事务。
 */
export class InsufficientCreditsError extends Error {
  constructor() {
    super("INSUFFICIENT_CREDITS");
    this.name = "InsufficientCreditsError";
  }
}

export async function consumeCredits(
  tx: Prisma.TransactionClient,
  userId: string,
  amount: number,
  relatedJobId: string,
  note: string = "generation_consume",
): Promise<{ balanceAfter: number }> {
  if (amount <= 0) throw new Error("consumeCredits: amount must be > 0");

  // Postgres-specific: SELECT ... FOR UPDATE 在事务里锁住该用户行
  const rows = await tx.$queryRaw<{ credit_balance: number }[]>`
    SELECT "credit_balance" FROM "User" WHERE id = ${userId} FOR UPDATE
  `;
  if (rows.length === 0) throw new Error(`user ${userId} not found`);
  const before = rows[0].credit_balance;
  if (before < amount) throw new InsufficientCreditsError();

  await tx.user.update({
    where: { id: userId },
    data: { credit_balance: { decrement: amount } },
  });
  await tx.creditTransaction.create({
    data: {
      user_id: userId,
      type: "consume",
      amount: -amount,
      related_job_id: relatedJobId,
      note,
    },
  });
  return { balanceAfter: before - amount };
}

/**
 * 退款额度（生成失败用）。
 */
export async function refundCredits(
  tx: Prisma.TransactionClient,
  userId: string,
  amount: number,
  relatedJobId: string,
  note: string = "generation_refund",
): Promise<{ balanceAfter: number }> {
  if (amount <= 0) throw new Error("refundCredits: amount must be > 0");
  const updated = await tx.user.update({
    where: { id: userId },
    data: { credit_balance: { increment: amount } },
  });
  await tx.creditTransaction.create({
    data: {
      user_id: userId,
      type: "refund",
      amount: amount,
      related_job_id: relatedJobId,
      note,
    },
  });
  return { balanceAfter: updated.credit_balance };
}

export const constants = { NEW_USER_GRANT };
