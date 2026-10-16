import { requireJobManagementUser } from "@/lib/video/job-management-http";
import { characterHttp, charactersListResponse, characterSaveResponse } from "@/lib/characters/http";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export async function GET(request: Request) { return characterHttp(async () => {
  const auth = await requireJobManagementUser(request);
  if (auth.response) return auth.response;
  return charactersListResponse(auth.user.id, request);
}); }
export async function POST(request: Request) { return characterHttp(async () => {
  const auth = await requireJobManagementUser(request);
  if (auth.response) return auth.response;
  return characterSaveResponse(auth.user.id, request);
}); }
