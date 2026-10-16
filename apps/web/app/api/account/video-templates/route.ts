import { requireJobManagementUser, lifecycleHttp } from "@/lib/video/job-management-http";
import { listTemplatesResponse } from "@/lib/video/template-http";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export async function GET(request: Request) { return lifecycleHttp(async () => {
  const auth = await requireJobManagementUser(request);
  if (auth.response) return auth.response;
  return listTemplatesResponse(auth.user.id, request);
}); }
