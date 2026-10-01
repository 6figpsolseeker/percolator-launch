import { describe, it, expect } from "vitest";
import { tradableMarginAtoms, firstTradeDepositAtoms } from "@/lib/first-trade";
import { computeTradingFee } from "@/lib/trading";
import { computeNotionalNative } from "@/lib/notional";

const U = 1_000_000n;
// The deposit the ticket would bundle for margin M on an account with A available (OrderTicket marginShort/fundNeededAtoms).
function bundledDeposit(M: bigint, A: bigint, lev: number, feeBps: bigint): bigint {
  const fee = computeTradingFee(computeNotionalNative(M, lev), feeBps);
  const short = M > A ? M - A : 0n;
  return short > 0n ? firstTradeDepositAtoms(short, fee) : 0n;
}

describe("tradableMarginAtoms (Squid 2026-10-01: Available ignored wallet sim-USDC)", () => {
  it("an account with 200 in-market and 5,000 in the wallet can offer far more than 200", () => {
    const m = tradableMarginAtoms({ inMarketAvailable: 200n * U, walletAtoms: 5_000n * U, leverage100: 300, feeBps: 30n });
    expect(m).toBeGreaterThan(4_000n * U);
  });
  it("Max never asks for a deposit larger than the wallet (all leverages, fees, balances)", () => {
    for (const lev of [1, 2, 3, 5, 6.66, 10, 20])
      for (const feeBps of [0n, 5n, 20n, 30n, 100n])
        for (const A of [0n, 1n, 50n * U, 200n * U, 1_121_010_000n])
          for (const W of [0n, 1n, 10_000n, 3n * U, 500n * U, 9_999_990_000n]) {
            const M = tradableMarginAtoms({ inMarketAvailable: A, walletAtoms: W, leverage100: lev * 100, feeBps });
            expect(M).toBeGreaterThanOrEqual(A);
            if (M > A) expect(bundledDeposit(M, A, lev, feeBps)).toBeLessThanOrEqual(W);
          }
  });
  it("an empty wallet leaves exactly the in-market available", () => {
    expect(tradableMarginAtoms({ inMarketAvailable: 200n * U, walletAtoms: 0n, leverage100: 300, feeBps: 30n })).toBe(200n * U);
  });
  it("no account yet: the whole wallet net of buffer and fee", () => {
    const m = tradableMarginAtoms({ inMarketAvailable: 0n, walletAtoms: 1_000n * U, leverage100: 100, feeBps: 0n });
    expect(m).toBeGreaterThan(900n * U);
    expect(firstTradeDepositAtoms(m, 0n)).toBeLessThanOrEqual(1_000n * U);
  });
});
