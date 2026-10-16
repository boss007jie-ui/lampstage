import { requireApiUser } from "@/lib/public-api";
import { lifecycleHttp } from "@/lib/video/job-management-http";
import { getTemplateResponse, patchTemplateResponse } from "@/lib/video/template-http";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export async function GET(request: Request, { params }: { params: { id: string } }) { return lifecycleHttp(async () => {
  const auth = await requireApiUser(request);
  if (auth.response) return auth.response;
  return getTemplateResponse(auth.auth.user.id, params.id, request);
}); }
export async function PATCH(request: Request, { params }: { params: { id: string } }) { return lifecycleHttp(async () => {
  const auth = await requireApiUser(request);
  if (auth.response) return auth.response;
  return patchTemplateResponse(auth.auth.user.id, params.id, request);
}); }
