/**
 * lib/lpPortfolio.ts — extracted from lib/userAccountScan.ts (2026-07-13) so
 * SERVER routes (app/api/markets/[slab]/logo/route.ts) can import
 * `isLpPortfolio` without pulling in a `"use client"` module. This test
 * imports directly from the new module (not the userAccountScan re-export,
 * which app/__tests__/lib/userAccountScan.test.ts already covers) to confirm
 * the extraction is self-contained and importable from a plain (server-safe)
 * context.
 */
import { describe, it, expect } from "vitest";
import { V17_PORTFOLIO_ACCOUNT_LEN, V17_PORTFOLIO_IDENTITY_TRAILER_LEN } from "@percolatorct/sdk";
import { isLpPortfolio, PORTFOLIO_MATCHER_CONFIG_LEN } from "@/lib/lpPortfolio";

// v18: the matcher config is followed by the identity trailer, and its trailing
// u64 is a packed control word (bit 0 = enabled).
// F-3: a real portfolio is V17_PORTFOLIO_ACCOUNT_LEN bytes with header kind byte [10] = 2.
function makePortfolioBuffer(enabled: boolean, totalLen = V17_PORTFOLIO_ACCOUNT_LEN): Buffer {
  const buf = Buffer.alloc(totalLen);
  buf[10] = 2;
  const matcherConfigOffset =
    buf.length - PORTFOLIO_MATCHER_CONFIG_LEN - V17_PORTFOLIO_IDENTITY_TRAILER_LEN;
  buf.writeBigUInt64LE(enabled ? 1n : 0n, matcherConfigOffset + 96);
  return buf;
}

describe("lib/lpPortfolio — isLpPortfolio", () => {
  it("PORTFOLIO_MATCHER_CONFIG_LEN is sizeof(PortfolioMatcherConfigV16) = 104", () => {
    expect(PORTFOLIO_MATCHER_CONFIG_LEN).toBe(104);
  });

  it("returns true when the trailing PortfolioMatcherConfigV16.enabled == 1", () => {
    expect(isLpPortfolio(makePortfolioBuffer(true))).toBe(true);
  });

  it("returns false when the trailing PortfolioMatcherConfigV16.enabled == 0", () => {
    expect(isLpPortfolio(makePortfolioBuffer(false))).toBe(false);
  });

  it("returns false for a buffer shorter than the trailing config (can't be an LP)", () => {
    expect(isLpPortfolio(Buffer.alloc(1))).toBe(false);
    expect(isLpPortfolio(Buffer.alloc(PORTFOLIO_MATCHER_CONFIG_LEN - 1))).toBe(false);
  });

  it("also accepts a plain Uint8Array (not just Buffer) — server routes get raw Uint8Array from getProgramAccounts", () => {
    const buf = makePortfolioBuffer(true);
    const plain = new Uint8Array(buf.buffer, buf.byteOffset, buf.byteLength);
    expect(isLpPortfolio(plain)).toBe(true);
  });
});
