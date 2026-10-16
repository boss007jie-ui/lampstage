import { readImageUploadForm } from "@/lib/assets/image-upload-http";
import { NextRequest } from "next/server";
import { apiJson, requireApiUser } from "@/lib/public-api";
import { uploadImageContent, ImageContentError, MAX_IMAGE_BYTES } from "@/lib/assets/image-content";
export const runtime = "nodejs";
export const maxDuration = 30;
export async function POST(request: NextRequest) {
  const auth = await requireApiUser(request);
  if ("response" in auth) return auth.response;
  let form: FormData;
  try { form = await readImageUploadForm(request); }
  catch (e) { return apiJson({ error: e instanceof ImageContentError ? e.code : "invalid_multipart" }, { status: e instanceof ImageContentError ? e.status : 400 }); }
  const file = form.get("file");
  if (!(file instanceof File)) return apiJson({ error: "missing_file" }, { status: 400 });
  if (file.size > MAX_IMAGE_BYTES) return apiJson({ error: "file_too_large", max_bytes: MAX_IMAGE_BYTES }, { status: 400 });
  try {
    const result = await uploadImageContent(auth.auth.user.id, Buffer.from(await file.arrayBuffer()));
    const a = result.asset;
    return apiJson({ id: a.id, asset_id: a.id, image_url: a.image_url, width: a.width, height: a.height,
      sha256: result.content.sha256, reused_content: result.reused_content }, { status: 201 });
  } catch (e) { return apiJson({ error: e instanceof ImageContentError ? e.code : "upload_unavailable" },
    { status: e instanceof ImageContentError ? e.status : 503 }); }
}
