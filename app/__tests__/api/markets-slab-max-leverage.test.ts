/**
 * /api/markets/[slab] served the Supabase view's stored max_leverage (10 for
 * every market) while the list derives it from on-chain initial_margin_bps.
 * OrderTicket / MarketStatsCard fall back to THIS route, so a 6.5x market
 * (COLLECT, 1538 bps) advertised 10x on the trade page — above what the engine
 * will accept (margin = ceil(notional * bps / 10000) => cap 10000/bps).
 *
 * Real GET handler; the slab bytes are live devnet accounts (captured
 * 2026-09-29, read-only getAccountInfo). Only Supabase + the RPC connection are
 * stubbed.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { NextRequest } from "next/server";
import { parseWrapperConfigV17, V17_HEADER_LEN } from "@percolatorct/sdk";
import { parseV17RiskParams } from "@/lib/v17-engine-config";

const FX = path.join(__dirname, "..", "fixtures");
function load(file: string) {
  const j = JSON.parse(fs.readFileSync(path.join(FX, file), "utf8")) as { market: string; dataBase64: string };
  return { slab: j.market, data: new Uint8Array(Buffer.from(j.dataBase64, "base64")) };
}
const COLLECT = load("3t67LQPd.collect.market.json"); // 1538 bps -> 6.5x
const ANSEM = load("5bVTTMRc.ansem.market.json"); // 1000 bps -> 10x
const SOL = load("Azagguvr.market.json");

const state = vi.hoisted(() => ({ row: {} as Record<string, unknown>, data: new Uint8Array(0) }));

vi.mock("@/lib/supabase", () => ({
  getServerNetwork: () => "devnet",
  getServiceClient: () => ({
    from: () => ({
      select: () => ({
        eq: () => ({
          eq: () => ({ maybeSingle: async () => ({ data: state.row, error: null }) }),
        }),
      }),
    }),
  }),
}));
vi.mock("@/lib/server-rpc", () => ({
  getServerConnection: () => ({
    // Owned by the CURRENT wrapper (the route 404s any other owner since the relaunch).
    getAccountInfo: async () => {
      const { getConfig } = await vi.importActual<typeof import("@/lib/config")>("@/lib/config");
      const programId = getConfig().programId;
      return { data: Buffer.from(state.data), owner: { toBase58: () => programId } };
    },
  }),
}));
vi.mock("@/lib/lp-portfolio", () => ({ getMarketLpCapital: async () => null }));
vi.mock("@/lib/playground-registered-markets", () => ({ readRegisteredMarkets: async () => [] }));
vi.mock("@sentry/nextjs", () => ({ captureException: vi.fn(), captureMessage: vi.fn() }));

import { GET } from "@/app/api/markets/[slab]/route";
import { leverageFromMarginBps } from "@/lib/market-params";

function bps(d: Uint8Array): number {
  const c = parseWrapperConfigV17(d, V17_HEADER_LEN);
  return Number(parseV17RiskParams(d, c.tradeFeeBps)!.initialMarginBps);
}

async function call(m: { slab: string; data: Uint8Array }) {
  state.row = { slab_address: m.slab, symbol: "X", max_leverage: 10, last_price: 1, mark_price: 1, index_price: null, network: "devnet" };
  state.data = m.data;
  const res = await GET(new NextRequest(`http://x/api/markets/${m.slab}`), { params: Promise.resolve({ slab: m.slab }) });
  return (await res.json()).market as Record<string, unknown>;
}

describe("/api/markets/[slab] max_leverage", () => {
  beforeEach(() => vi.clearAllMocks());

  it("fixtures are the live bps the list saw", () => {
    expect(bps(COLLECT.data)).toBe(1538);
    expect(bps(ANSEM.data)).toBe(1000);
  });

  it("COLLECT (1538 bps) is 6.5x, not the stored 10 and not a rounded-up 7", async () => {
    const m = await call(COLLECT);
    expect(m.max_leverage).toBe(6.5);
    expect(m.max_leverage).toBe(leverageFromMarginBps(1538)); // == the list
  });

  it("1000 bps market stays 10x", async () => {
    expect((await call(ANSEM)).max_leverage).toBe(10);
  });

  it("SOL derives from its own bps, matching the list function", async () => {
    const m = await call(SOL);
    expect(m.max_leverage).toBe(leverageFromMarginBps(bps(SOL.data)));
  });
});
