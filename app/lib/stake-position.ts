/**
 * Valuing a wallet's STAKE (insurance pool) position from FRESH on-chain numbers.
 *
 * Live report 2026-10-01 (wallet 9sM73A..., pool 8WC8vALs...): right after a 400 USDC stake the
 * "Your Deposits" hero stayed "$—" and the pool row's "Your Stake" flipped from "—" to "$0.00",
 * while the LP balance itself (read from the wallet's LP ATA) was right. Cause: the position was
 * valued as `(lp / pool.totalLpSupply) * pool.tvl` using the pool numbers from GET /api/stake/pools,
 * which is CDN-cached (s-maxage=30, stale-while-revalidate=60). Staking into a freshly seeded pool
 * is the one case where the cached snapshot predates the deposit (supply 0, tvl 0), so the value
 * collapsed to 0 even though the LP balance was real. The pool account (total LP supply) and the
 * vault token account (collateral held) are read on-chain in the same pass as the LP balance, so
 * the value is consistent with it; the API snapshot is only a fallback if the chain read fails.
 */

/** Stake pools hold USDC-style 6-decimal collateral (same convention as /api/stake/pools `tvl`). */
export const STAKE_COLLATERAL_DECIMALS = 6;

/** StakePool.total_lp_supply: u64 LE at offset 176 (identical across the 352/392/408-byte layouts). */
const POOL_TOTAL_LP_SUPPLY_OFFSET = 176;

export function readPoolTotalLpSupply(poolData: Uint8Array): bigint | null {
  if (poolData.length < POOL_TOTAL_LP_SUPPLY_OFFSET + 8) return null;
  const view = new DataView(poolData.buffer, poolData.byteOffset, poolData.byteLength);
  return view.getBigUint64(POOL_TOTAL_LP_SUPPLY_OFFSET, true);
}

/** floor(lp * vault / supply) in collateral atoms; null when there is no supply to value against. */
export function stakeValueAtoms(lpRaw: bigint, totalLpSupplyRaw: bigint, vaultAtoms: bigint): bigint | null {
  if (totalLpSupplyRaw <= 0n) return null;
  return (lpRaw * vaultAtoms) / totalLpSupplyRaw;
}

export interface StakeValuationInput {
  lpRaw: bigint;
  /** Fresh on-chain reads; null when that account could not be read. */
  chainTotalLpSupplyRaw: bigint | null;
  chainVaultAtoms: bigint | null;
  /** Cached /api/stake/pools snapshot, used only when the chain read is unavailable. */
  apiTotalLpSupply: number;
  apiTvlUsd: number;
  lpDecimals: number;
}

/** USD value of the position: fresh chain numbers first, API snapshot as the fallback. */
export function valueStakePosition(i: StakeValuationInput): number {
  if (i.chainTotalLpSupplyRaw !== null && i.chainVaultAtoms !== null) {
    const atoms = stakeValueAtoms(i.lpRaw, i.chainTotalLpSupplyRaw, i.chainVaultAtoms);
    if (atoms !== null) return Number(atoms) / 10 ** STAKE_COLLATERAL_DECIMALS;
  }
  const lpHuman = Number(i.lpRaw) / 10 ** i.lpDecimals;
  const supplyHuman = i.apiTotalLpSupply / 10 ** i.lpDecimals;
  return supplyHuman > 0 ? (lpHuman / supplyHuman) * i.apiTvlUsd : 0;
}
