// @vitest-environment node
/**
 * P1 behaviour: max size per side, clamp, halt, same-owner, side-OI headroom.
 * (The primitive predicates are Rust-parity tested in rust-parity.test.ts.)
 */
import { describe, it, expect } from "vitest";
import { UNLIMITED_CAPACITY } from "@/lib/marketCapacity";
import {
  bandEdgesE6,
  clampSizeQ,
  execPriceWithinBand,
  lpEquityInitRaw,
  lpTradeHeadroomQ,
  maxTradeSizePerSide,
  oiUtilisationBps,
  sameOwnerBlocked,
  sideOiAfterFill,
  sideOiHeadroomQ,
  type SizeLimitInputs,
} from "@/lib/limits/risk-limits";

// $1.00 asset, 10% IMR => default k = 10x equity.
const base = (over: Partial<SizeLimitInputs> = {}): SizeLimitInputs => ({
  priceE6: 1_000_000n,
  initialMarginBps: 1_000n,
  oiEffLongQ: 0n,
  oiEffShortQ: 0n,
  limits: { sideOiCapQ: 0n, lpFloorAtoms: 0n, lpExposureKBps: 0 },
  lp: { posQ: 0n, capital: 100_000_000n, pnl: 0n, feeCredits: 0n }, // $100
  takerPosQ: 0n,
  matcher: null,
  ...over,
});

describe("IM-lane LP equity (account_equity_init_raw)", () => {
  it("gives no credit for positive pnl and subtracts fee debt", () => {
    expect(lpEquityInitRaw(100n, 50n, 0n)).toBe(100n);
    expect(lpEquityInitRaw(100n, -30n, -5n)).toBe(65n);
    expect(lpEquityInitRaw(10n, -30n, 0n)).toBe(-20n);
  });
});

describe("maxTradeSizePerSide", () => {
  it("flat LP with $100 at 10x: 1000 units each way, bound by the LP exposure cap", () => {
    const m = maxTradeSizePerSide(base());
    expect(m.long).toEqual({ maxQ: 1_000_000_000n, reason: "lp-exposure", halted: false });
    expect(m.short).toEqual({ maxQ: 1_000_000_000n, reason: "lp-exposure", halted: false });
  });

  it("LP already short 400 units: takers can buy 600 more but sell 1400 (through flat)", () => {
    const m = maxTradeSizePerSide(base({ lp: { posQ: -400_000_000n, capital: 100_000_000n, pnl: 0n, feeCredits: 0n }, oiEffLongQ: 400_000_000n, oiEffShortQ: 400_000_000n }));
    expect(m.long.maxQ).toBe(600_000_000n);
    expect(m.short.maxQ).toBe(1_400_000_000n);
  });

  it("the tighter of LP cap and matcher per-fill cap binds, with the right reason", () => {
    const m = maxTradeSizePerSide(base({ matcher: { maxFillAbs: 250_000_000n, maxInventoryAbs: 0n, inventoryBase: 0n } }));
    expect(m.long).toMatchObject({ maxQ: 250_000_000n, reason: "matcher-fill" });
  });

  it("matcher inventory headroom binds one side only", () => {
    const m = maxTradeSizePerSide(base({ matcher: { maxFillAbs: 0n, maxInventoryAbs: 300_000_000n, inventoryBase: -200_000_000n } }));
    expect(m.long).toMatchObject({ maxQ: 100_000_000n, reason: "matcher-inventory" });
    expect(m.short).toMatchObject({ maxQ: 500_000_000n, reason: "matcher-inventory" });
  });

  it("protocol side-OI cap binds when tighter than the LP cap", () => {
    const m = maxTradeSizePerSide(base({ limits: { sideOiCapQ: 1_000_000_000n, lpFloorAtoms: 0n, lpExposureKBps: 0 }, oiEffLongQ: 900_000_000n, oiEffShortQ: 900_000_000n }));
    // taker long +x grows long OI by x and (LP flat -> short) short OI by x: min room = 100
    expect(m.long).toMatchObject({ maxQ: 100_000_000n, reason: "side-oi" });
  });

  it("depleted LP (equity <= floor 0): opening is halted on the side that grows its risk, reduce side stays open", () => {
    const lp = { posQ: -300_000_000n, capital: 10_000_000n, pnl: -20_000_000n, feeCredits: 0n };
    const m = maxTradeSizePerSide(base({ lp, oiEffLongQ: 300_000_000n, oiEffShortQ: 300_000_000n }));
    // LP short: a taker LONG grows the LP's short => halted
    expect(m.long).toEqual({ maxQ: 0n, reason: "lp-halt", halted: true });
    // a taker SHORT reduces the LP: allowed up to |LP| (clipped to flatten, P1-K1)
    expect(m.short).toEqual({ maxQ: 300_000_000n, reason: "lp-halt", halted: false });
  });

  it("flat floored LP: both sides halted", () => {
    const m = maxTradeSizePerSide(base({ lp: { posQ: 0n, capital: 0n, pnl: 0n, feeCredits: 0n } }));
    expect(m.long.halted && m.short.halted).toBe(true);
  });

  it("an explicit floor halts an LP that still has equity", () => {
    const m = maxTradeSizePerSide(base({ limits: { sideOiCapQ: 0n, lpFloorAtoms: 100_000_000n, lpExposureKBps: 0 } }));
    expect(m.long.halted).toBe(true);
  });

  it("unknown LP and matcher: no binding limit (the UI then shows none rather than guessing)", () => {
    const m = maxTradeSizePerSide(base({ lp: null }));
    expect(m.long).toEqual({ maxQ: UNLIMITED_CAPACITY, reason: "none", halted: false });
  });

  it("a stored k overrides the default", () => {
    const m = maxTradeSizePerSide(base({ limits: { sideOiCapQ: 0n, lpFloorAtoms: 0n, lpExposureKBps: 20_000 } }));
    expect(m.long.maxQ).toBe(200_000_000n); // 2x of $100 at $1
  });
});

describe("lpTradeHeadroomQ", () => {
  it("floored LP: reducing room is |pos| exactly; growth is 0", () => {
    expect(lpTradeHeadroomQ(500n, "long", 10_000n, true)).toBe(500n); // taker long => LP sells => reduces long LP
    expect(lpTradeHeadroomQ(500n, "short", 10_000n, true)).toBe(0n);
    expect(lpTradeHeadroomQ(0n, "long", 10_000n, true)).toBe(0n);
  });
});

describe("clampSizeQ", () => {
  it("clamps and reports it, never silently", () => {
    const lim = { maxQ: 10n, reason: "lp-exposure" as const, halted: false };
    expect(clampSizeQ(25n, lim)).toEqual({ sizeQ: 10n, clamped: true });
    expect(clampSizeQ(10n, lim)).toEqual({ sizeQ: 10n, clamped: false });
  });
});

describe("side OI after a fill", () => {
  it("counts both legs; a taker closing its short against a long LP shrinks both sides", () => {
    expect(sideOiAfterFill(100n, 100n, -40n, 40n, 40n)).toEqual({ long: 60n, short: 60n });
  });
  it("headroom search is exact at the boundary", () => {
    const h = sideOiHeadroomQ(900n, 900n, 0n, 0n, "long", 1_000n);
    expect(h).toBe(100n);
    const a = sideOiAfterFill(900n, 900n, 0n, 0n, h + 1n);
    expect(a.long).toBe(1_001n);
  });
  it("a side already above a lowered cap can still shrink (growth-only rule)", () => {
    // taker long 50 vs LP short 50, both sides at 2000 > cap 1000. Selling s <= 100 never grows
    // a side (s = 100 flips both legs: OI unchanged); s = 101 grows each side past before and cap.
    expect(sideOiHeadroomQ(2_000n, 2_000n, 50n, -50n, "short", 1_000n)).toBe(100n);
    expect(sideOiAfterFill(2_000n, 2_000n, 50n, -50n, -101n).long).toBe(2_001n);
    // growing from flat is refused outright
    expect(sideOiHeadroomQ(2_000n, 2_000n, 0n, 0n, "long", 1_000n)).toBe(0n);
  });
});

describe("band", () => {
  it("edges are inside the band", () => {
    const { lo, hi } = bandEdgesE6(1_000_001n, 500);
    expect(execPriceWithinBand(lo, 1_000_001n, 500)).toBe(true);
    expect(execPriceWithinBand(hi, 1_000_001n, 500)).toBe(true);
    expect(execPriceWithinBand(hi + 1n, 1_000_001n, 500)).toBe(false);
    expect(execPriceWithinBand(lo - 1n, 1_000_001n, 500)).toBe(false);
  });
});

describe("same-owner rule", () => {
  const a = new Uint8Array(32).fill(1);
  const b = new Uint8Array(32).fill(2);
  const z = new Uint8Array(32);
  it("blocks the LP owner and a non-zero asset_admin; a burned admin never matches", () => {
    expect(sameOwnerBlocked(a, a, null)).toBe(true);
    expect(sameOwnerBlocked(a, b, a)).toBe(true);
    expect(sameOwnerBlocked(a, b, b)).toBe(false);
    expect(sameOwnerBlocked(z, b, z)).toBe(false);
    expect(sameOwnerBlocked(null, a, a)).toBe(false);
  });
});

describe("OI utilisation", () => {
  it("bps of cap", () => {
    expect(oiUtilisationBps(62n, 100n)).toBe(6_200);
    expect(oiUtilisationBps(1n, 0n)).toBe(0);
  });
});
