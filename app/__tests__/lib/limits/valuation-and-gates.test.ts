// @vitest-environment node
/**
 * Follow-up items: vault LP certified-equity valuation, harvestable (pending) LP fees,
 * the Earn deposit gate (mirrors P3 tag 75), the P3-H2 vault-LP cap in max size, the P1
 * e74809b1 close exemption, the same-owner close-only rule, and the P2 fee channel.
 */
import { describe, it, expect } from "vitest";
import {
  earnDepositBlock,
  earnTrancheView,
  harvestableFeeAtoms,
  vaultLpCapQ,
  vaultLpExposureAllowed,
  vaultLpValueAtoms,
} from "@/lib/limits/vault-tranche";
import { maxTradeSizePerSide,
  lpFillGate, sameOwnerRoomQ, type SizeLimitInputs } from "@/lib/limits/risk-limits";
import { deriveTicketLimits } from "@/lib/limits/ticket";
import {
  clampFeeCapMarginBps,
  defaultFeeCapMarginBps,
  feeChannelOf,
  requestedFeeBps,
  requestedFeePermitted,
  signedFeeForQuote,
} from "@/lib/limits/fee-channel";
import { earnViewFromLimits } from "@/lib/limits/earn";
import { marketLimits, vaultBoundLp, OWNER_A, OWNER_LP } from "./fixtures";

const epochs = { oracleEpoch: 900n, fundingEpoch: 900n, riskEpoch: 7n, assetSetEpoch: 1n };
const lp = (over: Partial<Parameters<typeof vaultLpValueAtoms>[0]> = {}) => ({
  capital: 100n,
  pnl: -10n,
  feeCredits: -5n,
  activeBitmap: 1n,
  staleState: 0,
  bStaleState: 0,
  cert: { certifiedEquity: 150n, ...epochs, activeBitmapAtCert: 1n, validByte: 1 },
  ...over,
});

describe("vaultLpValueAtoms (wrapper vault_lp_value_atoms)", () => {
  it("current cert => max(0, certified_equity)", () => {
    expect(vaultLpValueAtoms(lp(), epochs)).toEqual({ kind: "certified", atoms: 150n });
    expect(vaultLpValueAtoms(lp({ cert: { ...lp().cert, certifiedEquity: -3n } }), epochs)).toEqual({ kind: "certified", atoms: 0n });
  });
  it("every currency condition matters: stale flags, valid byte, each epoch, bitmap", () => {
    const cases = [
      lp({ staleState: 1 }),
      lp({ bStaleState: 1 }),
      lp({ cert: { ...lp().cert, validByte: 0 } }),
      lp({ cert: { ...lp().cert, validByte: 2 } }),
      lp({ cert: { ...lp().cert, oracleEpoch: 899n } }),
      lp({ cert: { ...lp().cert, fundingEpoch: 899n } }),
      lp({ cert: { ...lp().cert, riskEpoch: 6n } }),
      lp({ cert: { ...lp().cert, assetSetEpoch: 0n } }),
      lp({ cert: { ...lp().cert, activeBitmapAtCert: 3n } }),
    ];
    for (const c of cases) expect(vaultLpValueAtoms(c, epochs)).toEqual({ kind: "stale" });
  });
  it("not current but flat => conservative equity (no positive pnl credit)", () => {
    expect(vaultLpValueAtoms(lp({ activeBitmap: 0n, staleState: 1 }), epochs)).toEqual({ kind: "flat", atoms: 85n });
    expect(vaultLpValueAtoms(lp({ activeBitmap: 0n, staleState: 1, pnl: 40n }), epochs)).toEqual({ kind: "flat", atoms: 95n });
  });
});

describe("harvestableFeeAtoms (wrapper lp_vault_harvestable_fee_atoms)", () => {
  const e = {
    lpFeeAccruedAtoms: 1_000n,
    lpFeeWithdrawnAtoms: 200n,
    insuranceAtoms: 5_000n,
    sourceInsuranceCreditReservedTotal: 1_000n,
    insuranceDomainBudgetRemainingTotal: 3_500n,
    vaultAtoms: 10_000n,
  };
  it("min(claim, surplus available, vault)", () => {
    expect(harvestableFeeAtoms(e)).toBe(500n); // surplus 5000-1000-3500 = 500 < claim 800
    expect(harvestableFeeAtoms({ ...e, insuranceDomainBudgetRemainingTotal: 0n })).toBe(800n);
    expect(harvestableFeeAtoms({ ...e, insuranceDomainBudgetRemainingTotal: 0n, vaultAtoms: 300n })).toBe(300n);
    expect(harvestableFeeAtoms({ ...e, insuranceAtoms: 10n })).toBe(0n); // saturating subs
  });
  it("withdrawn > accrued => null (the program fails EngineCounterUnderflow)", () => {
    expect(harvestableFeeAtoms({ ...e, lpFeeWithdrawnAtoms: 1_001n })).toBeNull();
  });
});

describe("earnDepositBlock (tag 75 gate)", () => {
  const base = {
    seniorClaimAtoms: 1_000n,
    juniorFloorBps: 1_000,
    seniorFeeShareBps: 10_000,
    backingNavAtoms: 1_000n,
    harvestableAtoms: 0n as bigint | null,
    lpValue: { kind: "certified", atoms: 200n } as const,
    totalShares: 1_000n,
    withdrawShares: 0n,
  };
  it("covered => open", () => {
    expect(earnDepositBlock(earnTrancheView(base), 1_000n)).toBeNull();
  });
  it("impaired (backing short AND V < C_eff) => senior-impaired", () => {
    const v = earnTrancheView({ ...base, backingNavAtoms: 700n, lpValue: { kind: "certified", atoms: 100n } });
    expect(earnDepositBlock(v, 1_000n)).toBe("senior-impaired");
  });
  it("stale LP while backing is short => valuation-stale; stale but backing covers => open", () => {
    expect(earnDepositBlock(earnTrancheView({ ...base, backingNavAtoms: 900n, lpValue: { kind: "stale" } }), 1_000n)).toBe("valuation-stale");
    expect(earnDepositBlock(earnTrancheView({ ...base, lpValue: { kind: "stale" } }), 1_000n)).toBeNull();
  });
  it("genesis with fees pending => harvest-pending (P3-L1)", () => {
    expect(earnDepositBlock(earnTrancheView({ ...base, harvestableAtoms: 5n }), 0n)).toBe("harvest-pending");
    expect(earnDepositBlock(earnTrancheView({ ...base, harvestableAtoms: 0n }), 0n)).toBeNull();
  });
});

describe("earnViewFromLimits (fixture market, certified vault LP + real fee leg)", () => {
  it("uses the cert equity and the harvestable leg from the slab", () => {
    const v = earnViewFromLimits(marketLimits(), 1_000_000_000n, 0n)!;
    expect(v.valuation).toBe("certified");
    // harvestable = min(3e6-1e6, 50e6-0-0, 5e9) = 2e6 ; C_eff = 1e9+2e6 ; V = 1e9 + 2e6 + 120e6
    expect(v.harvestable).toBe(2_000_000n);
    expect(v.seniorClaimEff).toBe(1_002_000_000n);
    expect(v.vaultValue).toBe(1_122_000_000n);
    expect(v.junior).toBe(120_000_000n);
  });
});

describe("P3-H2 vault-LP exposure cap", () => {
  it("vaultLpCapQ is the exact admission boundary of vault_lp_exposure_allowed", () => {
    for (const [eq, lev, price] of [
      [100_000_000n, 10_000, 1_000_000n],
      [123_456_789n, 20_000, 3_333_333n],
      [1n, 10_000, 7n],
      [999n, 50_000, 150_000_000n],
    ] as const) {
      const c = vaultLpCapQ(eq, lev, price);
      expect(vaultLpExposureAllowed(0n, c, eq, lev, price)).toBe(true);
      expect(vaultLpExposureAllowed(0n, c + 1n, eq, lev, price)).toBe(false);
      expect(vaultLpExposureAllowed(0n, -(c + 1n), eq, lev, price)).toBe(false);
    }
  });
  it("binds the ticket when the LP is the bound vault LP (default 1x)", () => {
    const t = deriveTicketLimits({ limits: vaultBoundLp(), direction: "short", sizeQ: 1n, takerPosQ: 0n, takerOwner: OWNER_A, leverage: 1, limitPriceE6: 0n });
    // $100 conservative equity at 1x and $1 => cap 100 units; LP short 400. A taker SHORT (LP
    // buys) is allowed while |LP| does not GROW past max(cap, 400): up to +400, i.e. 800 units
    // (joins_crowd is magnitude growth). P1's own cap (10x => 1000) allows 1400, so P3 binds.
    expect(t.sideLimits!.short).toMatchObject({ maxQ: 800_000_000n, reason: "vault-lp-exposure" });
    // a taker LONG grows the LP's short beyond max(cap, |pos|) = 400 => 0
    expect(t.sideLimits!.long.maxQ).toBe(0n);
  });
  it("not applied when the LP is not the bound vault LP", () => {
    const t = deriveTicketLimits({ limits: marketLimits(), direction: "short", sizeQ: 1n, takerPosQ: 0n, takerOwner: OWNER_A, leverage: 1, limitPriceE6: 0n });
    expect(t.sideLimits!.short.reason).not.toBe("vault-lp-exposure");
  });
});

describe("P1 99165722 (F-7): a taker close may not dump risk into a halted or capped LP", () => {
  const base = (over: Partial<SizeLimitInputs> = {}): SizeLimitInputs => ({
    priceE6: 1_000_000n,
    initialMarginBps: 1_000n,
    oiEffLongQ: 0n,
    oiEffShortQ: 0n,
    limits: { sideOiCapQ: 0n, lpFloorAtoms: 0n, lpExposureKBps: 0 },
    lp: { posQ: -300_000_000n, capital: 0n, pnl: 0n, feeCredits: 0n }, // floored
    takerPosQ: 0n,
    matcher: null,
    ...over,
  });
  it("floored LP short: a taker SHORT closing by BUYING grows the LP (it sells) => refused, halted", () => {
    // e74809b1 allowed this up to |taker| = 50; F-7 (independent test lane) showed it lets two
    // non-LP wallets open bilaterally and then dump one side into the halted LP.
    const m = maxTradeSizePerSide(base({ takerPosQ: -50_000_000n, oiEffLongQ: 300_000_000n, oiEffShortQ: 300_000_000n }));
    expect(m.long).toEqual({ maxQ: 0n, reason: "lp-halt", halted: true });
  });
  it("floored LP short: a taker LONG closing by SELLING reduces the LP (it buys) => passes up to |LP|", () => {
    const m = maxTradeSizePerSide(base({ takerPosQ: 50_000_000n, oiEffLongQ: 300_000_000n, oiEffShortQ: 300_000_000n }));
    expect(m.short.halted).toBe(false);
    expect(m.short.maxQ).toBe(300_000_000n);
  });
  it("lpFillGate ignores the counterparty direction (Rust signature kept, both args unused)", () => {
    // counterparty fully closes (reduce-only), LP grows past its cap / while floored
    expect(lpFillGate(50n, 0n, -300n, -350n, 1_000n, true)).toBe("floor-halt");
    expect(lpFillGate(50n, 0n, -300n, -350n, 320n, false)).toBe("cap-exceeded");
    expect(lpFillGate(50n, 0n, -300n, -250n, 0n, true)).toBe("allow");
  });
  it("a flat taker still cannot open into the halted side", () => {
    const m = maxTradeSizePerSide(base());
    expect(m.long.halted).toBe(true);
  });
});

describe("same-owner close-only (P1 2e7f87de)", () => {
  it("LP owner with a long can sell up to |pos|, cannot buy", () => {
    expect(sameOwnerRoomQ(70n, "short")).toBe(70n);
    expect(sameOwnerRoomQ(70n, "long")).toBe(0n);
    expect(sameOwnerRoomQ(0n, "long")).toBe(0n);
    const L = marketLimits();
    const close = deriveTicketLimits({ limits: L, direction: "short", sizeQ: 10_000_000n, takerPosQ: 70_000_000n, takerOwner: OWNER_LP, leverage: 1, limitPriceE6: 0n });
    expect(close.sameOwner).toBe(false);
    expect(close.sameOwnerCloseOnly).toBe(true);
    expect(close.sideLimits!.short).toMatchObject({ maxQ: 70_000_000n, reason: "same-owner" });
    const open = deriveTicketLimits({ limits: L, direction: "long", sizeQ: 10_000_000n, takerPosQ: 70_000_000n, takerOwner: OWNER_LP, leverage: 1, limitPriceE6: 0n });
    expect(open.sameOwner).toBe(true);
    expect(open.issues.map((x) => x.kind)).toContain("same-owner");
  });
});

describe("P2 fee channel (P1 e74809b1)", () => {
  it("requestedFeeBps = ceil(|exec-oracle|·1e4/oracle), capped 1023", () => {
    expect(requestedFeeBps(1_000_000n, 1_003_100n)).toBe(31n);
    expect(requestedFeeBps(1_000_000n, 1_003_101n)).toBe(32n);
    expect(requestedFeeBps(1_000_000n, 2_000_000n)).toBe(1023n);
    expect(requestedFeeBps(0n, 5n)).toBe(0n);
  });
  it("channel is on only with ext mode 1 AND a non-zero protocol max", () => {
    expect(feeChannelOf({ matcherExtMode: 1, maxRequestedFeeBps: 50 })).toEqual({ enabled: true, protocolMaxBps: 50 });
    expect(feeChannelOf({ matcherExtMode: 0, maxRequestedFeeBps: 50 }).enabled).toBe(false);
    expect(feeChannelOf({ matcherExtMode: 1, maxRequestedFeeBps: 0 }).enabled).toBe(false);
  });
  it("signed fee = base + requested; over the protocol / market max is flagged", () => {
    const ch = { enabled: true, protocolMaxBps: 50 };
    expect(signedFeeForQuote(10n, 1_003_100n, 1_000_000n, ch, 100n)).toEqual({ signedFeeBps: 41n, requestedBps: 31n, marginBps: 0n, verdict: "ok" });
    expect(signedFeeForQuote(10n, 1_006_000n, 1_000_000n, ch, 100n).verdict).toBe("over-protocol-max");
    expect(signedFeeForQuote(80n, 1_003_100n, 1_000_000n, ch, 100n).verdict).toBe("over-market-max");
    expect(signedFeeForQuote(10n, 1_003_100n, 1_000_000n, { enabled: false, protocolMaxBps: 0 }, 100n, undefined, 2)).toEqual({ signedFeeBps: 10n, requestedBps: 0n, marginBps: 0n, verdict: "ok" });
    // legacy kinds: consent to the band-clamped bound, capped at the protocol max (already worst case: no margin)
    expect(signedFeeForQuote(10n, null, 1_000_000n, ch, 100n, 200, 2)).toEqual({ signedFeeBps: 60n, requestedBps: 50n, marginBps: 0n, verdict: "ok" });
  });
  it("fee-cap slippage margin: added on top of the quote, clamped at the market max, verdict judged on the quote", () => {
    const ch = { enabled: true, protocolMaxBps: 50 };
    expect(signedFeeForQuote(10n, 1_003_100n, 1_000_000n, ch, 100n, undefined, 2)).toEqual({ signedFeeBps: 43n, requestedBps: 31n, marginBps: 2n, verdict: "ok" });
    // near the market max: the margin is clamped (never sign above max_trading_fee_bps)
    expect(signedFeeForQuote(10n, 1_003_100n, 1_000_000n, ch, 42n, undefined, 5)).toEqual({ signedFeeBps: 42n, requestedBps: 31n, marginBps: 1n, verdict: "ok" });
    // the margin never turns a refused quote into an accepted one
    expect(signedFeeForQuote(10n, 1_006_000n, 1_000_000n, ch, 100n, undefined, 10).verdict).toBe("over-protocol-max");
    // a quote that moved by <= the margin before landing is still permitted by the signed cap
    const cap = signedFeeForQuote(10n, 1_003_100n, 1_000_000n, ch, 100n, undefined, 2).signedFeeBps;
    expect(requestedFeePermitted(33n, 10n, cap, 50, 100n)).toBe(true);
    expect(requestedFeePermitted(34n, 10n, cap, 50, 100n)).toBe(false);
  });
  it("margin config: env default +2, clamped to [0, 50]", () => {
    expect(defaultFeeCapMarginBps()).toBe(2);
    expect(clampFeeCapMarginBps(-3)).toBe(0);
    expect(clampFeeCapMarginBps(7.9)).toBe(7);
    expect(clampFeeCapMarginBps(99)).toBe(50);
    expect(clampFeeCapMarginBps(Number.NaN)).toBe(2);
  });
  it("ticket: channel on => quote charged, sign base + requested", () => {
    const L = marketLimits({
      matcher: { ...marketLimits().matcher!, inventoryBase: 0n },
      riskLimits: { ...marketLimits().riskLimits!, matcherExtMode: 1, maxRequestedFeeBps: 50 },
      engine: { ...marketLimits().engine!, maxTradingFeeBps: 100n },
    });
    const t = deriveTicketLimits({ limits: L, direction: "long", sizeQ: 100_000_000n, takerPosQ: 0n, takerOwner: OWNER_A, leverage: 1, limitPriceE6: 0n });
    expect(t.fee!.charged).toBe(true);
    expect(t.fee!.requestedBps).toBe(31n); // quote total 31 bps above mark
    expect(t.fee!.signedFeeBps).toBe(43n); // base 10 + 31 + default margin 2
    expect(t.fee!.marginBps).toBe(2n);
    const custom = deriveTicketLimits({ limits: L, direction: "long", sizeQ: 100_000_000n, takerPosQ: 0n, takerOwner: OWNER_A, leverage: 1, limitPriceE6: 0n, feeMarginBps: 0 });
    expect(custom.fee!.signedFeeBps).toBe(41n);
    const off = deriveTicketLimits({ limits: marketLimits({ matcher: { ...marketLimits().matcher!, inventoryBase: 0n } }), direction: "long", sizeQ: 100_000_000n, takerPosQ: 0n, takerOwner: OWNER_A, leverage: 1, limitPriceE6: 0n });
    expect(off.fee!.charged).toBe(false);
    expect(off.fee!.signedFeeBps).toBe(10n);
  });
});

import { tradeFeeBpsToSign } from "@/lib/limits/fee-channel";
import { bindConfirmedLimitPrice } from "@/lib/confirmedTrade";

describe("useTrade signs the ticket's fee-channel consent", () => {
  it("override wins; else the market base fee; else the 30 bps legacy fallback", () => {
    expect(tradeFeeBpsToSign(41n, 10n)).toBe(41n);
    expect(tradeFeeBpsToSign(undefined, 10n)).toBe(10n);
    expect(tradeFeeBpsToSign(undefined, undefined)).toBe(30n);
  });
  it("bindConfirmedLimitPrice keeps feeBps on the submitted params", () => {
    expect(bindConfirmedLimitPrice({ lpIdx: 0, userIdx: 0, size: 5n, feeBps: 41n }, 1_000n)).toEqual({ lpIdx: 0, userIdx: 0, size: 5n, feeBps: 41n, limitPriceE6: 1_000n });
  });
});
