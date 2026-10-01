/**
 * matcher-params.ts — the matcher configuration every NEW market is created with.
 *
 * Ground truth: percolator-match @ 12bd671 (deployed, program
 * DEVNET_PROGRAM_IDS.matcher), src/vamm.rs. The wrapper
 * (percolator-prog @ 6377376a, src/v16_program.rs:13643-13830) relays these
 * fields verbatim into the matcher's tag-2 init and adds lp_account_id itself.
 *
 * WHY kind 1 (vAMM), not kind 0 (Passive)
 * ---------------------------------------
 * vamm.rs:28-31  MatcherKind { Passive = 0, Vamm = 1 }.
 * Kind 0 prices at oracle +/- (base + fee + skew) and never reads
 * impact_k_bps. Kind 1 (compute_vamm_execution, vamm.rs:1050-1130) adds a
 * size-based impact term  impact_bps = fill_notional_e6 * impact_k_bps /
 * liquidity_notional_e6  (clamped so the total never exceeds max_total_bps), so
 * bigger trades cost more. Both kinds apply the skew surcharge and both caps.
 *
 * Kind 1 REQUIRES liquidity_notional_e6 != 0 (MatcherCtx::validate,
 * vamm.rs:269-272) or process_init fails with InvalidAccountData — so the
 * kind-0 shape (liquidityNotionalE6: 0n) cannot simply have its kind flipped.
 *
 * ZERO IS NOT "UNLIMITED" FOR BOTH CAPS — they mean opposite things:
 *   max_fill_abs == 0       -> EVERY fill is clipped to 0 (vamm.rs:1003-1006 /
 *                              1063-1066): the market NEVER trades.
 *   max_inventory_abs == 0  -> "unlimited" (check_inventory_limit early return,
 *                              vamm.rs:1144-1146): the LP is a free, unbounded
 *                              counterparty — the Jimothy drain.
 * So a 0 in either field is a defect; this module never emits one.
 * Both must also be <= i128::MAX (validate, vamm.rs:296-307; process_init
 * clamps u128::MAX down to i128::MAX at :480-481).
 *
 * FORMULAS (all integer, bigint; `lev` = floor(leverage), min 1)
 * --------------------------------------------------------------
 *   capacity        = lpCollateralAtoms * lev              (notional atoms)
 *   maxInventoryAbs = max(1, capacity * 40% * 1e6 / priceE6)   base-unit q
 *   maxFillAbs      = max(1, maxInventoryAbs / 4), and <= maxInventoryAbs
 *   liquidityNotionalE6 = max(1, capacity)
 *   impactKBps      = 200   -> a max-size fill (10% of capacity) pays +20 bps
 *   skewSpreadMultBps = clamp(ceil(100 * 10_000 / maxInventoryAbs), 1, 10_000)
 * both caps clamped to I128_MAX. priceE6 <= 0 falls back to $1.
 *
 * Skew note (vamm.rs:912-942): extra_bps = |inventory_q| * mult / 10_000, capped
 * at 5000 and by max_total_bps. Inventory is in raw base units (1e-6 token), so
 * even mult = 1 saturates the wizard's max_total_bps (200) at ~10% of the
 * inventory cap for typical prices. mult is an integer u16, so 1 is the finest
 * granularity the matcher offers; the ceil() above keeps it from rounding to 0,
 * which would silently DISABLE skew.
 */

/** u128 wire fields must fit i128 (matcher validate). */
export const I128_MAX = (1n << 127n) - 1n;
/** u16 ceiling the matcher accepts for skew_spread_mult_bps (vamm.rs:310). */
export const SKEW_MULT_MAX = 10_000;

/** vamm.rs:28-31 */
export const MATCHER_KIND_VAMM = 1;

export const INVENTORY_CAP_PCT_OF_CAPACITY = 40n;
export const FILL_CAP_DIVISOR = 4n;
/** Impact charged (bps) when a fill consumes 100% of liquidity_notional. */
export const IMPACT_K_BPS = 200;
/** Target skew surcharge (bps) when |inventory| == max_inventory_abs. */
export const SKEW_TARGET_BPS_AT_FULL_INVENTORY = 100n;

/**
 * Skew written into NEW markets' matcher contexts: 0 (disabled). The deployed matcher (EDKK,
 * 4a0f696) has a units bug in the v1 skew term (raw q inventory * mult / 1e4): any
 * inventory-worsening fill saturates to max_total_bps (200 bps), so a market traded only one
 * way quoted the full cap. Until the matcher fix ships, new LPs launch without skew; existing
 * LPs can drop it from the trade page ("Improve pricing", matcher tag 5 SetParams).
 * deriveMatcherLimits still reports the derived value for when skew is re-enabled.
 */
export const WIZARD_SKEW_SPREAD_MULT_BPS = 0;

/** Wizard pricing envelope (unchanged from the kind-0 wizard). */
export const WIZARD_BASE_SPREAD_BPS = 50;
export const WIZARD_MAX_TOTAL_BPS = 200;

export interface MatcherLimits {
  kind: typeof MATCHER_KIND_VAMM;
  maxInventoryAbs: bigint;
  maxFillAbs: bigint;
  liquidityNotionalE6: bigint;
  impactKBps: number;
  skewSpreadMultBps: number;
}

function clampPositive(v: bigint): bigint {
  if (v < 1n) return 1n;
  if (v > I128_MAX) return I128_MAX;
  return v;
}

/** Pure. Never returns 0 for any field, for any input (negatives/zero included). */
export function deriveMatcherLimits(
  leverageX: number,
  lpCollateralAtoms: bigint,
  initialPriceE6: bigint,
): MatcherLimits {
  const levNum = Number.isFinite(leverageX) ? Math.floor(leverageX) : 1;
  const lev = BigInt(Math.max(1, levNum));
  const collateral = lpCollateralAtoms > 0n ? lpCollateralAtoms : 0n;
  const px = initialPriceE6 > 0n ? initialPriceE6 : 1_000_000n;

  const capacity = collateral * lev;
  const inventoryCapAtoms = (capacity * INVENTORY_CAP_PCT_OF_CAPACITY) / 100n;
  const maxInventoryAbs = clampPositive((inventoryCapAtoms * 1_000_000n) / px);
  let maxFillAbs = clampPositive(maxInventoryAbs / FILL_CAP_DIVISOR);
  if (maxFillAbs > maxInventoryAbs) maxFillAbs = maxInventoryAbs;

  const skewRaw =
    (SKEW_TARGET_BPS_AT_FULL_INVENTORY * 10_000n + maxInventoryAbs - 1n) / maxInventoryAbs;
  const skewSpreadMultBps = Number(
    skewRaw < 1n ? 1n : skewRaw > BigInt(SKEW_MULT_MAX) ? BigInt(SKEW_MULT_MAX) : skewRaw,
  );

  return {
    kind: MATCHER_KIND_VAMM,
    maxInventoryAbs,
    maxFillAbs,
    liquidityNotionalE6: clampPositive(capacity),
    impactKBps: IMPACT_K_BPS,
    skewSpreadMultBps,
  };
}

/** Exactly the argument shape of the SDK's encodeInitMatcherCtx. */
export interface InitMatcherCtxArgs {
  kind: number;
  tradingFeeBps: number;
  baseSpreadBps: number;
  maxTotalBps: number;
  impactKBps: number;
  liquidityNotionalE6: bigint;
  maxFillAbs: bigint;
  maxInventoryAbs: bigint;
  feeToInsuranceBps: number;
  skewSpreadMultBps: number;
}

/**
 * Single source for every create path (wizard merged + sequential, mobile).
 * `limits` comes from deriveMarketParams(...).matcher so the leverage clamp is
 * applied once, in one place.
 */
export function buildInitMatcherCtxArgs(
  tradingFeeBps: number,
  limits: MatcherLimits,
): InitMatcherCtxArgs {
  return {
    kind: limits.kind,
    tradingFeeBps,
    baseSpreadBps: WIZARD_BASE_SPREAD_BPS,
    maxTotalBps: WIZARD_MAX_TOTAL_BPS,
    impactKBps: limits.impactKBps,
    liquidityNotionalE6: limits.liquidityNotionalE6,
    maxFillAbs: limits.maxFillAbs,
    maxInventoryAbs: limits.maxInventoryAbs,
    feeToInsuranceBps: 0,
    skewSpreadMultBps: WIZARD_SKEW_SPREAD_MULT_BPS,
  };
}
