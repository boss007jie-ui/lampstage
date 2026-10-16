import { lifecycleHttp, requireJobManagementUser, videoJobListResponse } from "@/lib/video/job-management-http";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export async function GET(request: Request) { return lifecycleHttp(async () => {
  const auth = await requireJobManagementUser(request);
  if (auth.response) return auth.response;
  return videoJobListResponse(request, auth.user.id);
}); }
