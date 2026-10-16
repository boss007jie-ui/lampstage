import { requireJobManagementUser } from "@/lib/video/job-management-http";
import { characterHttp, characterAssetsListResponse, characterAssetsUploadResponse } from "@/lib/characters/http";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export async function GET(request: Request) { return characterHttp(async () => {
  const auth = await requireJobManagementUser(request);
  if (auth.response) return auth.response;
  return characterAssetsListResponse(auth.user.id, request);
}); }
export async function POST(request: Request) { return characterHttp(async () => {
  const auth = await requireJobManagementUser(request);
  if (auth.response) return auth.response;
  return characterAssetsUploadResponse(auth.user.id, request);
}); }
