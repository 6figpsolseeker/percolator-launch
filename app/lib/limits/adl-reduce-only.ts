/**
 * F-3 / R1 (ledger f3-market-freeze-triage-2026-09-30.md): after a bankruptcy ADL, the
 * engine keeps an asset REDUCE-ONLY while `a_long != ADL_ONE || a_short != ADL_ONE`
 * (engine 35ddd692 v16.rs:15883 `require_asset_risk_change_allowed` => LockActive = 21 for
 * any risk-increasing leg change). A matcher close by a trader on the SAME side as the LP
 * would grow the LP's leg, so it reverts 21 too — the market looked frozen.
 *
 * The owner-signed unilateral exit is RebalanceReduce (tag 44, deployed wrapper
 * 6377376a `handle_rebalance_reduce` :17853): capacity `min(eff, oi_long, oi_short)`, it ADLs
 * the matching opposite OI; once holders exit the zero-OI reset restores A and the market
 * reopens with no admin step. This module detects the state and builds the exit.
 *
 * Wire (decode arm :6776 / encoder :7511): [44, portfolio_id u64, position_epoch u64,
 * asset_index u16, reduce_q u128] = 35 bytes LE. Accounts (`with_one_portfolio_view`,
 * owner_must_sign = true): [owner (signer), market (w), portfolio (w)].
 * Not flag-gated: this is DEPLOYED v18.2 behaviour.
 */
import { PublicKey, TransactionInstruction } from "@solana/web3.js";
import { ADL_ONE, REBALANCE_REDUCE_DATA_LEN, TAG_REBALANCE_REDUCE } from "./constants";

export function isAdlReduceOnly(v: { aLong: bigint; aShort: bigint } | null | undefined): boolean {
  if (!v) return false;
  return v.aLong !== ADL_ONE || v.aShort !== ADL_ONE;
}

const U64_MAX = (1n << 64n) - 1n;
const U128_MAX = (1n << 128n) - 1n;

export function encodeRebalanceReduceData(portfolioId: bigint, positionEpoch: bigint, assetIndex: number, reduceQ: bigint): Uint8Array {
  if (portfolioId < 0n || portfolioId > U64_MAX) throw new Error("portfolio_id must be a u64");
  if (positionEpoch < 0n || positionEpoch > U64_MAX) throw new Error("position_epoch must be a u64");
  if (!Number.isInteger(assetIndex) || assetIndex < 0 || assetIndex > 0xffff) throw new Error("asset_index must be a u16");
  if (reduceQ <= 0n || reduceQ > U128_MAX) throw new Error("reduce_q must be a positive u128 (0 is refused on-chain)");
  const out = new Uint8Array(REBALANCE_REDUCE_DATA_LEN);
  const dv = new DataView(out.buffer);
  out[0] = TAG_REBALANCE_REDUCE;
  dv.setBigUint64(1, portfolioId, true);
  dv.setBigUint64(9, positionEpoch, true);
  dv.setUint16(17, assetIndex, true);
  dv.setBigUint64(19, reduceQ & U64_MAX, true);
  dv.setBigUint64(27, reduceQ >> 64n, true);
  return out;
}

export function buildRebalanceReduceIx(p: {
  programId: PublicKey;
  owner: PublicKey;
  market: PublicKey;
  portfolio: PublicKey;
  portfolioId: bigint;
  positionEpoch: bigint;
  assetIndex?: number;
  reduceQ: bigint;
}): TransactionInstruction {
  return new TransactionInstruction({
    programId: p.programId,
    keys: [
      { pubkey: p.owner, isSigner: true, isWritable: true },
      { pubkey: p.market, isSigner: false, isWritable: true },
      { pubkey: p.portfolio, isSigner: false, isWritable: true },
    ],
    data: Buffer.from(encodeRebalanceReduceData(p.portfolioId, p.positionEpoch, p.assetIndex ?? 0, p.reduceQ)),
  });
}

/**
 * Close routing (R1): tag 44 when the market is reduce-only; otherwise the normal matcher
 * close, falling back to tag 44 when that close fails Custom(21) and a FRESH read shows the
 * reduce-only state (the first read may have been stale).
 */
export type CloseRoute = "matcher" | "rebalance-reduce";
export function closeRouteFor(reduceOnly: boolean): CloseRoute {
  return reduceOnly ? "rebalance-reduce" : "matcher";
}

/** tag-44 reduce_q for a close of `closePercent` of `|position|` (100% = the whole leg). */
export function rebalanceReduceQ(positionQ: bigint, closePercent: number): bigint {
  const a = positionQ < 0n ? -positionQ : positionQ;
  if (closePercent >= 100) return a;
  return (a * BigInt(Math.max(0, Math.floor(closePercent)))) / 100n;
}
