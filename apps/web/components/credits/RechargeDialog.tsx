"use client";

/**
 * RechargeDialog —— 充值弹窗
 *
 * 流程：
 *   1. 用户点击充值包按钮 → 打开本组件，传入 pack（basic/business/factory）
 *   2. 组件 mount 时 POST /api/recharge/create，拿到支付链接和订单号
 *   3. 把支付链接渲染成二维码（本地 qrcode.react，不外泄）
 *   4. 启动轮询 GET /api/recharge/[orderNo]，每 2.5s 查一次状态
 *   5. status === "paid" 时停止轮询、刷新余额回调、显示成功
 *   6. 提示用户付完后页面会自动刷新（无须手动操作）
 */
import { useEffect, useRef, useState } from "react";
import { QRCodeSVG } from "qrcode.react";

type Pack = "basic" | "business" | "factory";

type Props = {
  open: boolean;
  pack: Pack | null;
  onClose: () => void;
  onPaid?: () => void;
};

type CreateResp = {
  ok?: boolean;
  order_no?: string;
  pay_url?: string;
  amount?: string;
  credits?: number;
  error?: string;
  message?: string;
};

type StatusResp = {
  order_no?: string;
  status?: "pending" | "paid" | "failed" | "expired";
  amount?: string;
  credits?: number;
  paid_at?: string | null;
  error?: string;
};

const PACK_LABEL: Record<Pack, { name: string; price: string; credits: number }> = {
  basic: { name: "体验包", price: "¥30", credits: 100 },
  business: { name: "标准包", price: "¥99", credits: 400 },
  factory: { name: "大包", price: "¥299", credits: 1500 },
};

export function RechargeDialog({ open, pack, onClose, onPaid }: Props) {
  const [phase, setPhase] = useState<"creating" | "qr" | "paid" | "error">(
    "creating",
  );
  const [errMsg, setErrMsg] = useState<string | null>(null);
  const [orderNo, setOrderNo] = useState<string | null>(null);
  const [payUrl, setPayUrl] = useState<string | null>(null);
  const pollRef = useRef<number | null>(null);

  // 创建订单
  useEffect(() => {
    if (!open || !pack) return;
    setPhase("creating");
    setErrMsg(null);
    setOrderNo(null);
    setPayUrl(null);

    let cancelled = false;
    fetch("/api/recharge/create", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ pack }),
    })
      .then(async (r) => {
        const d = (await r.json()) as CreateResp;
        if (cancelled) return;
        if (!r.ok || !d.ok || !d.pay_url || !d.order_no) {
          setPhase("error");
          if (r.status === 401) {
            setErrMsg("请先登录后再充值");
          } else {
            setErrMsg(d.message || d.error || `下单失败 (HTTP ${r.status})`);
          }
          return;
        }
        setOrderNo(d.order_no);
        setPayUrl(d.pay_url);
        setPhase("qr");
      })
      .catch((e) => {
        if (cancelled) return;
        setPhase("error");
        setErrMsg("网络错误：" + String(e));
      });
    return () => {
      cancelled = true;
    };
  }, [open, pack]);

  // 轮询状态
  useEffect(() => {
    if (phase !== "qr" || !orderNo) return;
    let cancelled = false;
    const tick = async () => {
      try {
        const r = await fetch(`/api/recharge/${orderNo}`, { cache: "no-store" });
        const d = (await r.json()) as StatusResp;
        if (cancelled) return;
        if (d.status === "paid") {
          setPhase("paid");
          onPaid?.();
          if (pollRef.current) {
            window.clearInterval(pollRef.current);
            pollRef.current = null;
          }
        }
      } catch {
        // 忽略瞬时错误，下次再试
      }
    };
    pollRef.current = window.setInterval(tick, 2500) as unknown as number;
    return () => {
      cancelled = true;
      if (pollRef.current) {
        window.clearInterval(pollRef.current);
        pollRef.current = null;
      }
    };
  }, [phase, orderNo, onPaid]);

  if (!open || !pack) return null;
  const meta = PACK_LABEL[pack];

  return (
    <div
      className="fixed inset-0 z-50 grid place-items-center bg-black/50 px-4"
      onClick={onClose}
    >
      <div
        className="w-full max-w-md rounded-2xl bg-white p-6 shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-3">
          <div>
            <h2 className="text-[20px] font-semibold tracking-tight text-[#171717]">
              {meta.name} · {meta.price}
            </h2>
            <p className="mt-1 text-[13px] text-[#64748d]">
              支付成功后自动到账 {meta.credits} 张额度，永久有效不清零。
            </p>
          </div>
          <button
            onClick={onClose}
            className="text-[20px] leading-none text-[#94a3b8] hover:text-[#171717]"
            aria-label="关闭"
          >
            ×
          </button>
        </div>

        <div className="mt-5 grid place-items-center rounded-xl border border-[#eee] bg-[#fafafa] p-6 min-h-[280px]">
          {phase === "creating" && (
            <div className="text-center text-[13px] text-[#64748d]">
              正在生成支付二维码…
            </div>
          )}

          {phase === "qr" && payUrl && (
            <div className="flex flex-col items-center gap-3">
              <QRCodeSVG value={payUrl} size={200} level="M" />
              <div className="text-center">
                <div className="text-[13px] font-medium text-[#171717]">
                  请使用微信 / 支付宝 扫码支付
                </div>
                <div className="mt-1 text-[12px] text-[#94a3b8]">
                  订单号：{orderNo}
                </div>
                <div className="mt-1 text-[12px] text-[#94a3b8]">
                  付款后自动到账，无须手动刷新
                </div>
              </div>
            </div>
          )}

          {phase === "paid" && (
            <div className="text-center">
              <div className="mx-auto mb-3 grid h-12 w-12 place-items-center rounded-full bg-emerald-100">
                <svg
                  width="22"
                  height="22"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="#10b981"
                  strokeWidth="3"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                >
                  <polyline points="20 6 9 17 4 12" />
                </svg>
              </div>
              <div className="text-[16px] font-semibold text-[#171717]">
                支付成功 · +{meta.credits} 张额度
              </div>
              <div className="mt-1 text-[12px] text-[#94a3b8]">
                额度已到账，可关闭弹窗继续使用
              </div>
            </div>
          )}

          {phase === "error" && (
            <div className="text-center">
              <div className="text-[14px] font-medium text-rose-600">
                {errMsg || "下单失败"}
              </div>
              <button
                onClick={onClose}
                className="mt-3 rounded-md border border-[#e5edf5] px-3 py-1.5 text-[12px] text-[#64748d] hover:bg-[#f1f5f9]"
              >
                关闭
              </button>
            </div>
          )}
        </div>

        {phase === "qr" && (
          <div className="mt-4 text-center">
            <a
              href={payUrl ?? "#"}
              target="_blank"
              rel="noreferrer"
              className="text-[12px] text-[#533afd] hover:underline"
            >
              手机端无法扫码？点这里直接打开支付页
            </a>
          </div>
        )}

        {phase === "paid" && (
          <button
            onClick={onClose}
            className="mt-4 w-full rounded-md bg-[#171717] px-4 py-2 text-[14px] font-medium text-white hover:bg-black"
          >
            完成
          </button>
        )}
      </div>
    </div>
  );
}
