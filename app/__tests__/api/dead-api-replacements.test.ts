// @vitest-environment node
/**
 * The retired percolator-api ("Application not found") used to serve /api/funding/:slab,
 * /api/insurance/:slab, /api/prices/markets and half of /api/health, through next.config
 * rewrites that also SHADOWED the in-app dynamic routes. These are now in-app handlers reading
 * the chain (and the registry), driven here through the real route modules with a real v18 slab
 * (PENGU, captured read-only) served as owned by the current wrapper.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { PublicKey } from "@solana/web3.js";
import { parseMarketGroupV17OI, parseWrapperConfigV17, V17_HEADER_LEN } from "@percolatorct/sdk";
import { readV17MaxAbsFunding } from "@/lib/v17-engine-config";

const WRAPPER = "ETDLAdiAyWnEUngspYczTXUceT6X8f92eZQvr8nmSkWB";
const SLAB = "ENdXK8k6iiWCAx4Z9XfoKLg9oXsEbPL4hEtmEmUqozDZ";
const PENGU = Buffer.from(readFileSync(join(__dirname, "..", "fixtures", "v18-liveness", "pengu-market-v18-healthy.b64"), "utf8").trim(), "base64");

const h = vi.hoisted(() => ({
  owner: "",
  data: null as Buffer | null,
  rpcThrows: false,
  slotThrows: false,
  rows: [] as Record<string, unknown>[] | null,
  dbConfigured: false,
  dbUp: true,
}));

vi.mock("@sentry/nextjs", () => ({ captureException: vi.fn(), captureMessage: vi.fn() }));
vi.mock("@/lib/config", async (orig) => {
  const m = await orig<{ getConfig: () => Record<string, unknown> }>();
  return { ...m, getConfig: () => ({ ...m.getConfig(), programId: WRAPPER, network: "devnet" }) };
});
vi.mock("@/lib/server-rpc", () => ({
  getServerConnection: () => ({
    getAccountInfo: async () => {
      if (h.rpcThrows) throw new Error("429");
      return h.data ? { owner: new PublicKey(h.owner), data: h.data } : null;
    },
    getSlot: async () => {
      if (h.slotThrows) throw new Error("rpc down");
      return 123;
    },
  }),
}));
vi.mock("@/lib/market-registry", () => ({ loadMergedMarketRows: async () => h.rows }));
vi.mock("@/lib/indexer-db", () => ({ hasIndexerDb: () => h.dbConfigured, pingIndexerDb: async () => h.dbUp }));

const { GET: fundingGET } = await import("@/app/api/funding/[slab]/route");
const { GET: insuranceGET } = await import("@/app/api/insurance/[slab]/route");
const { GET: healthGET } = await import("@/app/api/health/route");

const call = (fn: (r: Request, c: { params: Promise<{ slab: string }> }) => Promise<Response>, slab = SLAB) =>
  fn(new Request(`http://localhost/x/${slab}`), { params: Promise.resolve({ slab }) });

beforeEach(() => {
  h.owner = WRAPPER;
  h.data = PENGU;
  h.rpcThrows = false;
  h.slotThrows = false;
  h.rows = [];
  h.dbConfigured = false;
  h.dbUp = true;
});

describe("/api/funding/:slab (FundingRateCard)", () => {
  it("funding structurally off (max_abs_funding 0): the current rate is exactly 0, in the card's shape", async () => {
    expect(readV17MaxAbsFunding(new Uint8Array(PENGU))).toBe(0n);
    const res = await call(fundingGET);
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ currentRateBpsPerSlot: 0, hourlyRatePercent: 0, annualizedPercent: 0, netLpPosition: "0", fundingEnabled: false });
  });
  it("funding on: not decoded yet -> 404 (the card keeps its own fallback; no invented 0)", async () => {
    const d = Buffer.from(PENGU);
    const { V17_ENGINE_CONFIG_OFF, V17_MAX_ABS_FUNDING_REL } = await import("@/lib/v17-engine-config");
    d.writeBigUInt64LE(1000n, V17_ENGINE_CONFIG_OFF + V17_MAX_ABS_FUNDING_REL);
    h.data = d;
    expect((await call(fundingGET)).status).toBe(404);
  });
  it("NEGATIVE CONTROLS: another program's slab -> 404; RPC failure -> 503; bad slab -> 400", async () => {
    h.owner = "GnwdeQrAh4qzChJeVLrM21CXXWC1akjLH3DiijwzEEYZ";
    expect((await call(fundingGET)).status).toBe(404);
    h.owner = WRAPPER;
    h.rpcThrows = true;
    expect((await call(fundingGET)).status).toBe(503);
    h.rpcThrows = false;
    expect((await call(fundingGET, "not-a-slab")).status).toBe(400);
  });
});

describe("/api/insurance/:slab (InsuranceDashboard)", () => {
  it("balance and OI-at-mark come from the slab; history fields are empty, not invented", async () => {
    const oi = parseMarketGroupV17OI(new Uint8Array(PENGU));
    const mark = parseWrapperConfigV17(new Uint8Array(PENGU), V17_HEADER_LEN).markEwmaE6;
    const res = await call(insuranceGET);
    expect(res.status).toBe(200);
    const body = (await res.json()) as Record<string, unknown>;
    expect(body.balance).toBe(oi.insuranceBalance.toString());
    expect(body.totalRisk).toBe((((oi.totalLongOiQ + oi.totalShortOiQ) * mark) / 1_000_000n).toString());
    expect(body).toMatchObject({ feeRevenue: null, dailyAccumulationRate: null, historicalBalance: [], source: "on-chain" });
    // The dashboard's own mapping parses these as BigInt.
    expect(() => BigInt(body.balance as string) + BigInt(body.totalRisk as string)).not.toThrow();
  });
  it("NEGATIVE CONTROL: another program's slab -> 404", async () => {
    h.owner = "GnwdeQrAh4qzChJeVLrM21CXXWC1akjLH3DiijwzEEYZ";
    expect((await call(insuranceGET)).status).toBe(404);
  });
});

describe("/api/prices/markets", () => {
  it("is deleted (no caller; was an unauthenticated service-role + all-slab read)", () => {
    expect(existsSync(resolve(__dirname, "../../app/api/prices/markets/route.ts"))).toBe(false);
  });
});

describe("/api/health", () => {
  it("rpc up, no indexer configured -> 200 online", async () => {
    const res = await healthGET();
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ status: "online", rpc: true, indexer: null });
  });
  it("indexer configured and down -> 503 degraded; rpc down -> 503 offline", async () => {
    h.dbConfigured = true;
    h.dbUp = false;
    let res = await healthGET();
    expect(res.status).toBe(503);
    expect(await res.json()).toMatchObject({ status: "degraded", indexer: false });
    h.dbUp = true;
    h.slotThrows = true;
    res = await healthGET();
    expect(res.status).toBe(503);
    expect(await res.json()).toMatchObject({ status: "offline", rpc: false });
  });
  it("never probes the retired API", () => {
    const src = readFileSync(join(__dirname, "..", "..", "app", "api", "health", "route.ts"), "utf8");
    expect(src).not.toMatch(/getBackendUrl\(|fetch\(/);
  });
});

describe("next.config", () => {
  it("has no proxy rewrites (they shadowed the in-app dynamic routes and hit a dead service)", () => {
    const src = readFileSync(join(__dirname, "..", "..", "next.config.ts"), "utf8");
    expect(src).not.toMatch(/async rewrites\(\)/);
    expect(src).not.toMatch(/destination: `\$\{API_URL\}/);
  });
});
