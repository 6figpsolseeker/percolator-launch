import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { encodeInitMatcherCtx } from "@percolatorct/sdk";
import {
  deriveMatcherLimits,
  buildInitMatcherCtxArgs,
  I128_MAX,
  MATCHER_KIND_VAMM,
  SKEW_MULT_MAX,
} from "@/lib/matcher-params";
import { deriveMarketParams } from "@/lib/market-params";

/**
 * Faithful TS port of the DEPLOYED matcher's decode + validation
 * (percolator-match @ 12bd671, src/vamm.rs): the wrapper's tag-83 payload is
 * re-encoded as the 78-byte tag-2 init (v16_program.rs @ 6377376a:13781-13796),
 * parsed with InitParams::parse offsets (vamm.rs:361-380), clamped as
 * process_init does (:480-481), then run through MatcherCtx::validate.
 */
function wrapperDecode83(d: Uint8Array) {
  // v16_program.rs:6834-6850 read order
  const dv = new DataView(d.buffer, d.byteOffset, d.byteLength);
  let o = 0;
  const u8 = () => dv.getUint8(o++);
  const u16 = () => { const v = dv.getUint16(o, true); o += 2; return v; };
  const u32 = () => { const v = dv.getUint32(o, true); o += 4; return v; };
  const u128 = () => {
    const lo = dv.getBigUint64(o, true); const hi = dv.getBigUint64(o + 8, true); o += 16;
    return (hi << 64n) | lo;
  };
  expect(u8()).toBe(83);
  const r = {
    kind: u8(), fee: u32(), base: u32(), maxTotal: u32(), impactK: u32(),
    liq: u128(), maxFill: u128(), maxInv: u128(), feeIns: u16(), skew: u16(),
  };
  expect(o).toBe(d.length); // exactly 70 bytes, nothing trailing
  return r;
}

function matcherInit(r: ReturnType<typeof wrapperDecode83>, lpAccountId = 0x1122334455667788n) {
  const b = new Uint8Array(78);
  const dv = new DataView(b.buffer);
  const w128 = (off: number, v: bigint) => {
    dv.setBigUint64(off, v & ((1n << 64n) - 1n), true);
    dv.setBigUint64(off + 8, v >> 64n, true);
  };
  b[0] = 2; b[1] = r.kind;
  dv.setUint32(2, r.fee, true); dv.setUint32(6, r.base, true);
  dv.setUint32(10, r.maxTotal, true); dv.setUint32(14, r.impactK, true);
  w128(18, r.liq); w128(34, r.maxFill); w128(50, r.maxInv);
  dv.setUint16(66, r.feeIns, true); dv.setUint16(68, r.skew, true);
  dv.setBigUint64(70, lpAccountId, true);
  return b;
}

/** vamm.rs process_init + validate; returns the stored ctx or throws. */
function matcherProcessInit(b: Uint8Array) {
  const dv = new DataView(b.buffer);
  const r128 = (off: number) => (dv.getBigUint64(off + 8, true) << 64n) | dv.getBigUint64(off, true);
  if (b.length < 66 || b[0] !== 2) throw new Error("InvalidInstructionData");
  const kind = b[1];
  if (kind !== 0 && kind !== 1) throw new Error("InvalidInstructionData"); // MatcherKind::try_from
  const lpAccountId = dv.getBigUint64(70, true);
  if (lpAccountId === 0n) throw new Error("InvalidInstructionData"); // GH#10
  const ctx = {
    kind,
    tradingFee: dv.getUint32(2, true), base: dv.getUint32(6, true),
    maxTotal: dv.getUint32(10, true), impactK: dv.getUint32(14, true),
    liq: r128(18),
    maxFill: r128(34) < I128_MAX ? r128(34) : I128_MAX, // :480
    maxInv: r128(50) < I128_MAX ? r128(50) : I128_MAX, // :481
    feeIns: dv.getUint16(66, true), skew: dv.getUint16(68, true),
  };
  // MatcherCtx::validate (vamm.rs:266-322)
  if (ctx.kind === 1 && ctx.liq === 0n) throw new Error("InvalidAccountData");
  if (ctx.maxTotal > 9000 || ctx.tradingFee > 1000) throw new Error("InvalidAccountData");
  if (ctx.base + ctx.tradingFee > ctx.maxTotal) throw new Error("InvalidAccountData");
  if (ctx.feeIns > 10_000 || ctx.skew > 10_000) throw new Error("InvalidAccountData");
  return ctx;
}

const CASES: Array<[string, number, bigint, bigint]> = [
  ["default 1000 USDC @ $1, 5x", 5, 1_000_000_000n, 1_000_000n],
  ["SOL-ish $150, 10x", 10, 1_000_000_000n, 150_000_000n],
  ["tiny LP (1 atom)", 2, 1n, 1_000_000n],
  ["dust LP vs pricey asset", 2, 10n, 100_000_000_000_000n],
  ["huge LP", 10, (1n << 100n), 1n],
  ["absurd LP (overflow i128)", 10, (1n << 200n), 1n],
  ["micro-cap price", 3, 5_000_000n, 1n],
];

describe("deriveMatcherLimits — never 0, never overflows (negative controls)", () => {
  it("returns non-zero, i128-bounded, ordered fields for every case", () => {
    for (const [, lev, lp, px] of CASES) {
      const m = deriveMatcherLimits(lev, lp, px);
      expect(m.maxInventoryAbs).toBeGreaterThanOrEqual(1n);
      expect(m.maxFillAbs).toBeGreaterThanOrEqual(1n);
      expect(m.liquidityNotionalE6).toBeGreaterThanOrEqual(1n);
      expect(m.maxInventoryAbs).toBeLessThanOrEqual(I128_MAX);
      expect(m.maxFillAbs).toBeLessThanOrEqual(m.maxInventoryAbs);
      expect(m.liquidityNotionalE6).toBeLessThanOrEqual(I128_MAX);
      expect(m.skewSpreadMultBps).toBeGreaterThanOrEqual(1);
      expect(m.skewSpreadMultBps).toBeLessThanOrEqual(SKEW_MULT_MAX);
      expect(m.kind).toBe(1);
    }
  });

  it("degenerate inputs (0, negative, NaN) still never emit 0", () => {
    for (const lp of [0n, -5n]) {
      for (const px of [0n, -1n]) {
        for (const lev of [0, -3, NaN, Infinity, 0.4]) {
          const m = deriveMatcherLimits(lev, lp, px);
          expect(m.maxInventoryAbs).toBe(1n);
          expect(m.maxFillAbs).toBe(1n);
          expect(m.liquidityNotionalE6).toBe(1n);
          expect(m.skewSpreadMultBps).toBeGreaterThanOrEqual(1);
        }
      }
    }
  });

  it("naive formula WOULD give 0 for a tiny LP (control: proves the guard is doing work)", () => {
    const naive = ((1n * 2n * 40n) / 100n * 1_000_000n) / 1_000_000n; // = 0
    expect(naive).toBe(0n);
    expect(deriveMatcherLimits(2, 1n, 1_000_000n).maxInventoryAbs).toBe(1n);
  });

  it("matches the documented formula for a normal market", () => {
    const m = deriveMatcherLimits(5, 1_000_000_000n, 150_000_000n);
    expect(m.maxInventoryAbs).toBe(((1_000_000_000n * 5n * 40n) / 100n * 1_000_000n) / 150_000_000n);
    expect(m.maxFillAbs).toBe(m.maxInventoryAbs / 4n);
    expect(m.liquidityNotionalE6).toBe(5_000_000_000n);
  });

  it("deriveMarketParams exposes the same limits (single source)", () => {
    const d = deriveMarketParams(5, 1_000_000_000n, 150_000_000n);
    expect(d.matcher).toEqual(deriveMatcherLimits(5, 1_000_000_000n, 150_000_000n));
    expect(d.maxFillAbs).toBe(d.matcher.maxFillAbs);
    expect(d.skewSpreadMultBps).toBe(d.matcher.skewSpreadMultBps);
  });
});

describe("InitMatcherCtx bytes vs the deployed matcher decode", () => {
  for (const [name, lev, lp, px] of CASES) {
    it(`kind 1 + skew OFF + finite caps accepted by process_init: ${name}`, () => {
      const d = deriveMarketParams(lev, lp, px);
      const data = encodeInitMatcherCtx(buildInitMatcherCtxArgs(10, d.matcher));
      expect(data.length).toBe(70);
      const wrapped = wrapperDecode83(data);
      const ctx = matcherProcessInit(matcherInit(wrapped));
      expect(ctx.kind).toBe(MATCHER_KIND_VAMM);
      // 2026-10-01: new LPs launch with skew 0 (deployed matcher skew units bug, WIZARD_SKEW_SPREAD_MULT_BPS).
      expect(ctx.skew).toBe(0);
      expect(ctx.maxFill).toBeGreaterThan(0n);
      expect(ctx.maxInv).toBeGreaterThan(0n);
      expect(ctx.maxFill).toBeLessThan(I128_MAX + 1n);
      expect(ctx.liq).toBeGreaterThan(0n);
      // finite unless the LP is astronomically large (then i128::MAX sentinel is the clamp)
      expect(ctx.maxInv).toBe(d.matcher.maxInventoryAbs);
      expect(ctx.maxFill).toBe(d.matcher.maxFillAbs);
    });
  }

  it("byte offsets: kind@1, fee@2, spread@6, maxTotal@10, impact@14, liq@18, fill@34, inv@50, skew@68", () => {
    const d = deriveMarketParams(5, 1_000_000_000n, 150_000_000n);
    const b = encodeInitMatcherCtx(buildInitMatcherCtxArgs(10, d.matcher));
    const dv = new DataView(b.buffer, b.byteOffset);
    expect(b[0]).toBe(83);
    expect(b[1]).toBe(1);
    expect(dv.getUint32(2, true)).toBe(10);
    expect(dv.getUint32(6, true)).toBe(50);
    expect(dv.getUint32(10, true)).toBe(200);
    expect(dv.getUint32(14, true)).toBe(200);
    const r128 = (o: number) => (dv.getBigUint64(o + 8, true) << 64n) | dv.getBigUint64(o, true);
    expect(r128(18)).toBe(d.matcher.liquidityNotionalE6);
    expect(r128(34)).toBe(d.matcher.maxFillAbs);
    expect(r128(50)).toBe(d.matcher.maxInventoryAbs);
    expect(dv.getUint16(66, true)).toBe(0);
    expect(dv.getUint16(68, true)).toBe(0); // skew written as 0 (WIZARD_SKEW_SPREAD_MULT_BPS)
  });

  it("NEGATIVE CONTROL: the old kind-0-shaped payload flipped to kind 1 is rejected by the matcher", () => {
    const d = deriveMarketParams(5, 1_000_000_000n, 150_000_000n);
    const bad = encodeInitMatcherCtx({
      ...buildInitMatcherCtxArgs(10, d.matcher),
      liquidityNotionalE6: 0n, // what the kind-0 wizard sent
    });
    expect(() => matcherProcessInit(matcherInit(wrapperDecode83(bad)))).toThrow("InvalidAccountData");
  });
});

describe("wizard wiring — every create path uses the helper, kind 0 is gone", () => {
  const root = path.resolve(__dirname, "../..");
  const files = ["hooks/useCreateMarket.ts", "app/api/mobile/create-market/route.ts"];
  for (const f of files) {
    it(`${f} builds InitMatcherCtx via buildInitMatcherCtxArgs`, () => {
      const src = readFileSync(path.join(root, f), "utf8");
      expect(src).toContain("buildInitMatcherCtxArgs");
      expect(src).not.toMatch(/encodeInitMatcherCtx\(\{[^}]*kind:\s*0/s);
    });
  }
  it("hook has both create sites (merged + sequential) wired", () => {
    const src = readFileSync(path.join(root, "hooks/useCreateMarket.ts"), "utf8");
    expect(src.match(/buildInitMatcherCtxArgs\(/g)?.length).toBe(2);
  });
});
