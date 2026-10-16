import { billingHttp, billingJson, billingUser } from "@/lib/billing/http";
import { getOwnedRechargeOrder } from "@/lib/billing/orders";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export async function GET(request: Request, { params }: { params: { id: string } }) {
  return billingHttp(async () => {
    const user = await billingUser(request);
    return billingJson({ order: await getOwnedRechargeOrder(user.id, params.id) });
  });
}
