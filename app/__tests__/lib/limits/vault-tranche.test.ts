// @vitest-environment node
/** P3 behaviour: NAV share price, cushion, withdrawals, step-down, funding drift, APY, creator caps. */
import { describe, it, expect } from "vitest";
import {
  apyFromFeeSnapshots,
  combineFundingRateE9,
  effectiveSeniorClaim,
  firstLossCushionBps,
  fundingPerHourAtoms,
  juniorWithdrawableAtoms,
  juniorWithdrawAllowed,
  projectCreatorCaps,
  projectLiqDrift,
  recallLimit,
  seniorAtomsForRedemption,
  seniorImpaired,
  seniorSharePriceE6,
  skewFundingRateE9,
  stepDownMaxLeverage,
  trancheSplit,
  MIN_APY_WINDOW_SECS,
} from "@/lib/limits/vault-tranche";

describe("waterfall + NAV share price", () => {
  it("junior absorbs losses first; senior share price holds until the junior is gone", () => {
    const C = 1_000n;
    const S = 1_000n;
    // V = 1150: senior whole, junior 150
    let s = trancheSplit(1_150n, C);
    expect(s).toEqual({ senior: 1_000n, junior: 150n });
    expect(seniorSharePriceE6(s.senior, S)).toBe(1_000_000n);
    // a 100 loss hits only the junior
    s = trancheSplit(1_050n, C);
    expect(s.senior).toBe(1_000n);
    expect(firstLossCushionBps(s.junior, C)).toBe(500);
    // past the junior: seniors take the rest, price falls
    s = trancheSplit(900n, C);
    expect(s).toEqual({ senior: 900n, junior: 0n });
    expect(seniorSharePriceE6(s.senior, S)).toBe(900_000n);
    expect(seniorImpaired(900n, C)).toBe(true);
  });

  it("harvestable fees are priced into the senior claim (crank timing can't be gamed)", () => {
    expect(effectiveSeniorClaim(1_000n, 101n, 10_000)).toBe(1_101n);
    expect(effectiveSeniorClaim(1_000n, 101n, 5_000)).toBe(1_050n);
  });

  it("redemption pays floor(shares·senior/S)", () => {
    expect(seniorAtomsForRedemption(333n, 1_000n, 900n)).toBe(299n);
    expect(seniorAtomsForRedemption(1_001n, 1_000n, 900n)).toBeNull();
    expect(seniorSharePriceE6(0n, 0n)).toBeNull();
  });
});

describe("junior withdrawals", () => {
  it("allowed only above the floor and only while backing covers the senior", () => {
    // V 1200, C 1000, floor 10% => junior 200, floor 100 => 100 withdrawable
    expect(juniorWithdrawableAtoms(1_200n, 1_000n, 1_000n, 1_000)).toBe(100n);
    expect(juniorWithdrawAllowed(1_200n, 1_000n, 1_000n, 100n, 1_000)).toBe(true);
    expect(juniorWithdrawAllowed(1_200n, 1_000n, 1_000n, 101n, 1_000)).toBe(false);
    // backing short of C => nothing
    expect(juniorWithdrawableAtoms(1_200n, 1_000n, 999n, 1_000)).toBe(0n);
    expect(recallLimit(1_000n, 999n)).toBe(1n);
  });
});

describe("skew funding + drift warning", () => {
  it("a short vault LP (traders long) => longs pay, capped, then combined within the engine bound", () => {
    const r = skewFundingRateE9(-500n, 1_000n, 1_000n, 300n);
    expect(r).toBe(300n); // 1000*0.5 = 500 > cap 300
    expect(skewFundingRateE9(500n, 1_000n, 1_000n, 300n)).toBe(-300n);
    expect(combineFundingRateE9(200n, 300n, 400n)).toBe(400n);
  });

  it("per-hour funding: longs pay a positive rate, shorts receive", () => {
    // 1000 units at $1 = $1000 notional (1e9 atoms); rate 10 e9/slot = 1e-8/slot; 9000 slots/h
    expect(fundingPerHourAtoms(1_000_000_000n, 1_000_000n, 10n)).toBe(90_000n); // $0.09/h
    expect(fundingPerHourAtoms(-1_000_000_000n, 1_000_000n, 10n)).toBe(-90_000n);
  });

  it("warns when a day of funding eats >= 10% of the margin above maintenance; receivers never warn", () => {
    const d = projectLiqDrift(1_000_000_000n, 1_000_000n, 10n, 20_000_000n); // $20 buffer, $2.16/day
    expect(d.consumedAtoms).toBe(2_160_000n);
    expect(d.warn).toBe(true);
    expect(d.liqMoveE6).toBe(2_160n); // liq moves $0.00216
    expect(projectLiqDrift(1_000_000_000n, 1_000_000n, 10n, 30_000_000n).warn).toBe(false);
    expect(projectLiqDrift(-1_000_000_000n, 1_000_000n, 10n, 1n).warn).toBe(false);
  });
});

describe("leverage step-down", () => {
  // base IMR 10% (10x), cap N = 1000 units, max IMR 50% (2x)
  it("joining the crowd lowers max leverage; the thin side keeps base leverage", () => {
    // vault LP short 400 (traders long). Taker long 200 => LP short 600 => crowd 60% => IMR 50% cap... 6000 bps > 5000 => 5000
    const joined = stepDownMaxLeverage(-400n, 200n, true, 1_000n, 1_000n, 5_000);
    expect(joined).toEqual({ maxLeverage: 2, stepped: true, imrBps: 5_000n });
    const mid = stepDownMaxLeverage(-100n, 100n, true, 1_000n, 1_000n, 5_000); // 20% crowd => 2000 bps => 5x
    expect(mid).toEqual({ maxLeverage: 5, stepped: true, imrBps: 2_000n });
    const thin = stepDownMaxLeverage(-400n, 200n, false, 1_000n, 1_000n, 5_000);
    expect(thin).toEqual({ maxLeverage: 10, stepped: false, imrBps: 1_000n });
  });
  it("off when cap is 0", () => {
    expect(stepDownMaxLeverage(-400n, 200n, true, 0n, 1_000n, 5_000).maxLeverage).toBe(10);
  });
});

describe("APY from real fee credits only", () => {
  const t0 = 1_700_000_000;
  it("null below 24 h, with no principal, or when the counter resets", () => {
    const a = { t: t0, seniorFeeCreditedAtoms: 0n, seniorClaimAtoms: 1_000_000n };
    expect(apyFromFeeSnapshots(a, { ...a, t: t0 + MIN_APY_WINDOW_SECS - 1, seniorFeeCreditedAtoms: 10n })).toBeNull();
    expect(apyFromFeeSnapshots({ ...a, seniorClaimAtoms: 0n }, { t: t0 + 86_400, seniorFeeCreditedAtoms: 10n, seniorClaimAtoms: 0n })).toBeNull();
    expect(apyFromFeeSnapshots({ ...a, seniorFeeCreditedAtoms: 50n }, { ...a, t: t0 + 86_400, seniorFeeCreditedAtoms: 10n })).toBeNull();
  });
  it("annualises the credited fees over average principal", () => {
    // 1,000 fee atoms/day on 1,000,000 principal = 0.1%/day = 36.5%/yr = 3650 bps
    const a = { t: t0, seniorFeeCreditedAtoms: 0n, seniorClaimAtoms: 1_000_000n };
    const b = { t: t0 + 86_400, seniorFeeCreditedAtoms: 1_000n, seniorClaimAtoms: 1_000_000n };
    expect(apyFromFeeSnapshots(a, b)).toBe(3_650);
  });
});

describe("creator wizard projection", () => {
  it("junior $1,000 at 10x and a 10% floor: $10k LP exposure, $10k of Earn deposits", () => {
    expect(projectCreatorCaps(1_000_000_000n, 100_000, 1_000)).toEqual({
      maxLpNotionalAtoms: 10_000_000_000n,
      maxSeniorAtoms: 10_000_000_000n,
    });
  });
});

import { earnTrancheView, rollFeeSnapshots } from "@/lib/limits/vault-tranche";

describe("earnTrancheView", () => {
  const base = {
    seniorClaimAtoms: 1_000_000_000n,
    juniorFloorBps: 1_000,
    seniorFeeShareBps: 10_000,
    backingNavAtoms: 1_000_000_000n,
    harvestableAtoms: 0n as bigint | null,
    lpValue: { kind: "certified", atoms: 200_000_000n } as const,
    totalShares: 1_000_000_000n,
    withdrawShares: 0n,
  };
  it("covered: price 1.0, 20% cushion, normal withdrawal", () => {
    const v = earnTrancheView({ ...base, withdrawShares: 100_000_000n })!;
    expect(v.valuation).toBe("certified");
    expect(v.sharePriceE6).toBe(1_000_000n);
    expect(v.junior).toBe(200_000_000n);
    expect(v.cushionBps).toBe(2_000);
    expect(v.withdrawAtoms).toBe(100_000_000n);
    expect(v.withdrawKind).toBe("normal");
    expect(v.juniorFloorAtoms).toBe(100_000_000n);
    expect(v.excludesUncrankedFees).toBe(false);
  });
  it("illiquid: backing short of C, junior in the LP covers it", () => {
    const v = earnTrancheView({ ...base, backingNavAtoms: 900_000_000n })!;
    expect(v.impaired).toBe(false);
    expect(v.illiquid).toBe(true);
    expect(v.withdrawKind).toBe("illiquid");
  });
  it("impaired: junior exhausted, price below 1, redemptions pay pro-rata of senior", () => {
    const v = earnTrancheView({ ...base, backingNavAtoms: 700_000_000n, lpValue: { kind: "certified", atoms: 100_000_000n }, withdrawShares: 100_000_000n })!;
    expect(v.impaired).toBe(true);
    expect(v.sharePriceE6).toBe(800_000n);
    expect(v.withdrawAtoms).toBe(80_000_000n);
    expect(v.withdrawKind).toBe("impaired");
    expect(v.junior).toBe(0n);
  });
  it("pending (harvestable) fees count: into V AND into C_eff (senior share 100%)", () => {
    const v = earnTrancheView({ ...base, harvestableAtoms: 50_000_000n })!;
    expect(v.seniorClaimEff).toBe(1_050_000_000n);
    expect(v.vaultValue).toBe(1_250_000_000n);
    expect(v.junior).toBe(200_000_000n);
    expect(v.backingCover).toBe(1_050_000_000n);
  });
  it("unreadable fee leg => counted as 0 and labelled", () => {
    const v = earnTrancheView({ ...base, harvestableAtoms: null })!;
    expect(v.excludesUncrankedFees).toBe(true);
    expect(v.harvestable).toBe(0n);
  });
  it("stale LP: covered by backing => senior known (liveness shortcut), junior unknown", () => {
    const v = earnTrancheView({ ...base, lpValue: { kind: "stale" } })!;
    expect(v.valuation).toBe("stale");
    expect(v.senior).toBe(1_000_000_000n);
    expect(v.junior).toBeNull();
    expect(v.impaired).toBe(false);
  });
  it("stale LP and backing short => nothing guessed", () => {
    const v = earnTrancheView({ ...base, backingNavAtoms: 900_000_000n, lpValue: { kind: "stale" }, withdrawShares: 1n })!;
    expect(v.senior).toBeNull();
    expect(v.sharePriceE6).toBeNull();
    expect(v.impaired).toBeNull();
    expect(v.withdrawKind).toBe("stale");
  });
});

describe("rollFeeSnapshots", () => {
  it("accumulates hourly snapshots and reports APY only after 24 h", () => {
    let list: { t: number; seniorFeeCreditedAtoms: bigint; seniorClaimAtoms: bigint }[] = [];
    let apy: number | null = null;
    for (let h = 0; h <= 25; h++) {
      const r = rollFeeSnapshots(list, { t: 1_000_000 + h * 3_600, seniorFeeCreditedAtoms: BigInt(h) * 1_000n, seniorClaimAtoms: 24_000_000n });
      list = r.list;
      apy = r.apyBps;
      if (h < 24) expect(apy).toBeNull();
    }
    expect(list.length).toBe(26);
    // 24,000 atoms/day on 24,000,000 = 0.1%/day = 3650 bps
    expect(apy).toBe(3_650);
  });
  it("does not add a snapshot inside the min gap", () => {
    const r = rollFeeSnapshots([{ t: 100, seniorFeeCreditedAtoms: 0n, seniorClaimAtoms: 1n }], { t: 200, seniorFeeCreditedAtoms: 0n, seniorClaimAtoms: 1n });
    expect(r.list.length).toBe(1);
  });
});

import { vaultSkewRateE9 } from "@/lib/limits/vault-tranche";

describe("vaultSkewRateE9 (vault_lp_skew_rate_e9_view)", () => {
  it("uses max(OI long, OI short); off when unbound or slope 0", () => {
    const v = { bound: true, skewSlopeE9: 1_000n, skewMaxE9: 10_000n, lpNetQ: -250n };
    expect(vaultSkewRateE9(v, 1_000n, 500n)).toBe(250n); // 1000 * 250/1000
    expect(vaultSkewRateE9(v, 500n, 1_000n)).toBe(250n);
    expect(vaultSkewRateE9({ ...v, bound: false }, 1_000n, 500n)).toBe(0n);
    expect(vaultSkewRateE9({ ...v, skewSlopeE9: 0n }, 1_000n, 500n)).toBe(0n);
    expect(vaultSkewRateE9(null, 1_000n, 500n)).toBe(0n);
  });
});
