/**
 * readMatcherContextReadiness — mirrors the wrapper TradeCpi precondition whose
 * violation returns Custom(9): matcher ctx must be non-executable, owned by the
 * matcher program, >= 64 bytes (#2643).
 */
import { describe, it, expect, vi } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { PublicKey } from "@solana/web3.js";

vi.mock("@percolatorct/sdk", () => ({
  V17_PORTFOLIO_IDENTITY_TRAILER_LEN: 0,
  V17_PORTFOLIO_ACCOUNT_LEN: 9563,
  decodePortfolioMatcherControl: () => ({ enabled: true }),
}));

// LP SELECTION is lib/market-lp.ts's job (identity rules, tested in market-lp.test.ts).
// These tests pin matcherCaps' own caching/readiness on top of it, so the resolver is
// stubbed: the first enabled portfolio the fake scan returns stands in for "the LP".
vi.mock("@/lib/market-lp", async () => {
  const sdk = await import("@percolatorct/sdk");
  const { PublicKey: Pk } = await import("@solana/web3.js");
  return {
    resolveMarketLp: async (c: { getProgramAccounts: () => Promise<{ account: { data: Uint8Array } }[]> }) => {
      const rows = await c.getProgramAccounts();
      for (const r of rows) {
        const d = r.account.data;
        const off = d.length - 104 - sdk.V17_PORTFOLIO_IDENTITY_TRAILER_LEN;
        if (off < 0) continue;
        return { matcherCtx: new Pk(d.subarray(off + 32, off + 64)) };
      }
      return null;
    },
  };
});

import { readMatcherContextReadiness } from "@/lib/matcherCaps";

const MATCHER = new PublicKey(new Uint8Array(32).fill(3));
const OTHER = new PublicKey(new Uint8Array(32).fill(8));
const PROGRAM = new PublicKey(new Uint8Array(32).fill(4));
const CTX = new PublicKey(new Uint8Array(32).fill(6));
let n = 20;
const nextSlab = () => new PublicKey(new Uint8Array(32).fill(n++)); // fresh key => no ctx-address cache hit

/** Portfolio bytes whose trailing 104-byte matcher config points at CTX. */
function portfolioWithCtx(): Buffer {
  // v18 + F-3 shape: full portfolio length, header kind 2, enabled config before the 24-B trailer.
  const b = Buffer.alloc(9563);
  b[10] = 2;
  const off = b.length - 104; // the mock's trailer length is 0
  Buffer.from(CTX.toBytes()).copy(b, off + 32);
  b.writeBigUInt64LE(1n, off + 96);
  return b;
}

function conn(ctxInfo: unknown, portfolios = [{ account: { data: portfolioWithCtx() } }]) {
  return {
    getProgramAccounts: vi.fn(async () => portfolios),
    getAccountInfo: vi.fn(async () => ctxInfo),
  } as unknown as import("@solana/web3.js").Connection;
}
const info = (over: Partial<{ executable: boolean; owner: PublicKey; len: number }> = {}) => ({
  executable: over.executable ?? false,
  owner: over.owner ?? MATCHER,
  data: Buffer.alloc(over.len ?? 320),
});

describe("readMatcherContextReadiness", () => {
  it("ready: owned by the matcher, non-executable, >= 64 bytes", async () => {
    expect(await readMatcherContextReadiness(conn(info()), PROGRAM, nextSlab(), MATCHER)).toBe("ready");
  });
  it("not-ready: ctx account missing", async () => {
    expect(await readMatcherContextReadiness(conn(null), PROGRAM, nextSlab(), MATCHER)).toBe("not-ready");
  });
  it("not-ready: ctx not owned by the matcher program", async () => {
    expect(await readMatcherContextReadiness(conn(info({ owner: OTHER })), PROGRAM, nextSlab(), MATCHER)).toBe("not-ready");
  });
  it("not-ready: ctx shorter than MATCHER_CONTEXT_MIN_LEN (64)", async () => {
    expect(await readMatcherContextReadiness(conn(info({ len: 63 })), PROGRAM, nextSlab(), MATCHER)).toBe("not-ready");
  });
  it("not-ready: ctx is executable", async () => {
    expect(await readMatcherContextReadiness(conn(info({ executable: true })), PROGRAM, nextSlab(), MATCHER)).toBe("not-ready");
  });
  it("not-ready: no LP portfolio with an enabled matcher config", async () => {
    expect(await readMatcherContextReadiness(conn(info(), []), PROGRAM, nextSlab(), MATCHER)).toBe("not-ready");
  });
  it("unknown: RPC failure is not a conclusion", async () => {
    const c = {
      getProgramAccounts: vi.fn(async () => { throw new Error("rpc"); }),
      getAccountInfo: vi.fn(),
    } as unknown as import("@solana/web3.js").Connection;
    expect(await readMatcherContextReadiness(c, PROGRAM, nextSlab(), MATCHER)).toBe("unknown");
  });
});

describe("#2643 wiring", () => {
  it("both trade-error surfaces refine Custom(9) via diagnoseTradeRejection", () => {
    for (const f of ["../../components/trade/OrderTicket.tsx", "../../hooks/useClosePosition.ts"]) {
      const src = readFileSync(resolve(__dirname, f), "utf8");
      expect(src).toContain("diagnoseTradeRejection(");
    }
  });
});
