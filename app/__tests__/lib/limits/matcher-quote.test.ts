// @vitest-environment node
/** P2 pre-trade quote behaviour (the primitives are Rust-parity tested separately). */
import { describe, it, expect } from "vitest";
import {
  inventoryClip,
  preTradeQuote,
  quoteFailsLimit,
  skewIndicatorBps,
  adaptiveFeeBps,
} from "@/lib/limits/matcher-quote";
import type { MatcherCtxView, V2BlockView } from "@/lib/limits/decode";

const v2: V2BlockView = {
  flags: 1,
  feeLoBps: 10,
  feeHiBps: 80,
  feeColdBps: 10,
  volAMilli: 1000,
  volBDen: 100,
  volAlphaBps: 1000,
  volWarmupLeft: 0,
  volMoveCap10bps: 100,
  volRefSlots: 25,
  thinRebateMultBps: 100,
  skewCapBps: 100,
  rebateCapBps: 50,
  maxMarkAgeSlots: 150,
  observedStaleSlots: 0,
  boundAssetPlus1: 1,
  skewRefInventory: 1_000_000_000n,
  volVarE4: 0n,
  volLastPriceE6: 0n,
  volLastSlot: 0n,
};
const ctx = (over: Partial<MatcherCtxView> = {}): MatcherCtxView => ({
  kind: 2,
  tradingFeeBps: 0,
  baseSpreadBps: 5,
  maxTotalBps: 100,
  impactKBps: 5000,
  liquidityNotionalE6: 1_000_000_000_000n, // $1m virtual depth
  maxFillAbs: 100_000_000_000n,
  inventoryBase: 0n,
  maxInventoryAbs: 0n,
  skewSpreadMultBps: 300,
  v2,
  ...over,
});
const ORACLE = 1_000_000n; // $1

describe("preTradeQuote (kind 2)", () => {
  it("small buy from flat: base + adaptive fee + impact + skew surcharge, priced above mark", () => {
    const q = preTradeQuote(ctx(), ORACLE, 100_000_000n, true)!; // 100 units = $100
    expect(q.kind).toBe("adaptive");
    expect(q.fillQ).toBe(100_000_000n);
    expect(q.adaptiveFeeBps).toBe(10n);
    expect(q.impactBps).toBe(1n); // ceil(5000*100/(1e6-100)) = 1
    // skew: 0 -> 100 units below the knee (333 units): avg = mult*x/(2*ref) = 300*0.1/2 = 15 bps
    expect(q.skewBps).toBe(15n);
    expect(q.totalBps).toBe(5n + 10n + 1n + 15n);
    expect(q.quotePriceE6! > ORACLE).toBe(true);
    expect(q.clippedByTotal).toBe(false);
  });

  it("taker trading toward flat earns the thin-side rebate", () => {
    // LP long 500 units (traders short): a taker BUY makes the LP sell => rebate
    const q = preTradeQuote(ctx({ inventoryBase: 500_000_000n }), ORACLE, 100_000_000n, true)!;
    expect(q.skewBps! < 0n).toBe(true);
  });

  it("a big request is size-clipped by max_total, not priced past it", () => {
    const q = preTradeQuote(ctx(), ORACLE, 50_000_000_000n, true)!; // $50k
    expect(q.clippedByTotal).toBe(true);
    expect(q.fillQ < 50_000_000_000n).toBe(true);
    expect(q.totalBps! <= 100n).toBe(true);
  });

  it("the P1 band clamps max_total (EXEC_BAND)", () => {
    const q = preTradeQuote(ctx({ maxTotalBps: 800 }), ORACLE, 50_000_000_000n, true, { bandBps: 50 })!;
    expect(q.maxTotalBps).toBe(50);
    expect(q.totalBps! <= 50n).toBe(true);
  });

  it("headroom 0 => zero fill (P1 zero-fill instead of revert)", () => {
    const q = preTradeQuote(ctx(), ORACLE, 1_000_000_000n, true, { headroomQ: 0n })!;
    expect(q.fillQ).toBe(0n);
    expect(q.quotePriceE6).toBeNull();
  });

  it("cold estimator shows the cold fee and flags it", () => {
    const q = preTradeQuote(ctx({ v2: { ...v2, volWarmupLeft: 3, feeColdBps: 40 } }), ORACLE, 1_000_000n, true)!;
    expect(q.feeCold).toBe(true);
    expect(q.adaptiveFeeBps).toBe(40n);
  });

  it("kinds 0/1 get the legacy quote (no breakdown)", () => {
    const q = preTradeQuote(ctx({ kind: 1, v2: null }), ORACLE, 1_000_000n, true)!;
    expect(q.kind).toBe("legacy");
    expect(q.quotePriceE6).toBeNull();
  });
});

describe("adaptive fee grows with volatility and stays in [lo, hi]", () => {
  it("monotone", () => {
    const a = adaptiveFeeBps({ ...v2, volVarE4: 0n });
    const b = adaptiveFeeBps({ ...v2, volVarE4: 1_000_000_00n });
    const c = adaptiveFeeBps({ ...v2, volVarE4: 10n ** 15n });
    expect(a <= b && b <= c).toBe(true);
    expect(c).toBe(80n);
  });
});

describe("inventoryClip (check_inventory_limit)", () => {
  it("clips to the far bound; 0 cap = unlimited", () => {
    expect(inventoryClip(0n, 100n, 150n, true)).toBe(100n);
    expect(inventoryClip(-100n, 100n, 5n, true)).toBe(0n);
    expect(inventoryClip(50n, 100n, 150n, true)).toBe(150n);
    expect(inventoryClip(50n, 100n, 200n, true)).toBe(150n);
    expect(inventoryClip(0n, 0n, 10n ** 20n, false)).toBe(10n ** 20n);
  });
});

describe("slippage check against the quote", () => {
  it("buy refused when quote > limit; sell refused when quote < limit; limit 0 = none", () => {
    expect(quoteFailsLimit(1_010_000n, 1_005_000n, true)).toBe(true);
    expect(quoteFailsLimit(1_004_000n, 1_005_000n, true)).toBe(false);
    expect(quoteFailsLimit(990_000n, 995_000n, false)).toBe(true);
    expect(quoteFailsLimit(990_000n, 0n, false)).toBe(false);
  });
});

describe("skew indicator", () => {
  it("signed share of the reference inventory, capped at ±100%", () => {
    expect(skewIndicatorBps(-500n, 1_000n)).toBe(-5_000);
    expect(skewIndicatorBps(5_000n, 1_000n)).toBe(10_000);
    expect(skewIndicatorBps(5n, 0n)).toBe(0);
  });
});
