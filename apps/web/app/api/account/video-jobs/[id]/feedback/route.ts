import { requireJobManagementUser, lifecycleHttp } from "@/lib/video/job-management-http";
import { feedbackResponse } from "@/lib/video/template-http";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export async function POST(request: Request, { params }: { params: { id: string } }) { return lifecycleHttp(async () => {
  const auth = await requireJobManagementUser(request);
  if (auth.response) return auth.response;
  return feedbackResponse(auth.user.id, params.id, request);
}); }
