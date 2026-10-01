/**
 * /markets graded every market with open interest "Low Liquidity": computeMarketHealthFromStats
 * divided collateral atoms (6-decimal USD) by total_open_interest, a base-token quantity (engine Q
 * on v17). Live /api/markets 2026-10-01: SI c_tot 4,932,193,999 vs OI 660,784,958,048 Q -> ratio
 * 0.007, while in USD it is $4,932 against $3,143 of OI. With total_open_interest_usd the ratios
 * are computed in collateral atoms.
 */
import fs from "fs";
import path from "path";
import { describe, expect, it } from "vitest";
import { computeMarketHealthFromStats } from "@/lib/health";

const SI = {
  total_open_interest: 660_784_958_048,
  insurance_balance: 103_837_748,
  c_tot: 4_932_193_999,
  vault_balance: 8_844_212_273,
  total_accounts: 3,
};
const PERCOLATOR = {
  total_open_interest: 10_946_910_776,
  insurance_balance: 251_149_134,
  c_tot: 4_043_879_841,
  vault_balance: 8_009_292_417,
  total_accounts: 3,
};

describe("computeMarketHealthFromStats with OI in USD", () => {
  it("BUG (no USD figure): base-token OI against collateral atoms reads as Low Liquidity", () => {
    expect(computeMarketHealthFromStats(SI).label).toBe("Low Liquidity");
    expect(computeMarketHealthFromStats(PERCOLATOR).label).toBe("Low Liquidity");
  });

  it("grades on dollars: Percolator ($4,044 vs $36.74 OI) is Healthy", () => {
    const h = computeMarketHealthFromStats({ ...PERCOLATOR, total_open_interest_usd: 36.74 });
    expect(h.label).toBe("Healthy");
    expect(h.capitalRatio).toBeCloseTo(4_043.879841 / 36.74, 2);
  });

  it("SI ($4,932 capital, $103.8 insurance vs $3,143 OI) is Caution: insurance under 5% of OI", () => {
    const h = computeMarketHealthFromStats({ ...SI, total_open_interest_usd: 3_143.35 });
    expect(h.capitalRatio).toBeCloseTo(4_932.193999 / 3_143.35, 3);
    expect(h.insuranceRatio).toBeCloseTo(103.837748 / 3_143.35, 4);
    expect(h.label).toBe("Caution");
  });

  it("zero USD OI is Healthy (nothing to back), and a non-finite USD figure falls back", () => {
    expect(computeMarketHealthFromStats({ ...SI, total_open_interest_usd: 0 }).label).toBe("Healthy");
    expect(computeMarketHealthFromStats({ ...SI, total_open_interest_usd: Number.NaN }).label).toBe("Low Liquidity");
  });

  it("both other callers pass the USD figure (the API's health sort and the creator row)", () => {
    const src = (p: string) => fs.readFileSync(path.resolve(__dirname, "../..", p), "utf8");
    expect(src("app/api/markets/route.ts")).toMatch(/computeMarketHealthFromStats\(\{[^}]*total_open_interest_usd: m\.total_open_interest_usd/s);
    expect(src("components/my-markets/CreatorMarketRow.tsx")).toMatch(/computeMarketHealthFromStats\(\{[^}]*total_open_interest_usd: oiUsd/s);
  });
});
