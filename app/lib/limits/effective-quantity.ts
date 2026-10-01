/**
 * M-3 (code-review-live-paths-2026-10-01): the quantity a trade or close acts on
 * is the leg's ADL-EFFECTIVE quantity, not its raw `basis_pos_q`.
 *
 * Engine 35ddd692 (src/v16.rs):
 *   - `kernel_adl_effective_quantity_ceil` (:1677): `ceil(raw_abs * current_a / a_basis)`,
 *     InvalidLeg unless raw_abs ≤ MAX_POSITION_ABS_Q, a_basis ∈ [MIN_A_SIDE, ADL_ONE]
 *     and current_a ∈ [1, a_basis].
 *   - `effective_abs_quantity_for_leg` (:1695): a current-epoch leg scales by the side's
 *     `a`; a prior-reset obligation (side mode ResetPending and epoch_snap + 1 == epoch,
 *     `kernel_is_prior_reset_obligation` :1341) owns 0; any other epoch is InvalidLeg.
 *   - `plan_delta` (:6075) applies a trade's `size_q` to the EFFECTIVE position
 *     (`next_effective = current_effective + delta`), so a close sized from raw basis
 *     after an ADL (effective < basis) over-closes and flips into the opposite side.
 */
import { ADL_ONE } from "./constants";

/** engine lib.rs:17 / :28 */
export const MIN_A_SIDE = 100_000_000_000_000n;
export const MAX_POSITION_ABS_Q = 100_000_000_000_000n;
/** SideModeV16 encoding (v16.rs encode_side_mode). */
export const SIDE_MODE_RESET_PENDING = 2;

export interface EffectiveAssetSides {
  aLong: bigint;
  aShort: bigint;
  epochLong: bigint;
  epochShort: bigint;
  modeLong: number;
  modeShort: number;
}

export interface EffectiveLegInput {
  active: boolean;
  /** 0 Long, 1 Short (engine encode_side). */
  side: number;
  basisPosQ: bigint;
  aBasis: bigint;
  epochSnap: bigint;
}

export type EffectiveLeg =
  /** Current-epoch leg: |effective| and the signed effective position (+ long / − short). */
  | { kind: "live"; absQ: bigint; signedQ: bigint }
  /** Prior-reset obligation: owns no OI; a refresh of the portfolio clears it. */
  | { kind: "reset"; absQ: 0n; signedQ: 0n }
  /** The engine would refuse this leg (InvalidLeg): never size a trade from it. */
  | { kind: "invalid" };

/** Port of `kernel_adl_effective_quantity_ceil`. `null` = the engine's InvalidLeg. */
export function adlEffectiveQuantityCeil(rawAbsQ: bigint, aBasis: bigint, currentA: bigint): bigint | null {
  if (rawAbsQ < 0n || rawAbsQ > MAX_POSITION_ABS_Q) return null;
  if (aBasis < MIN_A_SIDE || aBasis > ADL_ONE) return null;
  if (currentA < 1n || currentA > aBasis) return null;
  const num = rawAbsQ * currentA;
  return (num + aBasis - 1n) / aBasis;
}

/** Port of `effective_abs_quantity_for_leg`, re-signed by the leg's side. */
export function effectiveLeg(asset: EffectiveAssetSides, leg: EffectiveLegInput): EffectiveLeg {
  if (!leg.active) return { kind: "invalid" };
  const long = leg.side === 0;
  const currentA = long ? asset.aLong : asset.aShort;
  const epoch = long ? asset.epochLong : asset.epochShort;
  const mode = long ? asset.modeLong : asset.modeShort;
  if (leg.epochSnap === epoch) {
    const raw = leg.basisPosQ < 0n ? -leg.basisPosQ : leg.basisPosQ;
    const abs = adlEffectiveQuantityCeil(raw, leg.aBasis, currentA);
    if (abs === null) return { kind: "invalid" };
    return { kind: "live", absQ: abs, signedQ: long ? abs : -abs };
  }
  if (mode === SIDE_MODE_RESET_PENDING && leg.epochSnap + 1n === epoch) {
    return { kind: "reset", absQ: 0n, signedQ: 0n };
  }
  return { kind: "invalid" };
}
