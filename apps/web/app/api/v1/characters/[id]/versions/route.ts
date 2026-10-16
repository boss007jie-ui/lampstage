import { requireApiUser } from "@/lib/public-api";
import { characterHttp, characterSaveResponse } from "@/lib/characters/http";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export async function POST(request: Request, context: { params: { id: string } }) { return characterHttp(async () => {
  const auth = await requireApiUser(request);
  if (auth.response) return auth.response;
  return characterSaveResponse(auth.auth.user.id, request, context.params.id);
}); }
