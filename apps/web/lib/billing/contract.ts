export type RechargeDisplayMode = "desktop" | "mobile";
export type RechargeOrderView = {
  order_no: string;
  pack: string;
  amount: string;
  credits: number;
  status: "pending" | "paid" | "failed" | "expired";
  creation_state: "creating" | "ready" | "unknown" | "failed";
  display_mode: RechargeDisplayMode;
  pay_url: string | null;
  qr_code_url: string | null;
  created_at: string;
  paid_at: string | null;
  expires_at: string | null;
  can_resume: boolean;
  requires_review?: boolean;
  provider_status_advisory: "OD" | "WP" | "CD" | null;
};

export type RechargePackView = {
  key: string;
  title: string;
  amount: string;
  credits: number;
  currency: "CNY";
};

export type BillingView = {
  balance: number;
  credits_unlimited: boolean;
  billing_mode: "standard" | "internal_test";
  unit: "Token";
  recharge: {
    enabled: boolean;
    unavailable_reason: "not_open" | "not_configured" | null;
    packs: RechargePackView[];
  };
  orders: RechargeOrderView[];
  transactions: Array<{
    id: string;
    type: "grant" | "consume" | "refund" | "manual_adjustment";
    amount: number;
    recharge_order_no: string | null;
    created_at: string;
  }>;
};
