import { requireJobManagementUser } from "@/lib/video/job-management-http";
import { characterHttp, characterDetailResponse, characterPatchResponse } from "@/lib/characters/http";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export async function GET(request: Request, context: { params: { id: string } }) { return characterHttp(async () => {
  const auth = await requireJobManagementUser(request);
  if (auth.response) return auth.response;
  return characterDetailResponse(auth.user.id, context.params.id, request);
}); }
export async function PATCH(request: Request, context: { params: { id: string } }) { return characterHttp(async () => {
  const auth = await requireJobManagementUser(request);
  if (auth.response) return auth.response;
  return characterPatchResponse(auth.user.id, context.params.id, request);
}); }
