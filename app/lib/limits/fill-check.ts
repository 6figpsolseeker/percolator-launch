/**
 * P1 zero-fill coupling (security review LOW; P0b carry-over #1): after a
 * TradeCpi CONFIRMS, measure the taker's position change instead of assuming
 * the requested size filled. P1 clips an over-headroom request to a partial or
 * ZERO fill that still returns Ok.
 *
 * The post-trade read pins `minContextSlot` to the tx's own slot: the browser
 * /api/rpc proxy caches account data for ~1-1.5 s, so an unpinned read right
 * after confirmation can return the PRE-trade bytes and misreport a real fill
 * as "no fill". A read that cannot be pinned or fails is "unknown" (callers
 * then fall back to the refresh burst, never to the requested size).
 */
import type { Connection, PublicKey } from "@solana/web3.js";
import { signedPositionForAsset } from "./decode";
import { classifyFill, type FillResult } from "./fill-result";

export async function measureFill(
  connection: Connection,
  portfolio: PublicKey,
  sig: string,
  beforeQ: bigint | null,
  requestedQ: bigint,
  marketId: bigint,
  assetIndex = 0,
): Promise<FillResult> {
  if (beforeQ === null) return { kind: "unknown", filledQ: null };
  try {
    const st = await connection.getSignatureStatuses([sig]);
    const slot = st.value[0]?.slot;
    if (slot === undefined || slot === null) return { kind: "unknown", filledQ: null };
    const info = await connection.getAccountInfo(portfolio, { commitment: "confirmed", minContextSlot: slot });
    if (!info) return { kind: "unknown", filledQ: null };
    const afterQ = signedPositionForAsset(new Uint8Array(info.data), assetIndex, marketId);
    return classifyFill(beforeQ, afterQ, requestedQ);
  } catch {
    return { kind: "unknown", filledQ: null };
  }
}

/**
 * sig -> measured fill, so a caller of `useTrade().trade()` (which returns
 * only the signature) can ask how much actually filled. Bounded: oldest
 * entries are dropped past 32.
 */
const results = new Map<string, FillResult>();
export function recordFillResult(sig: string, r: FillResult): void {
  results.set(sig, r);
  while (results.size > 32) {
    const first = results.keys().next().value;
    if (first === undefined) break;
    results.delete(first);
  }
}
export function takeFillResult(sig: string | null | undefined): FillResult | null {
  if (!sig) return null;
  const r = results.get(sig) ?? null;
  results.delete(sig);
  return r;
}
