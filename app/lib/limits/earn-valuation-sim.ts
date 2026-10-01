/**
 * UX WP-5 (audit §3.7, EA-4): value the Earn vault's LP WITHOUT "Needs refresh". When the vault
 * LP's health certificate is stale, simulate `[PermissionlessCrank(vault LP)]` with the post-state
 * of the vault LP and the market returned, and value it with the same `vault_lp_value_atoms` port
 * the program uses. No signature, nothing sent. Cached per market for one crank cycle (~20 s).
 */
import {
  PublicKey,
  Transaction,
  VersionedTransaction,
  type AccountMeta,
  type Connection,
  type TransactionInstruction,
} from "@solana/web3.js";
import { decodeMarketEngineView, decodePortfolioLegs, decodePortfolioRisk } from "./decode";
import type { LagBoundsLp, LagBoundsMarket } from "./earn-pricing";
import { vaultLpValueAtoms, type VaultLpValue } from "./vault-tranche";
import { buildVaultLpCrankIx } from "./vault-lp-repair";

export const VALUATION_CACHE_MS = 20_000;

/** The value the program would compute from these (post-crank) account images. */
export function lpValueFromAccounts(portfolio: Uint8Array | null, market: Uint8Array | null, assetIndex = 0): VaultLpValue | null {
  if (!portfolio || !market) return null;
  const risk = decodePortfolioRisk(portfolio);
  const eng = decodeMarketEngineView(market, assetIndex);
  if (!risk || !eng) return null;
  return vaultLpValueAtoms(risk, eng);
}

export interface ValuationSimDeps {
  /** Simulate; return the post-state data of `addresses` (null when missing) or the error. */
  simulate: (instructions: TransactionInstruction[], addresses: PublicKey[]) => Promise<{ err: unknown; accounts: (Uint8Array | null)[] }>;
  now?: () => number;
}

export interface ValuationSimParams {
  programId: PublicKey;
  market: PublicKey;
  vaultLp: PublicKey;
  /** Any funded account: the connected wallet, else the vault's creator (junior owner). */
  payer: PublicKey;
  oracleTail?: readonly AccountMeta[];
  assetIndex?: number;
}

export interface SimulatedValue {
  value: VaultLpValue;
  /** ms epoch of the simulation. */
  at: number;
  /** The post-crank vault LP and market (the worse-of bounds price THIS state, like the tx will). */
  lp?: LagBoundsLp;
  market?: LagBoundsMarket;
}

/** The post-crank images as the lag-bounds inputs (earn-pricing.ts). */
export function boundsInputsFromAccounts(portfolio: Uint8Array, market: Uint8Array): { lp: LagBoundsLp; market: LagBoundsMarket } | null {
  const risk = decodePortfolioRisk(portfolio);
  const e = decodeMarketEngineView(market, 0);
  if (!risk || !e) return null;
  return {
    lp: { ...risk, legs: decodePortfolioLegs(portfolio) },
    market: {
      oracleEpoch: e.oracleEpoch,
      fundingEpoch: e.fundingEpoch,
      riskEpoch: e.riskEpoch,
      assetSetEpoch: e.assetSetEpoch,
      priceOf: (a) => {
        const x = a === 0 ? e : decodeMarketEngineView(market, a);
        return x ? { eff: x.effectivePriceE6, tgt: x.targetPriceE6 } : null;
      },
    },
  };
}

const cache = new Map<string, SimulatedValue>();

/** Test hook. */
export function __clearValuationCache(): void {
  cache.clear();
}

/**
 * The certified value after a crank, by simulation. Returns null when the simulation fails
 * (the caller keeps the last known value, labelled "as of {time}"). Never throws.
 */
export async function simulateVaultLpValue(p: ValuationSimParams, deps: ValuationSimDeps): Promise<SimulatedValue | null> {
  const now = deps.now ?? Date.now;
  const key = `${p.market.toBase58()}:${p.assetIndex ?? 0}`;
  const hit = cache.get(key);
  if (hit && now() - hit.at < VALUATION_CACHE_MS) return hit;
  try {
    const crank = buildVaultLpCrankIx(p.programId, p.payer, p.market, p.vaultLp, p.oracleTail ?? [], p.assetIndex ?? 0);
    const r = await deps.simulate([crank], [p.vaultLp, p.market]);
    if (r.err) return null;
    const pf = r.accounts[0] ?? null;
    const mk = r.accounts[1] ?? null;
    const v = lpValueFromAccounts(pf, mk, p.assetIndex ?? 0);
    if (!v || v.kind === "stale") return null;
    const b = pf && mk ? boundsInputsFromAccounts(pf, mk) : null;
    const out: SimulatedValue = { value: v, at: now(), ...(b ?? {}) };
    cache.set(key, out);
    return out;
  } catch {
    return null;
  }
}

export function connectionValuationDeps(connection: Connection, payer: PublicKey): ValuationSimDeps {
  return {
    simulate: async (instructions, addresses) => {
      const tx = new Transaction();
      for (const ix of instructions) tx.add(ix);
      tx.feePayer = payer;
      tx.recentBlockhash = PublicKey.default.toBase58();
      const sim = await connection.simulateTransaction(new VersionedTransaction(tx.compileMessage()), {
        replaceRecentBlockhash: true,
        sigVerify: false,
        commitment: "confirmed",
        accounts: { addresses: addresses.map((a) => a.toBase58()), encoding: "base64" },
      });
      const accounts = (sim.value.accounts ?? []).map((a) =>
        a && Array.isArray(a.data) ? new Uint8Array(Buffer.from(a.data[0] as string, "base64")) : null,
      );
      return { err: sim.value.err, accounts };
    },
  };
}
