import { requireApiUser } from "@/lib/public-api";
import { characterHttp, charactersListResponse, characterSaveResponse } from "@/lib/characters/http";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export async function GET(request: Request) { return characterHttp(async () => {
  const auth = await requireApiUser(request);
  if (auth.response) return auth.response;
  return charactersListResponse(auth.auth.user.id, request);
}); }
export async function POST(request: Request) { return characterHttp(async () => {
  const auth = await requireApiUser(request);
  if (auth.response) return auth.response;
  return characterSaveResponse(auth.auth.user.id, request);
}); }
