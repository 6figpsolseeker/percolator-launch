/**
 * SOL/USD for the price feed's WSOL-quoted pools (scripts/local-price-ws-server.ts), no Pyth:
 * Jupiter's value while it is fresh, else one DEX read of the SOL/USDC pool. Pure (the reads are
 * injected) so the fallback order is testable.
 */
export async function pickSolUsdE6(p: {
  jupiter: { e6: bigint; at: number } | null;
  now: number;
  maxAgeMs: number;
  dexRead: () => Promise<bigint | undefined>;
}): Promise<bigint | undefined> {
  if (p.jupiter && p.jupiter.e6 > 0n && p.now - p.jupiter.at <= p.maxAgeMs) return p.jupiter.e6;
  return p.dexRead();
}
