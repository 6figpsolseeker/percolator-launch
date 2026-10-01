// @vitest-environment node
/**
 * The Earn worse-of pricing (percolator-prog ede691b6) — the ONE app port, lib/limits/earn-pricing.ts.
 *  - Rust parity: `vault_lp_senior_pricing_claim` and `vault_lp_recover` vectors from rustc
 *    (fixture rust-p3-final.json, vault_lp_v18.rs unchanged 4b1a5d30..ede691b6).
 *  - `vault_lp_equity_lag_bounds_ro`: per-leg raw |basis|, ceil per side, flat LP, stale => 85.
 *  - 77 / 75 Live composition exactly as the handler; the end-to-end payout parity against the
 *    ede691b6 BPF is `limits_app_worse_of_77_payout_matches_preview` (scripts/limits-parity/p3-sim).
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  earnSeniorPricing,
  liveDepositClaim,
  liveRedeemSeniorValue,
  riskNotionalCeil,
  seniorPricingClaim,
  vaultLpEquityLagBounds,
  type LagBoundsLp,
  type LagBoundsMarket,
} from "@/lib/limits/earn-pricing";

const FX = JSON.parse(readFileSync(join(process.cwd(), "__tests__/fixtures/limits/rust-p3-final.json"), "utf8")) as {
  pricingClaimVectors: [string, string, string, string][];
  recoverVectors: [string, string, string, string, string, string][];
};

const epochs = { oracleEpoch: 9n, fundingEpoch: 9n, riskEpoch: 3n, assetSetEpoch: 1n };
const market = (eff: bigint, tgt: bigint): LagBoundsMarket => ({ ...epochs, priceOf: (a) => (a === 0 ? { eff, tgt } : null) });
const lp = (o: Partial<LagBoundsLp> = {}): LagBoundsLp => ({
  capital: 100_000_000n,
  pnl: 0n,
  feeCredits: 0n,
  activeBitmap: 1n,
  staleState: 0,
  bStaleState: 0,
  cert: { certifiedEquity: 120_000_000n, oracleEpoch: 9n, fundingEpoch: 9n, riskEpoch: 3n, assetSetEpoch: 1n, activeBitmapAtCert: 1n, validByte: 1 },
  legs: [{ slot: 0, assetIndex: 0, side: 1, basisPosQ: -400_000_000n }], // SHORT 400
  ...o,
});

describe("Rust parity: the pure rules 77 / 75 price through (rustc vectors)", () => {
  it("vault_lp_senior_pricing_claim", () => {
    expect(FX.pricingClaimVectors.length).toBeGreaterThan(5);
    for (const [c, d, s, want] of FX.pricingClaimVectors) expect(seniorPricingClaim(BigInt(c), BigInt(d), BigInt(s)).toString(), `${c},${d},${s}`).toBe(want);
  });
  it("vault_lp_recover (the 75 draw-outstanding term): to_seniors = min(value_above_c, outstanding)", () => {
    expect(FX.recoverVectors.length).toBeGreaterThan(4);
    for (const [c, , outst, above, to, cAfter] of FX.recoverVectors) {
      // liveDepositClaim(cEff, nav, outstanding, better) with nav + better - cEff == above
      const got = liveDepositClaim({ cEff: BigInt(c), nav: BigInt(c) + BigInt(above), outstanding: BigInt(outst), better: 0n });
      expect(got.toString(), `recover ${c}/${outst}/${above}`).toBe(BigInt(outst) === 0n ? c : cAfter);
      expect(BigInt(cAfter) - BigInt(c)).toBe(BigInt(to));
    }
  });
});

describe("vault_lp_equity_lag_bounds_ro", () => {
  it("risk_notional_ceil rounds up (against the user in both directions)", () => {
    expect(riskNotionalCeil(1n, 1n)).toBe(1n);
    expect(riskNotionalCeil(400_000_000n, 100_000n)).toBe(40_000_000n);
    expect(riskNotionalCeil(3n, 333_333n)).toBe(1n);
    expect(riskNotionalCeil(0n, 5n)).toBe(0n);
  });
  it("SHORT 400 with the target $0.10 above eff: adverse 40 USDC, favorable 0", () => {
    expect(vaultLpEquityLagBounds(lp(), market(1_000_000n, 1_100_000n))).toEqual({ worse: 80_000_000n, better: 120_000_000n });
  });
  it("the mirror: target below eff is favorable for a short, adverse for a long", () => {
    expect(vaultLpEquityLagBounds(lp(), market(1_000_000n, 900_000n))).toEqual({ worse: 120_000_000n, better: 160_000_000n });
    const long = lp({ legs: [{ slot: 0, assetIndex: 0, side: 0, basisPosQ: 400_000_000n }] });
    expect(vaultLpEquityLagBounds(long, market(1_000_000n, 900_000n))).toEqual({ worse: 80_000_000n, better: 120_000_000n });
  });
  it("q = |raw basis|; the ceil is per LEG (two legs of 1 unit at a 1-atom move = 2, not ceil(2e-6) = 1)", () => {
    const two = lp({
      activeBitmap: 3n,
      cert: { ...lp().cert, activeBitmapAtCert: 3n },
      legs: [
        { slot: 0, assetIndex: 0, side: 0, basisPosQ: 1n },
        { slot: 1, assetIndex: 0, side: 1, basisPosQ: -1n },
      ],
    });
    // long: adverse eff - tgt = 1; short: favorable eff - tgt = 1 — one atom each side, ceil'd per leg
    expect(vaultLpEquityLagBounds(two, market(1_000_001n, 1_000_000n))).toEqual({ worse: 120_000_000n - 1n, better: 120_000_000n + 1n });
    const both = lp({ activeBitmap: 3n, cert: { ...lp().cert, activeBitmapAtCert: 3n }, legs: [{ slot: 0, assetIndex: 0, side: 0, basisPosQ: 1n }, { slot: 1, assetIndex: 0, side: 0, basisPosQ: 1n }] });
    expect(vaultLpEquityLagBounds(both, market(1_000_001n, 1_000_000n))).toEqual({ worse: 120_000_000n - 2n, better: 120_000_000n });
  });
  it("no catch-up: both bounds = certified equity; a flat LP: both = conservative equity", () => {
    expect(vaultLpEquityLagBounds(lp(), market(1_000_000n, 1_000_000n))).toEqual({ worse: 120_000_000n, better: 120_000_000n });
    const flat = lp({ activeBitmap: 0n, legs: [], pnl: -7n, capital: 100n });
    expect(vaultLpEquityLagBounds(flat, market(1n, 999n))).toEqual({ worse: 93n, better: 93n });
  });
  it("CONTROL: a stale certificate with inventory is refused (85) — the app prices the post-crank state", () => {
    expect(vaultLpEquityLagBounds(lp({ staleState: 1 }), market(1n, 2n))).toBe("stale");
    expect(vaultLpEquityLagBounds(lp({ cert: { ...lp().cert, oracleEpoch: 8n } }), market(1n, 2n))).toBe("stale");
  });
});

describe("77 Live security MEDIUM fix (2026-09-30): worse < 0 and nav < C values the pots at nav - |worse|", () => {
  it("the coordinator's vector: C 1,000,000, nav 800,000, certified e 200,000, adverse d 300,000 -> 700,000", () => {
    const worse = 200_000n - 300_000n; // e - d
    expect(liveRedeemSeniorValue({ c: 1_000_000n, nav: 800_000n, lpValue: 200_000n, worse })).toBe(700_000n);
    // through the bounds too: a short of 300 units facing +$0.001 at certified equity 200,000
    const b = vaultLpEquityLagBounds(lp({ cert: { ...lp().cert, certifiedEquity: 200_000n }, legs: [{ slot: 0, assetIndex: 0, side: 1, basisPosQ: -300_000_000n }] }), market(1_000_000n, 1_001_000n));
    expect(b).toEqual({ worse: -100_000n, better: 200_000n });
    expect(earnSeniorPricing({ resolved: false, cEff: 1_000_000n, nav: 800_000n, outstanding: 0n, lp: lp({ cert: { ...lp().cert, certifiedEquity: 200_000n }, legs: [{ slot: 0, assetIndex: 0, side: 1, basisPosQ: -300_000_000n }] }), market: market(1_000_000n, 1_001_000n) }).withdrawSeniorValue).toBe(700_000n);
  });
  it("NEGATIVE: the old rule (pots at nav when nav < C) would have paid 800,000", () => {
    const old = (c: bigint, nav: bigint, worse: bigint) => {
      const cp = worse < 0n ? seniorPricingClaim(c, -worse, nav > c ? nav - c : 0n) : c;
      return nav >= cp ? cp : nav + 0n < cp ? nav : cp;
    };
    expect(old(1_000_000n, 800_000n, -100_000n)).toBe(800_000n);
    expect(liveRedeemSeniorValue({ c: 1_000_000n, nav: 800_000n, lpValue: 0n, worse: -100_000n })).toBe(700_000n);
  });
  it("unchanged where the fix does not bite: nav >= C, or worse >= 0; never negative", () => {
    expect(liveRedeemSeniorValue({ c: 1_000n, nav: 1_000n, lpValue: 0n, worse: -30n })).toBe(970n);
    expect(liveRedeemSeniorValue({ c: 1_000n, nav: 1_020n, lpValue: 0n, worse: -30n })).toBe(990n);
    expect(liveRedeemSeniorValue({ c: 1_000n, nav: 600n, lpValue: 500n, worse: 300n })).toBe(900n);
    expect(liveRedeemSeniorValue({ c: 1_000n, nav: 50n, lpValue: 0n, worse: -300n })).toBe(0n);
  });
});

describe("77 / 75 Live composition", () => {
  it("77: a move the junior absorbs changes nothing for seniors (worse >= 0)", () => {
    expect(liveRedeemSeniorValue({ c: 1_000n, nav: 1_000n, lpValue: 120n, worse: 80n })).toBe(1_000n);
  });
  it("77: worse < 0 => C_price = C - max(0, -worse - (nav - C)); senior = C_price when nav covers it", () => {
    expect(liveRedeemSeniorValue({ c: 1_000n, nav: 1_000n, lpValue: 0n, worse: -30n })).toBe(970n);
    expect(liveRedeemSeniorValue({ c: 1_000n, nav: 1_020n, lpValue: 0n, worse: -30n })).toBe(990n); // 20 of junior surplus in the pots
  });
  it("77: nav < C_price => the LP counts at min(value, max(worse, 0))", () => {
    expect(liveRedeemSeniorValue({ c: 1_000n, nav: 600n, lpValue: 500n, worse: 300n })).toBe(900n);
    expect(liveRedeemSeniorValue({ c: 1_000n, nav: 600n, lpValue: 200n, worse: 300n })).toBe(800n);
  });
  it("75: unchanged without a draw outstanding; with one, the pending recovery is priced in (capped)", () => {
    expect(liveDepositClaim({ cEff: 1_000n, nav: 900n, outstanding: 0n, better: 500n })).toBe(1_000n);
    expect(liveDepositClaim({ cEff: 1_000n, nav: 900n, outstanding: 100n, better: 150n })).toBe(1_050n);
    expect(liveDepositClaim({ cEff: 1_000n, nav: 900n, outstanding: 100n, better: 500n })).toBe(1_100n);
    expect(liveDepositClaim({ cEff: 1_000n, nav: 900n, outstanding: 100n, better: -5n })).toBe(1_000n);
  });
  it("earnSeniorPricing: stale => no numbers; resolved => unchanged", () => {
    expect(earnSeniorPricing({ resolved: false, cEff: 1n, nav: 1n, outstanding: 0n, lp: lp({ staleState: 1 }), market: market(1n, 2n) })).toEqual({ depositClaim: null, withdrawSeniorValue: null });
    expect(earnSeniorPricing({ resolved: true, cEff: 1n, nav: 1n, outstanding: 0n, lp: null, market: null, resolvedSenior: 7n })).toEqual({ depositClaim: null, withdrawSeniorValue: 7n });
  });
  it("earnSeniorPricing: a SHORT vault LP facing a pending +10% move; exit priced below C, entry unchanged", () => {
    // certified 20 USDC, short 400 => worse = 20 - 40 = -20 USDC; nav == C (pots hold the seniors only)
    const L = lp({ cert: { ...lp().cert, certifiedEquity: 20_000_000n } });
    const r = earnSeniorPricing({ resolved: false, cEff: 1_000_000_000n, nav: 1_000_000_000n, outstanding: 0n, lp: L, market: market(1_000_000n, 1_100_000n) });
    expect(r.withdrawSeniorValue).toBe(980_000_000n);
    expect(r.depositClaim).toBe(1_000_000_000n);
  });
});

/**
 * SDK parity: the app's port against @percolatorct/sdk 8.0.0 (52b7412) — vaultLpEquityLagBoundsP3,
 * boundVaultSeniorValueP3, boundVaultDepositQuoteP3, vaultLpSeniorPricingClaimP3 — on 400 random
 * cases each (fixture sdk8-pricing-vectors.json, generated by scripts/limits-parity/sdk8 from the
 * SDK source verbatim). When 8.0.0 is on npm, earn-pricing.ts re-exports the SDK and these vectors
 * keep holding.
 */
describe("parity with @percolatorct/sdk 8.0.0 (52b7412)", () => {
  const V = JSON.parse(readFileSync(join(process.cwd(), "__tests__/fixtures/limits/sdk8-pricing-vectors.json"), "utf8")) as {
    bounds: { legs: { basisPosQ: string; eff: string; tgt: string }[]; certifiedEquity: string; capital: string; pnl: string; feeCredits: string; worse: string; better: string }[];
    redeem: { c: string; nav: string; lpValue: string; worse: string; senior: string }[];
    deposit: { cEff: string; nav: string; outstanding: string; better: string; claim: string }[];
    claim: { c: string; undrawn: string; surplus: string; out: string }[];
  };
  it("vaultLpEquityLagBoundsP3", () => {
    expect(V.bounds.length).toBe(400);
    let legsSeen = 0;
    for (const b of V.bounds) {
      legsSeen += b.legs.length;
      const legs = b.legs.map((l, i) => ({ slot: i, assetIndex: i, side: BigInt(l.basisPosQ) >= 0n ? 0 : 1, basisPosQ: BigInt(l.basisPosQ) }));
      const prices = b.legs.map((l) => ({ eff: BigInt(l.eff), tgt: BigInt(l.tgt) }));
      const r = vaultLpEquityLagBounds(
        lp({ legs, activeBitmap: legs.length ? 1n : 0n, capital: BigInt(b.capital), pnl: BigInt(b.pnl), feeCredits: BigInt(b.feeCredits), cert: { ...lp().cert, certifiedEquity: BigInt(b.certifiedEquity) } }),
        { ...epochs, priceOf: (a) => prices[a] ?? null },
      );
      expect(r).toEqual({ worse: BigInt(b.worse), better: BigInt(b.better) });
    }
    expect(legsSeen).toBeGreaterThan(300);
  });
  it("boundVaultSeniorValueP3 (77 Live) — outside the region the security fix changed", () => {
    // SDK 52b7412 predates the security MEDIUM fix (worse < 0 and nav < C: pots at nav - |worse|);
    // those vectors are superseded (pinned by the fix vectors below), every other one must hold.
    let held = 0;
    let superseded = 0;
    for (const r of V.redeem) {
      const [c, nav, worse] = [BigInt(r.c), BigInt(r.nav), BigInt(r.worse)];
      if (worse < 0n && nav < c) { superseded++; continue; }
      expect(liveRedeemSeniorValue({ c, nav, lpValue: BigInt(r.lpValue), worse })).toBe(BigInt(r.senior));
      held++;
    }
    expect(held).toBeGreaterThan(200);
    expect(superseded).toBeGreaterThan(20);
  });
  it("boundVaultDepositQuoteP3 cEff (75 Live)", () => {
    expect(V.deposit.length).toBeGreaterThan(300);
    for (const d of V.deposit) expect(liveDepositClaim({ cEff: BigInt(d.cEff), nav: BigInt(d.nav), outstanding: BigInt(d.outstanding), better: BigInt(d.better) })).toBe(BigInt(d.claim));
  });
  it("vaultLpSeniorPricingClaimP3", () => {
    for (const c of V.claim) expect(seniorPricingClaim(BigInt(c.c), BigInt(c.undrawn), BigInt(c.surplus))).toBe(BigInt(c.out));
  });
});
