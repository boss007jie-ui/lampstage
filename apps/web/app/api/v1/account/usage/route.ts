import { apiJson, requireApiUser } from "@/lib/public-api";
import { getVideoJobUsage } from "@/lib/video/job-quota";
import { lifecycleHttp } from "@/lib/video/job-management-http";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export async function GET(request: Request) { return lifecycleHttp(async () => {
  const auth = await requireApiUser(request);
  if (auth.response) return auth.response;
  return apiJson({ usage: await getVideoJobUsage(auth.auth.user.id) });
}); }
