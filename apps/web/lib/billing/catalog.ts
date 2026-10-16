/** Server-side package snapshots. Sales remain disabled until explicitly enabled. */
export const RECHARGE_PACKS = {
  basic: { amountYuan: "30.00", credits: 100, title: "创境体验包 · 100 Token" },
  business: { amountYuan: "99.00", credits: 400, title: "创境标准包 · 400 Token" },
  factory: { amountYuan: "299.00", credits: 1500, title: "创境大包 · 1500 Token" },
} as const;

export type PackKey = keyof typeof RECHARGE_PACKS;
export function getPack(key: string) {
  return Object.prototype.hasOwnProperty.call(RECHARGE_PACKS, key) ? RECHARGE_PACKS[key as PackKey] : null;
}

/** Exact cents; reject exponent notation, signs, whitespace and fractional cents. */
export function moneyCents(value: string): number | null {
  if (!/^(?:0|[1-9]\d{0,7})(?:\.\d{1,2})?$/.test(value)) return null;
  const [whole, fraction = ""] = value.split(".");
  const cents = Number(whole) * 100 + Number(fraction.padEnd(2, "0"));
  return Number.isSafeInteger(cents) && cents > 0 ? cents : null;
}

export class BillingError extends Error {
  constructor(public readonly code: string, public readonly status: number = 400) { super(code); }
}
