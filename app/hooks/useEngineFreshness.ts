"use client";

import { useSlabState } from "@/components/providers/SlabProvider";
import { useClusterSlot } from "@/hooks/useClusterSlot";
import { readV17AssetSlotLast, readV17MaxAccrualDtSlots } from "@/lib/v17-engine-clock";
import { CATCH_UP_CRANK_CU, CATCH_UP_TOTAL_CU } from "@/lib/self-heal";

/**
 * H6 (2026-07-08): ENGINE accrual staleness ("Crank behind") — distinct from
 * `useOracleFreshness`, which tracks the KEEPER'S PRICE PUSH cadence.
 *
 * What actually breaks trading when the crank stops is the engine's accrual
 * clock, `AssetStateV16Account.slot_last` (see lib/v17-engine-clock.ts §2):
 * it advances only when a crank/trade ACCRUES the market, one accrual covers at
 * most `max_accrual_dt_slots` (500 on every live market), and trade / close /
 * withdraw paths reject an asset whose `slot_last` lags (EngineStale(19) /
 * EngineLockActive(21)). A market can show a live, ticking, freshly-pushed
 * price and still be accrual-dead — that is the divergence this hook exists to
 * catch (DEFINITIVE-PLAN-2026-07-08.md §H6, and tonight's clock freeze).
 *
 * This hook used to measure `lastGoodOracleSlot` on the belief that it
 * advances "only via crank". It does not: in AUTH_MARK (every live market)
 * only `PushAuthMark` advances it, on every push, and no crank path touches it
 * for that mode. So it tracked the keeper's push loop, not the crank — a dead
 * crank under a live keeper read healthy, and the ~500-slot threshold it
 * borrowed belongs to `max_accrual_dt_slots`, i.e. to `slot_last`. Push age is
 * now owned by `useOracleFreshness`.
 */

/**
 * UX WP-2 (SH-2/SH-3): a lag the app can repair itself is NOT a block. sendTx's self-heal
 * prepends up to `catchUpCranks` catch-up cranks (lib/self-heal.ts planCatchUp) after a
 * simulated 19/21, so the ticket blocks only when the lag exceeds what those cranks cover:
 * the keeper must catch up, and the UI shows a calm "catching up" state that clears itself.
 * Budget: a trade-sized tx (400k CU) + k cranks of CATCH_UP_CRANK_CU within CATCH_UP_TOTAL_CU.
 */
const TRADE_CU_FOR_CATCH_UP = 400_000;
/** Used only if the market's max_accrual_dt_slots is unreadable (live value is 500). */
const FALLBACK_DT_SLOTS = 500n;

export interface EngineFreshnessState {
  /** True once the engine clock lags further than the app's own catch-up cranks can repair (SH-3: the keeper must catch up). */
  engineStale: boolean;
  /** currentSlot - engineSlotLast, or null until both are known. */
  slotLag: bigint | null;
  /** Live cluster slot, polled every ~10s (not the reactive slab-poll slot). */
  currentSlot: bigint | null;
  /** The asset-0 engine accrual clock (`AssetStateV16Account.slot_last`), or null if not yet loaded / never accrued. */
  engineSlotLast: bigint | null;
  /** Slot lag above which `engineStale` is true. */
  staleSlotLag: bigint;
}

export function engineStaleSlotLag(maxAccrualDtSlots: bigint | null): bigint {
  const dt = maxAccrualDtSlots ?? FALLBACK_DT_SLOTS;
  const kMax = BigInt(Math.max(1, Math.floor((CATCH_UP_TOTAL_CU - TRADE_CU_FOR_CATCH_UP) / CATCH_UP_CRANK_CU)));
  return dt * kMax;
}

/**
 * Uses the app-wide refcounted cluster-slot ticker shared with
 * useOracleFreshness, avoiding duplicate getSlot() polling.
 */
export function useEngineFreshness(): EngineFreshnessState {
  const { raw, wrapperConfigV17 } = useSlabState();
  const currentSlot = useClusterSlot();

  // v17/v18 only (the legacy v12 path has its own engine block). A slot_last
  // of 0 means "never accrued yet" (e.g. a market mid-creation) — treat as
  // unknown rather than infinitely stale so a brand-new market doesn't
  // immediately trip the guard before its first crank lands.
  const isV17 = wrapperConfigV17 != null && raw != null;
  const engineSlotLast = isV17 ? readV17AssetSlotLast(raw) : null;
  const staleSlotLag = engineStaleSlotLag(isV17 ? readV17MaxAccrualDtSlots(raw) : null);

  const slotLag = currentSlot !== null && engineSlotLast !== null
    ? currentSlot - engineSlotLast
    : null;

  const engineStale = slotLag !== null && slotLag > staleSlotLag;

  return { engineStale, slotLag, currentSlot, engineSlotLast, staleSlotLag };
}
