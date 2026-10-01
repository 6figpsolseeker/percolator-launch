/**
 * Nobody is told where a trading fee goes.
 *
 * `FeeSplitControl.tsx` would have shown it and is never rendered, so a
 * creator does not know they earn a share, an LP never sees the 48% behind
 * Earn's yield, and a staker is told they earn 0% with nothing to compare it
 * against.
 *
 * These pin the numbers to the SDK rather than restating them, so a protocol
 * change fails a test instead of quietly turning the UI into a lie.
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { FEE_SPLIT } from "@percolatorct/sdk";
import {
  FEE_LEGS,
  STAKER_FEE_SHARE_BPS,
  legPercent,
  splitFeeAtoms,
  totalLegBps,
  tradeFeeAtoms,
} from "@/lib/fee-breakdown";

describe("the breakdown accounts for the whole fee", () => {
  it("the four legs sum to 100%", () => {
    // If they do not, some share of every trade is unexplained — which is the
    // state this replaces, just with numbers attached.
    expect(totalLegBps()).toBe(10_000);
  });

  it("the three stored shares sum to the SDK's total, with protocol taken first", () => {
    // The protocol's cut is not one of the stored three: FEE_SHARE_TOTAL_BPS
    // is 10_000 - PROTOCOL_FEE_BPS, and the stored shares must sum to it.
    const stored = FEE_LEGS.filter((l) => l.id !== "protocol")
      .reduce((s, l) => s + l.bps, 0);
    expect(stored).toBe(FEE_SPLIT.FEE_SHARE_TOTAL_BPS);
    expect(stored + FEE_SPLIT.PROTOCOL_FEE_BPS).toBe(10_000);
  });

  it("every leg is derived from the SDK, never restated", () => {
    // A hard-coded 48 here is how the UI keeps claiming 48% after the protocol
    // changes. Each value must trace back to FEE_SPLIT.
    const bps = Object.fromEntries(FEE_LEGS.map((l) => [l.id, l.bps]));
    expect(bps.lp).toBe(FEE_SPLIT.DEFAULT_LP_SHARE_BPS);
    expect(bps.creator).toBe(FEE_SPLIT.DEFAULT_CREATOR_SHARE_BPS);
    expect(bps.insurance).toBe(FEE_SPLIT.DEFAULT_INSURANCE_SHARE_BPS);
    expect(bps.protocol).toBe(FEE_SPLIT.PROTOCOL_FEE_BPS);
  });

  it("reports the shares a user actually sees", () => {
    const pct = Object.fromEntries(FEE_LEGS.map((l) => [l.id, legPercent(l)]));
    expect(pct).toEqual({ lp: 48, protocol: 20, creator: 16, insurance: 16 });
  });

  it("CONTROL: the defaults respect the protocol's own bounds", () => {
    // The instruction to change the split is bounded. A default outside those
    // bounds would be rejected on chain, so a breakdown showing it would be
    // describing a market that cannot exist.
    expect(FEE_SPLIT.DEFAULT_CREATOR_SHARE_BPS).toBeLessThanOrEqual(FEE_SPLIT.MAX_CREATOR_SHARE_BPS);
    expect(FEE_SPLIT.DEFAULT_LP_SHARE_BPS).toBeGreaterThanOrEqual(FEE_SPLIT.MIN_LP_SHARE_BPS);
    expect(FEE_SPLIT.DEFAULT_INSURANCE_SHARE_BPS).toBeGreaterThanOrEqual(FEE_SPLIT.MIN_INSURANCE_SHARE_BPS);
  });
});

describe("stakers are paid the insurance fee leg (E2E B4)", () => {
  it("the staker share IS the insurance share (the keeper pushes the insurance reserve to the stake pool)", () => {
    const insurance = FEE_LEGS.find((l) => l.id === "insurance")!;
    expect(insurance.bps).toBeGreaterThan(0);
    expect(STAKER_FEE_SHARE_BPS).toBe(insurance.bps);
    expect(insurance.note).toMatch(/receive this share/);
    expect(insurance.note).not.toMatch(/NOT receive/);
  });
  it("no page says stakers earn 0% any more", () => {
    const src = (f: string) => readFileSync(join(process.cwd(), f), "utf8");
    for (const f of ["app/stake/page.tsx", "components/FeeBreakdown.tsx", "lib/fee-breakdown.ts"]) {
      expect(src(f)).not.toMatch(/genuinely 0%|0% by design|not a fee-earning position|do NOT receive this share/);
    }
  });
});

describe("concrete amounts, so the percentages mean something", () => {
  const USDC = 1_000_000n; // 6 decimals

  it("computes the fee a trade pays at the market's own rate", () => {
    // The RATE is not part of the split — it varies by liquidity tier
    // (20 / 10 / 5 bps). $1,000 at 10 bps is $1.00.
    expect(tradeFeeAtoms(1_000n * USDC, 10n)).toBe(1n * USDC);
    expect(tradeFeeAtoms(1_000n * USDC, 20n)).toBe(2n * USDC);
    expect(tradeFeeAtoms(1_000n * USDC, 5n)).toBe(USDC / 2n);
  });

  it("divides that fee the way the breakdown claims", () => {
    const fee = 1n * USDC; // $1.00
    const split = splitFeeAtoms(fee);
    expect(split.lp).toBe(480_000n); // $0.48
    expect(split.protocol).toBe(200_000n); // $0.20
    expect(split.creator).toBe(160_000n); // $0.16
    expect(split.insurance).toBe(160_000n); // $0.16
    expect(split.lp + split.protocol + split.creator + split.insurance).toBe(fee);
  });

  it("CONTROL: a zero or negative input yields zero, never a negative share", () => {
    expect(tradeFeeAtoms(0n, 10n)).toBe(0n);
    expect(tradeFeeAtoms(1_000n * USDC, 0n)).toBe(0n);
    expect(tradeFeeAtoms(-1n, 10n)).toBe(0n);
    expect(Object.values(splitFeeAtoms(0n)).every((v) => v === 0n)).toBe(true);
  });
});
