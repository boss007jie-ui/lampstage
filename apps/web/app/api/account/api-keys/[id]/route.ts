import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { prisma } from "@/lib/db";

export const runtime = "nodejs";

export async function DELETE(_request: Request, { params }: { params: { id: string } }) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "not_signed_in" }, { status: 401 });
  const result = await prisma.apiKey.updateMany({
    where: { id: params.id, user_id: user.id, revoked_at: null },
    data: { revoked_at: new Date() },
  });
  if (result.count !== 1) {
    // A retry or another tab may have already revoked this key. Acknowledge
    // that outcome without resetting its audit timestamp or exposing other users.
    const key = await prisma.apiKey.findFirst({
      where: { id: params.id, user_id: user.id },
      select: { revoked_at: true },
    });
    if (!key?.revoked_at) return NextResponse.json({ error: "not_found" }, { status: 404 });
  }
  return NextResponse.json({ ok: true }, { headers: { "Cache-Control": "no-store" } });
}
