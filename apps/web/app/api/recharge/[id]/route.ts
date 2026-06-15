/**
 * GET /api/recharge/[id]
 *
 * 前端轮询订单状态。id = order_no（不是数据库 id）。
 * 必须登录，且只能看自己的订单。
 */
import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { prisma } from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(
  _req: Request,
  { params }: { params: { id: string } },
) {
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ error: "not_signed_in" }, { status: 401 });
  }

  const orderNo = params.id;
  if (!orderNo) {
    return NextResponse.json({ error: "missing_order" }, { status: 400 });
  }

  const order = await prisma.rechargeOrder.findUnique({
    where: { order_no: orderNo },
    select: {
      order_no: true,
      user_id: true,
      pack: true,
      amount_yuan: true,
      credits: true,
      status: true,
      pay_url: true,
      paid_at: true,
      created_at: true,
    },
  });

  if (!order) {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }
  if (order.user_id !== user.id) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  return NextResponse.json({
    order_no: order.order_no,
    pack: order.pack,
    amount: String(order.amount_yuan),
    credits: order.credits,
    status: order.status,
    pay_url: order.pay_url,
    paid_at: order.paid_at,
    created_at: order.created_at,
  });
}
