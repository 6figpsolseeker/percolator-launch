/**
 * Pyth push-oracle account for a market's crank tail — the same derivation useTrade uses
 * (`detectOracleMode` === "pyth-pinned" => `derivePythPushOraclePDA(indexFeedId)`), else null.
 */
import type { PublicKey } from "@solana/web3.js";
import { derivePythPushOraclePDA } from "@percolatorct/sdk";
import { detectOracleMode } from "@/lib/oraclePrice";

type OracleCfg = Parameters<typeof detectOracleMode>[0] & { indexFeedId: PublicKey };

export function pythCrankAccount(cfg: OracleCfg | null | undefined, oracleModeByte: number | undefined): PublicKey | null {
  if (!cfg) return null;
  try {
    if (detectOracleMode({ ...cfg, oracleModeByte }) !== "pyth-pinned") return null;
    const feedHex = Array.from(cfg.indexFeedId.toBytes()).map((b) => b.toString(16).padStart(2, "0")).join("");
    return derivePythPushOraclePDA(feedHex)[0];
  } catch {
    // Incomplete config: no oracle tail (the crank then fails cleanly, never a wrong account).
    return null;
  }
}
