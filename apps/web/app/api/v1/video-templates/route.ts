import { requireApiUser } from "@/lib/public-api";
import { lifecycleHttp } from "@/lib/video/job-management-http";
import { listTemplatesResponse } from "@/lib/video/template-http";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export async function GET(request: Request) { return lifecycleHttp(async () => {
  const auth = await requireApiUser(request);
  if (auth.response) return auth.response;
  return listTemplatesResponse(auth.auth.user.id, request);
}); }
