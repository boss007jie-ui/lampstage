import { NextRequest, NextResponse } from "next/server";
import { apiJson } from "@/lib/public-api";
import { prisma } from "@/lib/db";
import { requireJobManagementUser, lifecycleHttp } from "@/lib/video/job-management-http";
import { localMediaResponse, privateMediaUrl } from "@/lib/video/storage";
import { videoData } from "@/lib/video/types";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export async function GET(request: NextRequest, { params }: { params: { id: string } }) { return lifecycleHttp(async () => {
  const auth = await requireJobManagementUser(request);
  if (auth.response) return auth.response;
  const job = await prisma.videoJob.findFirst({ where: { id: params.id, user_id: auth.user.id }, include: { source_asset: true } });
  if (!job) return apiJson({ error: "not_found" }, { status: 404 });
  const data = videoData(job.data);
  const kind = request.nextUrl.searchParams.get("kind");
  let key: string | undefined; let mime = "video/mp4";
  if (kind === "source") { key = job.source_asset.storage_key; mime = job.source_asset.mime; }
  else if (kind === "output") key = data.outputKey;
  else if (kind === "candidate") {
    const raw = request.nextUrl.searchParams.get("segment");
    if (!raw || !/^\d+$/.test(raw)) return apiJson({ error: "invalid_segment" }, { status: 400 });
    key = data.segments.find(s => s.index === Number(raw))?.candidateKey;
  } else return apiJson({ error: "invalid_media_kind" }, { status: 400 });
  if (!key) return apiJson({ error: "media_not_found" }, { status: 404 });
  const download = request.nextUrl.searchParams.get("download") === "1";
  const name = download ? `lampstage-${job.id}${kind === "candidate" ? `-segment-${request.nextUrl.searchParams.get("segment")}` : ""}.${mime === "video/webm" ? "webm" : mime === "video/quicktime" ? "mov" : "mp4"}` : undefined;
  const url = await privateMediaUrl(key, mime, name);
  if (url) return new NextResponse(null, { status: 302, headers: { Location: url, "Cache-Control": "private, no-store", "Referrer-Policy": "no-referrer" } });
  return localMediaResponse(key, mime, request.headers.get("range"), name);
}); }
