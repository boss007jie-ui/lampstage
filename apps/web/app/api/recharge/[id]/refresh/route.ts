import { billingHttp, billingJson, billingUser } from "@/lib/billing/http";
import { refreshRechargeOrder } from "@/lib/billing/orders";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export async function POST(request: Request, { params }: { params: { id: string } }) {
  return billingHttp(async () => {
    const user = await billingUser(request);
    return billingJson(await refreshRechargeOrder(user.id, params.id));
  });
}
