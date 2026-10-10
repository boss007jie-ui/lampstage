import { NextRequest, NextResponse } from "next/server";
import { getObjectBytes } from "@/lib/storage";
import { prisma } from "@/lib/db";
import sharp from "sharp";
import { requireVideoUser, videoRoute, VideoHttpError } from "@/lib/video/http";
import { ownedVideoJob } from "@/lib/video/projects";
import { videoData } from "@/lib/video/types";
import { localMediaResponse, privateMediaUrl } from "@/lib/video/storage";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export async function GET(request: NextRequest, { params }: { params: { id: string } }) { return videoRoute(async () => {
  const user = await requireVideoUser();
  const job = await ownedVideoJob(params.id, user.id);
  const kind = request.nextUrl.searchParams.get("kind");
  const data = videoData(job.data);
  if (kind === "product") {
    const product = await prisma.uploadedAsset.findFirst({ where: { id: job.product_asset_id, user_id: user.id } });
    if (!product) throw new VideoHttpError(404, "商品图不存在。");
    const { bytes } = await getObjectBytes(product.image_url);
    const preview = await sharp(bytes).rotate().resize(1280, 1280, { fit: "inside", withoutEnlargement: true }).jpeg({ quality: 85 }).toBuffer();
    return new Response(new Uint8Array(preview), { headers: { "Content-Type": "image/jpeg", "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff" } });
  }
  let key: string | undefined; let mime = "video/mp4";
  if (kind === "source") { key = job.source_asset.storage_key; mime = job.source_asset.mime; }
  else if (kind === "output") key = data.outputKey;
  else if (["opening", "ending", "candidate"].includes(kind || "")) {
    const indexString = request.nextUrl.searchParams.get("segment");
    const index = Number(indexString);
    if (indexString === null || !Number.isInteger(index) || index < 0) throw new VideoHttpError(400, "片段索引无效。");
    const segment = data.segments.find(s => s.index === index);
    key = kind === "opening" ? segment?.openingKey : kind === "ending" ? segment?.endingKey : segment?.candidateKey;
    if (kind !== "candidate") mime = "image/png";
  }
  if (!key) throw new VideoHttpError(404, "视频素材尚未生成。");
  const download = kind === "output" && request.nextUrl.searchParams.get("download") === "1" ? `lampstage-${job.id}.mp4` : undefined;
  const url = await privateMediaUrl(key, mime, download);
  if (url) return new NextResponse(null, { status: 302, headers: { Location: url, "Cache-Control": "private, no-store", "Referrer-Policy": "no-referrer" } });
  return localMediaResponse(key, mime, request.headers.get("range"), download);
}); }
