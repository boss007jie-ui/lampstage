import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { generateApiKey, publicApiKey } from "@/lib/api-key";
import { prisma } from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "not_signed_in" }, { status: 401 });
  const keys = await prisma.apiKey.findMany({
    where: { user_id: user.id },
    orderBy: { created_at: "desc" },
  });
  return NextResponse.json({ keys: keys.map(publicApiKey) }, { headers: { "Cache-Control": "no-store" } });
}

export async function POST(request: Request) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "not_signed_in" }, { status: 401 });
  const count = await prisma.apiKey.count({ where: { user_id: user.id, revoked_at: null } });
  if (count >= 10) return NextResponse.json({ error: "key_limit_reached" }, { status: 409 });
  let body: { name?: unknown } = {};
  try { body = await request.json(); } catch { /* default name */ }
  const name = typeof body.name === "string" && body.name.trim() ? body.name.trim().slice(0, 80) : "WorkBuddy";
  const generated = generateApiKey();
  const key = await prisma.apiKey.create({
    data: { user_id: user.id, name, key_prefix: generated.prefix, key_hash: generated.hash },
  });
  return NextResponse.json({ key: generated.secret, credential: publicApiKey(key), warning: "请立即复制完整密钥；出于安全原因，之后不会再次显示。" }, { status: 201 });
}
