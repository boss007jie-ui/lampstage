import { NextResponse } from "next/server";
import { isAdmin } from "@/lib/auth";
import { weeklySceneGeneration } from "@/lib/cron/weekly-scenes";

export const runtime = "nodejs";
export const maxDuration = 300;

async function authorized(req: Request): Promise<boolean> {
  const secret = process.env.CRON_SECRET;
  const authHeader = req.headers.get("authorization");
  if (secret && authHeader === `Bearer ${secret}`) return true;
  return isAdmin();
}

async function run(req: Request) {
  if (!(await authorized(req))) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const result = await weeklySceneGeneration();
  return NextResponse.json({ ok: true, result });
}

export async function GET(req: Request) {
  return run(req);
}

export async function POST(req: Request) {
  return run(req);
}
