import { UNLIMITED_CAPACITY } from "@/lib/marketCapacity";

/** base q -> "12.4" (token units, POS_SCALE 1e6), up to 4 dp, trimmed; ∞ for the unlimited sentinel. */
export function fmtQ(q: bigint): string {
  if (q === UNLIMITED_CAPACITY) return "∞";
  const neg = q < 0n;
  const a = neg ? -q : q;
  const whole = a / 1_000_000n;
  const frac = (a % 1_000_000n).toString().padStart(6, "0").slice(0, 4).replace(/0+$/, "");
  return `${neg ? "−" : ""}${whole.toLocaleString()}${frac ? `.${frac}` : ""}`;
}

/**
 * E2E B5: the trading fee a trade is actually CHARGED is the wrapper's `trade_fee_base_bps`
 * (fills settle at mark, so the matcher's `tradingFeeBps` is not charged). null = unreadable.
 */
export function chargedTradeFeeLabel(tradeFeeBaseBps: bigint | null | undefined): string | null {
  if (tradeFeeBaseBps === null || tradeFeeBaseBps === undefined || tradeFeeBaseBps < 0n) return null;
  const whole = tradeFeeBaseBps / 100n;
  const frac = (tradeFeeBaseBps % 100n).toString().padStart(2, "0");
  return `${whole}.${frac}%`;
}
