import { afterEach, describe, expect, it, vi } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import { NextRequest } from "next/server";
import { GET } from "@/app/api/oracle/resolve/[ca]/route";
import { useDexPoolSearch } from "@/hooks/useDexPoolSearch";
import { NON_USD_QUOTE_REASON } from "@/lib/dex-constants";

/**
 * Both places the create wizard gets its pool from must skip pools quoted in a
 * token that isn't WSOL/USDC/USDT. COLLECT's deepest pool (99C6, $268k) is
 * quoted in CARDS; its next one (9GD7, Meteora DLMM, $227k) is quoted in SOL.
 * DexScreener data below is from mainnet, 2026-09-29.
 */
const COLLECT = "nDZknLvfFRp5rgUHdzTrQsmSY5NKzoavqdLjSHVpump";
const MURPHY = "4kgo11KazbCNd2DosYSLGpgSZhEtda1gGu4rbWJLGCJV";
const WSOL = "So11111111111111111111111111111111111111112";
const CARDS = "CARDSccUMFKoPRZxt5vt3ksUbxEFEcnZ3H2pd3dKxYjp";
const DOGE = "DoGEV7LASBkQbibMc5k5vKnTZoMg423GpJ5QtJEGfm7R";

const pair = (pairAddress: string, dexId: string, base: string, quote: string, usd: number) => ({
  chainId: "solana",
  dexId,
  pairAddress,
  baseToken: { address: base, symbol: "TOKEN" },
  quoteToken: { address: quote, symbol: "Q" },
  liquidity: { usd },
  priceUsd: "0.0038",
});

const COLLECT_PAIRS = [
  pair("99C6TUp7WgTvnwQVVhAbD8HbxPdo5LJCXr7VFCvTmJf1", "pumpswap", COLLECT, CARDS, 268_405),
  pair("9GD7vaaocPe8sQFriG4iMhLL6mWxmevTVnjpSbCHRBqc", "meteora", COLLECT, WSOL, 227_431),
];
const DOGE_ONLY_PAIRS = [pair("7CCRs48eJfvTuiZKLZvTKCdJS3XU4mTUozKw2xhyRevT", "pumpswap", MURPHY, DOGE, 21_478)];

function mockDexScreener(pairs: unknown[]) {
  globalThis.fetch = vi.fn(async (url: string | URL | Request) =>
    String(url).includes("dexscreener")
      ? new Response(JSON.stringify({ pairs }), { status: 200 })
      : new Response("{}", { status: 404 }),
  ) as typeof fetch;
}

afterEach(() => vi.restoreAllMocks());

async function resolve(ca: string) {
  const res = await GET(new NextRequest(`http://localhost/api/oracle/resolve/${ca}`), {
    params: Promise.resolve({ ca }),
  });
  return (await res.json()) as { dexPoolAddress: string | null; dexType: string | null; oracleMode: string };
}

describe("/api/oracle/resolve picks a USD-priceable pool", () => {
  it("COLLECT resolves to its SOL-quoted Meteora pool, not the deeper CARDS pool", async () => {
    mockDexScreener(COLLECT_PAIRS);
    const r = await resolve(COLLECT);
    expect(r.dexPoolAddress).toBe("9GD7vaaocPe8sQFriG4iMhLL6mWxmevTVnjpSbCHRBqc");
    expect(r.dexType).toBe("meteora");
  });

  it("a token with only a non-USD-quoted pool gets no pool", async () => {
    mockDexScreener(DOGE_ONLY_PAIRS);
    const r = await resolve(MURPHY);
    expect(r.dexPoolAddress).toBeNull();
    expect(r.oracleMode).toBe("admin");
  });
});

describe("useDexPoolSearch skips pools quoted in a non-USD token", () => {
  it("COLLECT: only the SOL-quoted pool is offered", async () => {
    mockDexScreener(COLLECT_PAIRS);
    const { result } = renderHook(() => useDexPoolSearch(COLLECT));
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.pools.map((p) => p.poolAddress)).toEqual([
      "9GD7vaaocPe8sQFriG4iMhLL6mWxmevTVnjpSbCHRBqc",
    ]);
    expect(result.current.blockedReason).toBeNull();
  });

  it("only non-USD-quoted pools: no pools, and the reason says why", async () => {
    mockDexScreener(DOGE_ONLY_PAIRS);
    const { result } = renderHook(() => useDexPoolSearch(MURPHY));
    await waitFor(() => expect(result.current.blockedReason).not.toBeNull());
    expect(result.current.pools).toEqual([]);
    expect(result.current.blockedReason).toBe(NON_USD_QUOTE_REASON);
  });

  it("a pair with no quote address is skipped", async () => {
    const noAddr = { ...COLLECT_PAIRS[1], quoteToken: { symbol: "SOL" } };
    mockDexScreener([noAddr]);
    const { result } = renderHook(() => useDexPoolSearch(COLLECT));
    await waitFor(() => expect(result.current.blockedReason).not.toBeNull());
    expect(result.current.pools).toEqual([]);
  });
});
