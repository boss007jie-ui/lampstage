import { requireJobManagementUser, lifecycleHttp, videoJobCloseResponse } from "@/lib/video/job-management-http";
export const runtime = "nodejs";
export async function POST(request: Request, { params }: { params: { id: string } }) { return lifecycleHttp(async () => {
  const auth = await requireJobManagementUser(request);
  if (auth.response) return auth.response;
  return videoJobCloseResponse(request, auth.user.id, params.id);
}); }
