import { NextResponse } from "next/server";
import { getCurrentUser } from "../auth";
import { BillingError } from "./catalog";

export function billingJson(value: unknown, status = 200) {
  return NextResponse.json(value, { status, headers: { "Cache-Control": "private, no-store" } });
}

export async function billingUser(request: Request) {
  const user = await getCurrentUser();
  if (!user) throw new BillingError("not_signed_in", 401);
  if (!["GET", "HEAD"].includes(request.method)) {
    const url = new URL(request.url);
    const expected = `${url.protocol}//${request.headers.get("host") || url.host}`;
    if (request.headers.get("origin") !== expected) throw new BillingError("invalid_origin", 403);
  }
  return user;
}

export async function billingHttp(action: () => Promise<Response>): Promise<Response> {
  try { return await action(); }
  catch (error) {
    if (error instanceof BillingError) return billingJson({ error: error.code }, error.status);
    // Do not log request bodies, payment links, provider responses, or database credentials.
    return billingJson({ error: "billing_unavailable" }, 503);
  }
}

export async function readBillingJson(request: Request): Promise<unknown> {
  const text = await readBoundedText(request, 2048);
  try { return JSON.parse(text) as unknown; } catch { throw new BillingError("invalid_json"); }
}

export async function readBoundedText(request: Request, limit: number): Promise<string> {
  const length = request.headers.get("content-length");
  if (length !== null && (!/^\d+$/.test(length) || Number(length) > limit)) throw new BillingError("invalid_body", 413);
  const reader = request.body?.getReader();
  if (!reader) throw new BillingError("invalid_body");
  let size = 0;
  const chunks: Uint8Array[] = [];
  try {
    while (true) {
      const part = await reader.read();
      if (part.done) break;
      size += part.value.byteLength;
      if (size > limit) { await reader.cancel(); throw new BillingError("invalid_body", 413); }
      chunks.push(part.value);
    }
    return new TextDecoder("utf-8", { fatal: true }).decode(Buffer.concat(chunks, size));
  } catch (error) {
    if (error instanceof BillingError) throw error;
    throw new BillingError("invalid_body");
  } finally { reader.releaseLock(); }
}
