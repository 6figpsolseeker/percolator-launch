// @vitest-environment node
/**
 * M-4: a swallowed RPC error must never read as "no account". findV17Portfolio (used by the
 * first trade, the trade resolver and the ADL close) used to return null on ANY exception, so a
 * 429 made the first-trade flow create a second portfolio. It now retries, then throws the calm
 * PortfolioLookupError; null still means "the scan completed and found none".
 */
import { describe, it, expect, vi } from "vitest";
import { Keypair } from "@solana/web3.js";
import { findV17Portfolio } from "@/hooks/useTrade";
import { PORTFOLIO_LOOKUP_COPY, PortfolioLookupError } from "@/lib/owner-portfolio";

const P = Keypair.generate().publicKey;
const M = Keypair.generate().publicKey;
const O = Keypair.generate().publicKey;

describe("findV17Portfolio — not-found vs RPC-failed", () => {
  it("every attempt 429s → throws the calm lookup error (never null)", async () => {
    vi.useFakeTimers();
    const c = { getProgramAccounts: vi.fn(async () => { throw new Error("429 Too Many Requests"); }) };
    const p = findV17Portfolio(c as never, P, M, O).catch((e: unknown) => e);
    await vi.runAllTimersAsync();
    const err = await p;
    vi.useRealTimers();
    expect(err).toBeInstanceOf(PortfolioLookupError);
    expect((err as Error).message).toBe(PORTFOLIO_LOOKUP_COPY);
    expect(c.getProgramAccounts).toHaveBeenCalledTimes(3);
  });
  it("control: a completed empty scan is null", async () => {
    const c = { getProgramAccounts: vi.fn(async () => []) };
    await expect(findV17Portfolio(c as never, P, M, O)).resolves.toBeNull();
  });
});
