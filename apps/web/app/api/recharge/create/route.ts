import { billingHttp, billingJson, billingUser, readBillingJson } from "@/lib/billing/http";
import { createRechargeOrder } from "@/lib/billing/orders";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export async function POST(request: Request) {
  return billingHttp(async () => {
    const user = await billingUser(request);
    const result = await createRechargeOrder(user.id, await readBillingJson(request));
    return billingJson({ order: result.order }, result.httpStatus);
  });
}
