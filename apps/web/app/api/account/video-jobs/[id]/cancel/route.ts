import { apiJson } from "@/lib/public-api";
import { cancelVideoDraft } from "@/lib/video/job-quota";
import { lifecycleHttp, requireJobManagementUser } from "@/lib/video/job-management-http";
export const runtime = "nodejs";
export async function POST(request: Request, { params }: { params: { id: string } }) { return lifecycleHttp(async () => {
  const auth = await requireJobManagementUser(request);
  if (auth.response) return auth.response;
  const result = await cancelVideoDraft(auth.user.id, params.id);
  return result.ok ? apiJson(result.value) : apiJson(result.body, { status: result.status });
}); }
