"use client";

/**
 * UX WP-5 (audit §3.7): the vault LP's value for the Earn card, never "Needs refresh".
 *  - certificate current (or LP flat): the program's own value, no RPC;
 *  - certificate stale: simulate a crank and value the post-state (lib/limits/earn-valuation-sim);
 *    while it runs the last known value shows with an "updating" dot; if it fails, the last known
 *    value shows "as of {time}".
 */
import { useEffect, useRef, useState } from "react";
import { PublicKey } from "@solana/web3.js";
import type { MarketLimits } from "@/hooks/useMarketLimits";
import { useConnectionCompat, useWalletCompat } from "@/hooks/useWalletCompat";
import { useSlabState } from "@/components/providers/SlabProvider";
import { vaultLpValueAtoms, type VaultLpValue } from "@/lib/limits/vault-tranche";
import { connectionValuationDeps, simulateVaultLpValue, VALUATION_CACHE_MS, type SimulatedValue } from "@/lib/limits/earn-valuation-sim";
import { crankOracleTail } from "@/lib/limits/vault-lp-repair";
import { pythCrankAccount } from "@/lib/limits/oracle-tail";

export interface VaultLpValuation {
  value: VaultLpValue | null;
  /** The simulated post-crank state (stale certificate only), for the Earn worse-of pricing. */
  sim: SimulatedValue | null;
  /** A simulation is running; `value` is the last known one. */
  updating: boolean;
  /** Set when the value shown is from an earlier simulation (ms epoch). */
  asOf: number | null;
}

export function useVaultLpValuation(slab: string, limits: MarketLimits): VaultLpValuation {
  const { connection } = useConnectionCompat();
  const { publicKey } = useWalletCompat();
  const slabState = useSlabState();
  const [sim, setSim] = useState<SimulatedValue | null>(null);
  const [updating, setUpdating] = useState(false);
  const [failed, setFailed] = useState(false);
  const inflight = useRef(false);

  const bound = limits.flags.p3 && limits.vaultLp?.bound === true && !!limits.lp && !!limits.engine;
  const direct = bound ? vaultLpValueAtoms(limits.lp!, limits.engine!) : null;
  const stale = direct?.kind === "stale";
  const programId = slabState.programId ?? null;
  const payerKey = publicKey?.toBase58() ?? (limits.vaultState ? new PublicKey(limits.vaultState.juniorOwner).toBase58() : null);
  const vaultLpKey = limits.vaultLp ? new PublicKey(limits.vaultLp.vaultLpPortfolio).toBase58() : null;

  useEffect(() => {
    if (!stale || !programId || !payerKey || !vaultLpKey || inflight.current) return;
    let cancelled = false;
    const run = async () => {
      inflight.current = true;
      setUpdating(true);
      const r = await simulateVaultLpValue(
        {
          programId,
          market: new PublicKey(slab),
          vaultLp: new PublicKey(vaultLpKey),
          payer: new PublicKey(payerKey),
          oracleTail: crankOracleTail(pythCrankAccount(slabState.config, slabState.wrapperConfigV17?.oracleMode)),
        },
        connectionValuationDeps(connection, new PublicKey(payerKey)),
      );
      inflight.current = false;
      if (cancelled) return;
      setUpdating(false);
      if (r) {
        setSim(r);
        setFailed(false);
      } else setFailed(true);
    };
    void run();
    const t = setInterval(() => void run(), VALUATION_CACHE_MS);
    return () => {
      cancelled = true;
      clearInterval(t);
    };
  }, [stale, programId, payerKey, vaultLpKey, slab, connection, slabState.config, slabState.wrapperConfigV17?.oracleMode]);

  if (!bound) return { value: null, sim: null, updating: false, asOf: null };
  if (!stale) return { value: direct, sim: null, updating: false, asOf: null };
  return { value: sim?.value ?? null, sim, updating, asOf: failed && sim ? sim.at : null };
}
