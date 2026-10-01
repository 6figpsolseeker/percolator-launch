/**
 * The trader trades/stats routes answered every read failure with a cached 200 of zeros, and the
 * history table's EMPTY state said "Trade history requires the indexer (currently unavailable)",
 * so every new wallet was told the platform was down while a real outage looked like no history.
 * Now: empty reads "No trades yet"; a configured source failing is a 503 + no-store that the
 * hooks' !res.ok branch shows; with no data source configured the empty 200 stays.
 */
import { render, screen } from "@testing-library/react";
import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({ fail: false, calls: 0, history: { trades: [] as unknown[], loading: false, error: null as string | null } }));

const chain: Record<string, unknown> = {};
for (const m of ["from", "select", "eq", "order", "range", "limit"]) chain[m] = () => chain;
chain.then = (res: (v: unknown) => unknown, rej: (e: unknown) => unknown) => {
  h.calls++;
  return (h.fail ? Promise.reject(new Error("connection refused")) : Promise.resolve({ data: [], error: null, count: 0 })).then(res, rej);
};
vi.mock("@/lib/supabase", () => ({ getServerNetwork: () => "devnet", getServiceClient: () => chain }));
vi.mock("@/lib/indexer-db", async (orig) => ({ ...(await orig<object>()), hasIndexerDb: () => false }));
vi.mock("@/hooks/useTradeHistory", () => ({
  useTradeHistory: () => ({ ...h.history, total: h.history.trades.length, hasMore: false, loadMore: vi.fn() }),
}));

import { GET as tradesGET } from "@/app/api/trader/[wallet]/trades/route";
import { GET as statsGET } from "@/app/api/trader/[wallet]/stats/route";
import { TradeHistoryTable } from "@/components/trade/TradeHistoryTable";

const WALLET = "7xKXtg2CW87d97TXJSDpbD5jBkheTqA83TZRuJosgAsU";
let ip = 0;
const req = (path: string) =>
  new NextRequest(`http://localhost/api/trader/${WALLET}/${path}`, { headers: { "x-forwarded-for": `10.0.0.${++ip}` } });
const ctx = { params: Promise.resolve({ wallet: WALLET }) };
const configure = () => {
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://example.supabase.co");
  vi.stubEnv("SUPABASE_SERVICE_ROLE_KEY", "service-role");
};

beforeEach(() => { h.fail = false; h.calls = 0; });
afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); });

describe("trader routes: an outage is not an empty history", () => {
  for (const [name, call] of [["trades", () => tradesGET(req("trades"), ctx)], ["stats", () => statsGET(req("stats"), ctx)]] as const) {
    it(`${name}: a configured source failing is a 503, not cached`, async () => {
      configure();
      h.fail = true;
      const res = await call();
      expect(res.status).toBe(503);
      expect(res.headers.get("cache-control")).toBe("no-store");
      const body = await res.json();
      expect(body.unavailable).toBe(true);
      expect(typeof body.error).toBe("string");
    });
    it(`${name}: nothing configured is an empty 200 without touching Supabase`, async () => {
      const res = await call();
      expect(res.status).toBe(200);
      expect((await res.json()).unavailable).toBeUndefined();
      expect(h.calls).toBe(0);
    });
    it(`${name}: a configured, healthy source with no rows is a 200`, async () => {
      configure();
      const res = await call();
      expect(res.status).toBe(200);
      expect(h.calls).toBeGreaterThan(0);
    });
  }
});

describe("history table copy", () => {
  beforeEach(() => vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify({ markets: [] })))));
  it("a wallet with no trades reads 'No trades yet', not 'indexer unavailable'", () => {
    h.history = { trades: [], loading: false, error: null };
    render(<TradeHistoryTable wallet={WALLET} />);
    expect(screen.getByText("No trades yet")).toBeTruthy();
    expect(screen.queryByText(/indexer/i)).toBeNull();
  });
  it("a failed load still says it failed", () => {
    h.history = { trades: [], loading: false, error: "Trade history temporarily unavailable" };
    render(<TradeHistoryTable wallet={WALLET} />);
    expect(screen.getByText(/Failed to load trade history/)).toBeTruthy();
  });
});
