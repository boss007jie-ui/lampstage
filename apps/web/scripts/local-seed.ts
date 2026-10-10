import { PrismaClient } from "@prisma/client";
import bcrypt from "bcryptjs";
import { loadLocalProfile } from "./local-profile";

async function main() {
  const config = await loadLocalProfile();
  const url = new URL(process.env.DATABASE_URL!);
  if (url.hostname !== "127.0.0.1" || url.port !== "55432" || url.pathname !== "/lampstage_local") throw new Error("Local seed refused a non-local database.");
  const prisma = new PrismaClient();
  try {
    const existing = await prisma.user.findUnique({ where: { email: config.email } });
    if (!existing) await prisma.$transaction(async tx => {
      const user = await tx.user.create({ data: { email: config.email, name: "本地测试", role: "ADMIN", password_hash: await bcrypt.hash(config.password, 10), email_verified: new Date(), credit_balance: 20 } });
      await tx.creditTransaction.create({ data: { user_id: user.id, type: "grant", amount: 20, note: "local_test_account" } });
    });
    // Static seed images already belong to the website; this does not generate new images.
    const { ensureDefaultSceneSeeds } = await import("../lib/scene-seed");
    await ensureDefaultSceneSeeds();
    console.log("Local account and static scene references ready.");
  } finally { await prisma.$disconnect(); }
}
void main().catch(() => { console.error("Could not seed the isolated local database."); process.exitCode = 1; });
