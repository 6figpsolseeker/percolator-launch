/**
 * The owner-signed unilateral exit as ONE transaction's instruction list (pure; no sendTx, so
 * the #519 LiteSVM harness can execute exactly these app-built instructions via
 * scripts/limits-parity/f3-app-ixs.ts): [PermissionlessCrank(portfolio), RebalanceReduce (tag 44)].
 */
import type { PublicKey } from "@solana/web3.js";
import { buildRebalanceReduceIx } from "./adl-reduce-only";
import { buildVaultLpCrankIx, crankOracleTail } from "./vault-lp-repair";

export function buildRebalanceCloseIxs(p: {
  programId: PublicKey;
  market: PublicKey;
  owner: PublicKey;
  portfolio: PublicKey;
  reduceQ: bigint;
  pythCrankAccount: PublicKey | null;
  assetIndex?: number;
  portfolioId: bigint;
  positionEpoch: bigint;
}) {
  return [
    buildVaultLpCrankIx(p.programId, p.owner, p.market, p.portfolio, crankOracleTail(p.pythCrankAccount), p.assetIndex ?? 0),
    buildRebalanceReduceIx({
      programId: p.programId,
      owner: p.owner,
      market: p.market,
      portfolio: p.portfolio,
      portfolioId: p.portfolioId,
      positionEpoch: p.positionEpoch,
      assetIndex: p.assetIndex ?? 0,
      reduceQ: p.reduceQ,
    }),
  ];
}
