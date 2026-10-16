import { requireJobManagementUser } from "@/lib/video/job-management-http";
import { characterHttp, characterSaveResponse } from "@/lib/characters/http";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export async function POST(request: Request, context: { params: { id: string } }) { return characterHttp(async () => {
  const auth = await requireJobManagementUser(request);
  if (auth.response) return auth.response;
  return characterSaveResponse(auth.user.id, request, context.params.id);
}); }
