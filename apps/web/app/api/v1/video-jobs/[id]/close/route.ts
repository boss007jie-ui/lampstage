import { requireApiUser } from "@/lib/public-api";
import { lifecycleHttp, videoJobCloseResponse } from "@/lib/video/job-management-http";
export const runtime = "nodejs";
export async function POST(request: Request, { params }: { params: { id: string } }) { return lifecycleHttp(async () => {
  const auth = await requireApiUser(request);
  if (auth.response) return auth.response;
  return videoJobCloseResponse(request, auth.auth.user.id, params.id);
}); }
