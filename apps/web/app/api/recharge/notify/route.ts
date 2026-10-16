import { BillingError } from "@/lib/billing/catalog";
import { parseRechargeNotification, processRechargeNotification } from "@/lib/billing/notifications";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export async function POST(request: Request) {
  try {
    await processRechargeNotification(await parseRechargeNotification(request));
    return new Response("success", { headers: { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "no-store" } });
  } catch (error) {
    // Only acknowledge committed processing. Non-success lets the provider retry.
    return new Response("fail", { status: error instanceof BillingError ? error.status : 503,
      headers: { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "no-store" } });
  }
}
