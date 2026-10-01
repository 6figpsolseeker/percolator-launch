/**
 * Earn entry/exit pricing during a price catch-up — the ONE place the app ports the wrapper's
 * worse-of rule (percolator-prog ede691b6 "Earn exit/entry priced at the worse of effective vs
 * pending target price"). Every Earn preview goes through `earnSeniorPricing`.
 *
 *  vault_lp_equity_lag_bounds_ro(group, lp) -> (worse, better):
 *    flat LP (empty bitmap)     both = conservative_equity(capital, pnl, fee_credits)
 *    else CURRENT certificate   (stale => 85; the app's preview then values the post-crank state)
 *    per active leg:  q = |basis_pos_q| (raw basis, not ADL-scaled)
 *      long:  adverse = eff - tgt (tgt < eff), favorable = tgt - eff (tgt > eff)
 *      short: the mirror image
 *      atoms = ceil(q * delta / POS_SCALE)   (risk_notional_ceil), per side
 *    worse  = certified_equity - Σ adverse       better = certified_equity + Σ favorable
 *
 *  77 Live:  C' = vault_lp_senior_pricing_claim(C, max(0, -worse), nav - C)
 *               = C - max(0, max(0, -worse) - max(0, nav - C))   (saturating at 0)
 *            v  = worse < 0 ? max(0, nav - |worse|) : nav + min(vault_lp_value_atoms, worse)
 *            senior = tranche_split(v, C').senior = min(v, C')   (security MEDIUM fix: no nav >= C shortcut)
 *  75 Live:  draw outstanding => C_price = C_eff + min(outstanding, max(0, nav + max(better,0) - C_eff))
 *            else unchanged; shares = senior_shares_for_deposit(amount, S, C_price)
 *  Resolved: unchanged.
 *
 * SDK: @percolatorct/sdk 8.0.0 (52b7412) ships the same rule (vaultLpEquityLagBoundsP3,
 * boundVaultSeniorValueP3, boundVaultDepositQuoteP3, readAssetPricesP3). 8.0.0 is not on npm yet
 * (the app pins ^7.0.0), so this port stays until it is; parity with the SDK is pinned by
 * __tests__/fixtures/limits/sdk8-pricing-vectors.json (1,600 cases). Differences by design: the
 * app also checks that the certificate is current (the SDK takes certifiedEquity as given) and
 * reads the leg's side from the leg (the SDK from the basis sign; the engine keeps them equal).
 */
import type { PortfolioLegView } from "./decode";
import { conservativeEquity, vaultLpValueAtoms, type VaultLpValue } from "./vault-tranche";

export const POS_SCALE = 1_000_000n;

export interface LagBoundsLp {
  capital: bigint;
  pnl: bigint;
  feeCredits: bigint;
  activeBitmap: bigint;
  staleState: number;
  bStaleState: number;
  cert: {
    certifiedEquity: bigint;
    oracleEpoch: bigint;
    fundingEpoch: bigint;
    riskEpoch: bigint;
    assetSetEpoch: bigint;
    activeBitmapAtCert: bigint;
    validByte: number;
  };
  legs: readonly PortfolioLegView[];
}

export interface LagBoundsMarket {
  oracleEpoch: bigint;
  fundingEpoch: bigint;
  riskEpoch: bigint;
  assetSetEpoch: bigint;
  /** effective_price / raw_oracle_target_price of the leg's asset (engine AssetStateV16). */
  priceOf: (assetIndex: number) => { eff: bigint; tgt: bigint } | null;
}

/** `risk_notional_ceil`: ceil(q * price / POS_SCALE). */
export function riskNotionalCeil(q: bigint, price: bigint): bigint {
  return (q * price + POS_SCALE - 1n) / POS_SCALE;
}

const sat = (a: bigint, b: bigint) => (a > b ? a - b : 0n);
const max0 = (a: bigint) => (a > 0n ? a : 0n);
const min = (a: bigint, b: bigint) => (a < b ? a : b);

/** Port of `vault_lp_equity_lag_bounds_ro`. "stale" = the program refuses (85). */
export function vaultLpEquityLagBounds(lp: LagBoundsLp, m: LagBoundsMarket): { worse: bigint; better: bigint } | "stale" {
  if (lp.activeBitmap === 0n) {
    const e = conservativeEquity(lp.capital, lp.pnl, lp.feeCredits);
    if (e === null) return "stale";
    return { worse: e, better: e };
  }
  const c = lp.cert;
  const current =
    lp.staleState === 0 &&
    lp.bStaleState === 0 &&
    c.validByte === 1 &&
    c.oracleEpoch === m.oracleEpoch &&
    c.fundingEpoch === m.fundingEpoch &&
    c.riskEpoch === m.riskEpoch &&
    c.assetSetEpoch === m.assetSetEpoch &&
    c.activeBitmapAtCert === lp.activeBitmap;
  if (!current) return "stale";
  let adverse = 0n;
  let favorable = 0n;
  for (const leg of lp.legs) {
    const px = m.priceOf(leg.assetIndex);
    if (!px) return "stale"; // the program: EngineInvalidConfig
    const [adv, fav] = leg.side === 0 ? [sat(px.eff, px.tgt), sat(px.tgt, px.eff)] : [sat(px.tgt, px.eff), sat(px.eff, px.tgt)];
    const q = leg.basisPosQ < 0n ? -leg.basisPosQ : leg.basisPosQ;
    adverse += riskNotionalCeil(q, adv);
    favorable += riskNotionalCeil(q, fav);
  }
  return { worse: c.certifiedEquity - adverse, better: c.certifiedEquity + favorable };
}

/** `vault_lp_senior_pricing_claim(c, undrawn_deficit, junior_surplus)`. */
export function seniorPricingClaim(c: bigint, undrawnDeficit: bigint, juniorSurplus: bigint): bigint {
  return sat(c, sat(undrawnDeficit, juniorSurplus));
}

/**
 * 77 Live: the senior value a redemption is priced at. Security MEDIUM fix (2026-09-30, wrapper
 * after ede691b6): when worse < 0 the pots are valued at v_worse = nav - |worse| (the deficit the
 * pending target would realise), and the senior is ALWAYS tranche_split(v, C').senior — the old
 * "nav >= C => C" shortcut is gone (it priced an exit at nav when nav < C and worse < 0).
 *   C' = worse < 0 ? vault_lp_senior_pricing_claim(C, |worse|, max(0, nav - C)) : C
 *   v  = worse < 0 ? max(0, nav - |worse|) : nav + min(vault_lp_value_atoms, worse)
 *   senior = min(v, C')
 */
export function liveRedeemSeniorValue(i: { c: bigint; nav: bigint; lpValue: bigint; worse: bigint }): bigint {
  const cPrice = i.worse < 0n ? seniorPricingClaim(i.c, -i.worse, sat(i.nav, i.c)) : i.c;
  const v = i.worse < 0n ? sat(i.nav, -i.worse) : i.nav + min(i.lpValue, i.worse);
  return min(v, cPrice);
}

/** 75 Live: the claim a deposit's shares are minted against. */
export function liveDepositClaim(i: { cEff: bigint; nav: bigint; outstanding: bigint; better: bigint }): bigint {
  if (i.outstanding === 0n) return i.cEff;
  return i.cEff + min(i.outstanding, sat(i.nav + max0(i.better), i.cEff));
}

export interface EarnSeniorPricingInput {
  resolved: boolean;
  /** C_eff (C + the senior share of harvestable fees; 78 is bundled before 75/77). */
  cEff: bigint;
  /** Backing NAV incl. harvestable fees (the pots, both domains). */
  nav: bigint;
  outstanding: bigint;
  lp: LagBoundsLp | null;
  market: LagBoundsMarket | null;
  /** The resolved branch's senior value (unchanged pricing), when resolved. */
  resolvedSenior?: bigint | null;
}

export interface EarnSeniorPricing {
  /** Claim deposits are minted against (shares = amount * S / claim). null = unknown/refused. */
  depositClaim: bigint | null;
  /** Senior value redemptions are priced at. null = unknown/refused. */
  withdrawSeniorValue: bigint | null;
}

/**
 * THE Earn preview pricing (one function; mirrors the wrapper's 75/77 exactly). Stale certificate
 * with inventory => null (the app values the post-crank state instead: hooks/useVaultLpValuation).
 */
export function earnSeniorPricing(i: EarnSeniorPricingInput): EarnSeniorPricing {
  if (i.resolved) {
    const v = i.resolvedSenior ?? null;
    return { depositClaim: null, withdrawSeniorValue: v };
  }
  if (!i.lp || !i.market) return { depositClaim: null, withdrawSeniorValue: null };
  const bounds = vaultLpEquityLagBounds(i.lp, i.market);
  if (bounds === "stale") return { depositClaim: null, withdrawSeniorValue: null };
  const value: VaultLpValue = vaultLpValueAtoms(i.lp, i.market);
  if (value.kind === "stale") return { depositClaim: null, withdrawSeniorValue: null };
  return {
    depositClaim: liveDepositClaim({ cEff: i.cEff, nav: i.nav, outstanding: i.outstanding, better: bounds.better }),
    withdrawSeniorValue: liveRedeemSeniorValue({ c: i.cEff, nav: i.nav, lpValue: value.atoms, worse: bounds.worse }),
  };
}
