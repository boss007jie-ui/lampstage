import { NextResponse } from "next/server";
import { requireVideoUser, videoRoute } from "@/lib/video/http";
import { viewVideoJob } from "@/lib/video/projects";
export const dynamic = "force-dynamic";
export async function GET(_request: Request, { params }: { params: { id: string } }) { return videoRoute(async () => {
  const user = await requireVideoUser();
  return NextResponse.json({ project: await viewVideoJob(params.id, user.id) }, { headers: { "Cache-Control": "no-store" } });
}); }
