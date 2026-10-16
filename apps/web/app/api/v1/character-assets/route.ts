import { requireApiUser } from "@/lib/public-api";
import { characterHttp, characterAssetsListResponse, characterAssetsUploadResponse } from "@/lib/characters/http";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export async function GET(request: Request) { return characterHttp(async () => {
  const auth = await requireApiUser(request);
  if (auth.response) return auth.response;
  return characterAssetsListResponse(auth.auth.user.id, request);
}); }
export async function POST(request: Request) { return characterHttp(async () => {
  const auth = await requireApiUser(request);
  if (auth.response) return auth.response;
  return characterAssetsUploadResponse(auth.auth.user.id, request);
}); }
