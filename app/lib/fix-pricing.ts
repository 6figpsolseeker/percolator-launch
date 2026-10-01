/**
 * "Improve pricing" for an existing market's creator (2026-10-01).
 *
 * The deployed matcher (EDKK 4a0f696) has a units bug in its v1 skew term: any
 * inventory-worsening fill saturates to max_total_bps, so a market that is traded one way quotes
 * the full 200 bps cap. New markets launch with skew 0 (lib/matcher-params.ts); existing ones can
 * drop it with matcher tag 5 Configure, auth mode 1 (owner proof: the LP OWNER signs), op 1
 * SetParams, restating every current parameter with only skew_spread_mult_bps = 0. SetParams
 * preserves inventory, insurance accrual, lp_pda, lp_account_id, backing fee cap and the asset
 * binding (vamm.rs process_configure). Verified by simulation as the creator on both live LPs.
 *
 * Offered only for v1 contexts (no v2 block): restating a v2 config from its decoded STATE is not
 * exact (e.g. warmup-left vs the configured warmup), so a v2 context is never rewritten here.
 */
import type { PublicKey, TransactionInstruction } from "@solana/web3.js";
import { buildMatcherConfigureSetParamsIx, zeroMatcherV2Config, type MatcherSetParams } from "@percolatorct/sdk";
import type { MatcherCtxView } from "@/lib/limits/decode";

/**
 * What the action is, in plain words. `what` is rendered per market by `fixPricingWhat` (the
 * overcharge figure comes from the market's own matcher config); `signature` says what the wallet
 * prompt is: a settings update, no funds.
 */
export const FIX_PRICING_COPY = {
  title: "Improve pricing for traders",
  signature: "Approving updates your market's pricing settings (matcher config); no funds move.",
  button: "Improve pricing",
  done: "Pricing updated",
  doneBody: "Fills are now priced at base spread plus impact. No funds moved.",
} as const;

/**
 * The most the skew surcharge can add to one fill, in bps. The matcher quotes
 * min(max_total, base + fee + skew + impact) (vamm.rs compute_vamm_execution), and the units bug
 * saturates skew, so a one-way market quoted max_total where base + fee + impact was due: the
 * surcharge is at most max_total - base - fee. For the wizard envelope (base 50, max_total 200,
 * fee 5-20) that is 125-145 bps, a quote of up to 2.00% in total. NOT "2% extra".
 */
export function skewOverchargeBps(ctx: Pick<MatcherCtxView, "maxTotalBps" | "baseSpreadBps" | "tradingFeeBps">): number {
  return Math.max(0, ctx.maxTotalBps - ctx.baseSpreadBps - ctx.tradingFeeBps);
}

/** bps -> "1.45%" style, trailing zeros trimmed ("1.5%", "2%"). */
function pctFromBps(bps: number): string {
  return `${Number((bps / 100).toFixed(2))}%`;
}

/** One line: what it changes, with this market's real number. */
export function fixPricingWhat(ctx: MatcherCtxView | null): string {
  const over = ctx ? skewOverchargeBps(ctx) : 0;
  const upTo = over > 0 ? ` by up to ~${pctFromBps(over)}` : "";
  return `Turns off your matcher's inventory-skew surcharge, which overcharged traders${upTo} per fill because of a units bug, so fills are priced at base spread plus impact.`;
}

/** The LP owner may fix it: a v1 context whose skew is on. */
export function fixPricingEligible(ctx: MatcherCtxView | null, wallet: PublicKey | null, lpOwner: PublicKey | null): boolean {
  if (!ctx || !wallet || !lpOwner) return false;
  if (ctx.v2 !== null) return false;
  if (ctx.kind !== 0 && ctx.kind !== 1) return false;
  return ctx.skewSpreadMultBps > 0 && wallet.equals(lpOwner);
}

/** Every current parameter restated, skew off. */
export function skewOffSetParams(ctx: MatcherCtxView): MatcherSetParams {
  return {
    kind: ctx.kind as MatcherSetParams["kind"],
    tradingFeeBps: ctx.tradingFeeBps,
    baseSpreadBps: ctx.baseSpreadBps,
    maxTotalBps: ctx.maxTotalBps,
    impactKBps: ctx.impactKBps,
    liquidityNotionalE6: ctx.liquidityNotionalE6,
    maxFillAbs: ctx.maxFillAbs,
    maxInventoryAbs: ctx.maxInventoryAbs,
    feeToInsuranceBps: ctx.feeToInsuranceBps,
    skewSpreadMultBps: 0,
    enableV2: false,
    v2: zeroMatcherV2Config(),
  };
}

export function buildFixPricingIx(a: {
  wrapperProgramId: PublicKey;
  matcherProgramId: PublicKey;
  market: PublicKey;
  lpPortfolio: PublicKey;
  lpOwner: PublicKey;
  matcherCtx: PublicKey;
  ctx: MatcherCtxView;
}): TransactionInstruction {
  return buildMatcherConfigureSetParamsIx(
    {
      wrapperProgramId: a.wrapperProgramId,
      matcherProgramId: a.matcherProgramId,
      market: a.market,
      lpPortfolio: a.lpPortfolio,
      lpOwner: a.lpOwner,
      matcherCtx: a.matcherCtx,
    },
    skewOffSetParams(a.ctx),
  );
}
