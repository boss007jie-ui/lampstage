import { billingHttp, billingJson, billingUser } from "@/lib/billing/http";
import { getBilling } from "@/lib/billing/orders";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export async function GET(request: Request) {
  return billingHttp(async () => {
    const user = await billingUser(request);
    return billingJson(await getBilling(user.id));
  });
}
