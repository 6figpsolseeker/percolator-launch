/**
 * #3604: on a band market without lots (lotExp 0: every token priced at $10 or more), bandMinLeg rounded the minimum up
 * to a whole "lot", which there is a whole token. A $5,000 token with a 100 USDC minimum showed "1 lots (about 5,000
 * USDC)" and refused every order under one token, though the program takes any leg worth 100 USDC.
 */
import { describe, expect, it } from "vitest";
import { bandMinLeg, bandMinLegExactQ, legBelowBandMin, type BandRentView } from "@/lib/v22/band-rent-state";

const view = (lotExp: number, markE6: bigint, minLegNotionalAtoms = 100_000_000n): BandRentView =>
  ({
    assetIndex: 0,
    lotExp,
    band: { enabled: true, bandBps: 130, epochSlots: 600n, pinSlots: 9000n, maxPositionsPerSide: 256n, minLegNotionalAtoms, recoveryMinutes: 64 },
    price: { markE6, targetE6: markE6, lagging: false, floorStuck: false, favourableCloseSide: null },
    rent: { enabled: false, maxE9PerSlot: 0n, kinkBps: 0, rateLongE9: 0n, rateShortE9: 0n },
  }) as unknown as BandRentView;

describe("#3604: the band minimum on a market without lots", () => {
  const v = view(0, 5_000_000_000n); // $5,000 per token, 100 USDC minimum

  it("is the exact minimum (0.02 token = 100 USDC), not one whole token", () => {
    const m = bandMinLeg(v)!;
    expect(m.wholeLots).toBe(false);
    expect(m.minQ).toBe(20_000n);
    expect(m.notionalAtoms).toBe(100_000_000n);
    expect(m.minQ).toBeGreaterThanOrEqual(bandMinLegExactQ(v)!);
  });

  it("a 0.5-token order (2,500 USDC) is allowed; 0.01 token (50 USDC) is still refused", () => {
    expect(legBelowBandMin(v, 0n, 500_000n)).toBe(false);
    expect(legBelowBandMin(v, 0n, 10_000n)).toBe(true);
  });

  it("an uneven minimum rounds up, so the program's floored notional still meets it", () => {
    const odd = bandMinLeg(view(0, 3_000_000_000n))!; // 100 / 3,000 = 0.0333… token
    expect(odd.minQ).toBe(33_334n);
    expect(odd.notionalAtoms).toBeGreaterThanOrEqual(100_000_000n);
    expect(legBelowBandMin(view(0, 3_000_000_000n), 0n, 33_333n)).toBe(true);
  });

  it("CONTROL: a lot market keeps whole lots (100 USDC at 32.12 per lot = 4 lots)", () => {
    const m = bandMinLeg(view(1, 32_116_513n))!;
    expect(m.lots).toBe(4n);
    expect(m.minQ).toBe(4_000_000n);
  });
});
