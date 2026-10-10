import { NextResponse } from "next/server";
import { videoCapabilities } from "@/lib/video/http";
export const dynamic = "force-dynamic";
export async function GET() { return NextResponse.json(await videoCapabilities(), { headers: { "Cache-Control": "no-store" } }); }
