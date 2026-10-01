// @vitest-environment node
/**
 * The first relaunch market (slab 9EPm..., token "Percolator", pumpswap pool Ebs3m...), replayed
 * through the REAL keeper-register handler with its REAL creation transaction (devnet M1, captured
 * read-only) and the exact request its launch page sent. That request was recovered from the memo:
 * the memo text is sha256 of the canonical params + payload digest, and exactly one candidate
 * (below) reproduces it, so the test proves the memo, the signer, the InitMarket index and the
 * slab header all verify. What failed in production was the markets write: max_leverage 5.4 into
 * an integer column (Postgres 22P02), answered 500 six times, so the keeper never enrolled it.
 */
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { NextRequest } from "next/server";
import { PublicKey, VersionedTransaction } from "@solana/web3.js";

const prevNetwork = process.env.NEXT_PUBLIC_DEFAULT_NETWORK;
process.env.NEXT_PUBLIC_DEFAULT_NETWORK = "devnet";
afterAll(() => {
  process.env.NEXT_PUBLIC_DEFAULT_NETWORK = prevNetwork;
});

const SLAB = "9EPm8nB8Fs7WcEZgE1WGFPTGc6rAzD6GhFJyMm4dEFHn";
const WRAPPER = "ETDLAdiAyWnEUngspYczTXUceT6X8f92eZQvr8nmSkWB";
const POOL = "Ebs3mXAzqZfzHfsdinTNw7gPy4uNyEAywcCiJxzLRrBW";
const CA = "8PzFWyLpCVEmbZmVJcaRTU5r69XKJx1rd7YGpWvnpump";
const CREATOR = "9sM73A4MvS2ye2Fuvpr1tmkj68iA61eebuRKz1rnGUWa";
/** The exact request the launch page sent (recovered from the memo, see header). */
const REQUEST = {
  slabAddress: SLAB,
  mainnetCA: CA,
  dexPoolAddress: POOL,
  dexType: "pumpswap",
  symbol: "Percolator",
  payload: {
    decimals: 6,
    initial_price_e6: "3451",
    lp_collateral: "2200000000",
    max_leverage: 5.4,
    mint_address: "DJ54k4wH92NTtNP8RuHAwG8si1bevXEknzctDdqYN8eC",
    name: "Percolator",
    oracle_authority: "FF7KFfU5Bb3Mze2AasDHCCZuyhdaSLjUZy2K3JvjdB7x",
    oracle_mode: "keeper",
    symbol: "Percolator",
    trading_fee_bps: 5,
  },
  proofTx: "2U4TFzSboHomgWAo1REiwVMC6jA8BZR77VdeNBChnE4NvSDsghA1Bg59oJ3fP6Gzk4FTv6THAJANRoYwV5Q1PRbY",
};
/** First 64 bytes of the live slab (read-only getAccountInfo, dataSlice 0..64): v18 market header. */
const SLAB_HEADER = Buffer.from("ADYxVkNSRVASAAEAAAAAAOI8MA5ARGOqDWgmiHD2uV5kOWd/r0u3ra2Er7Zvz1Vitqu2b++i9KylVtMJAKf0jQ==", "base64");

const fixture = JSON.parse(readFileSync(join(__dirname, "..", "fixtures", "relaunch", "9EPm.m1.tx.json"), "utf8")) as { txBase64: string; err: unknown };
const realTx = () => {
  const vtx = VersionedTransaction.deserialize(Buffer.from(fixture.txBase64, "base64"));
  return { meta: { err: fixture.err }, transaction: { message: vtx.message, signatures: vtx.signatures } };
};

const h = vi.hoisted(() => ({ existing: null as Record<string, unknown> | null, written: null as Record<string, unknown> | null, op: "" }));
const blobPut = vi.fn(async () => ({ url: "https://blob.invalid/x" }));

vi.mock("@vercel/blob", () => ({ put: blobPut, list: vi.fn(async () => ({ blobs: [] })), head: vi.fn(async () => null), del: vi.fn(async () => undefined) }));
vi.mock("@sentry/nextjs", () => ({ captureException: vi.fn(), captureMessage: vi.fn() }));
vi.mock("@/lib/token-logo", () => ({ resolveTokenLogo: async () => null }));
vi.mock("@/lib/dex-pool-owner", async (orig) => ({ ...(await orig<object>()), classifyPoolsByOwner: vi.fn(async () => ({ [POOL]: "pumpswap" })) }));
vi.mock("@/lib/server-rpc", () => ({
  getServerConnection: () => ({
    getAccountInfo: async (pk: PublicKey) => (pk.toBase58() === SLAB ? { owner: new PublicKey(WRAPPER), data: SLAB_HEADER } : null),
    getTransaction: async () => realTx(),
  }),
}));
/** Postgres-faithful on the integer columns (a fraction is 22P02, verified on the live DB). */
vi.mock("@/lib/supabase", () => {
  const reject = (p: Record<string, unknown>) =>
    ["decimals", "max_leverage", "trading_fee_bps"].some((k) => typeof p[k] === "number" && !Number.isInteger(p[k] as number))
      ? { code: "22P02", message: "invalid input syntax for type integer" }
      : null;
  return {
    getServerNetwork: () => "devnet",
    getServiceClient: () => ({
      from: () => ({
        select: () => ({ eq: () => ({ eq: () => ({ maybeSingle: async () => ({ data: h.existing, error: null }) }) }) }),
        insert: async (p: Record<string, unknown>) => {
          const e = reject(p);
          if (!e) {
            h.written = p;
            h.op = "insert";
          }
          return { error: e };
        },
        update: (p: Record<string, unknown>) => {
          const q: Record<string, unknown> = {
            eq: () => q,
            select: async () => {
              const e = reject(p);
              if (!e) {
                h.written = p;
                h.op = "update";
              }
              return { data: e ? null : [{ id: "1" }], error: e };
            },
          };
          return q;
        },
      }),
    }),
  };
});

const { POST } = await import("@/app/api/playground/keeper-register/route");
const { keeperMemoParams, keeperRegisterMemoText, verifyKeeperRegisterProofTx } = await import("@/lib/keeper-register-memo");

const post = (body: Record<string, unknown>) =>
  POST(new NextRequest("https://percolator-playground.vercel.app/api/playground/keeper-register", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) }));

beforeEach(() => {
  h.existing = null;
  h.written = null;
  h.op = "";
  blobPut.mockClear();
});

describe("9EPm: the real creation transaction registers", () => {
  it("the recovered request reproduces the on-chain memo, and the proof verifies to the creator", async () => {
    const params = await keeperMemoParams(REQUEST);
    expect(await keeperRegisterMemoText(params)).toBe("percolator:keeper-register:v2:tFP4sUB_HGR5CkG8OGivmOXTuPHFzVdjLhs6lQJUpVs");
    const v = await verifyKeeperRegisterProofTx(realTx() as never, params, WRAPPER);
    expect(v).toEqual({ ok: true, creator: CREATOR });
  });

  it("registers: active, manual, the pool + CA written, leverage stored as 5; the keeper blob written", async () => {
    const res = await post(REQUEST);
    const body = (await res.json()) as Record<string, unknown>;
    expect(res.status).toBe(200);
    expect(body).toMatchObject({ ok: true, registered: true, dexType: "pumpswap" });
    expect(h.op).toBe("insert");
    expect(h.written).toMatchObject({
      slab_address: SLAB,
      keeper_status: "active",
      metadata_source: "manual",
      dex_pool_address: POOL,
      mainnet_ca: CA,
      symbol: "Percolator",
      oracle_mode: "admin",
      max_leverage: 5,
      trading_fee_bps: 5,
      deployer: CREATOR,
    });
    expect(blobPut).toHaveBeenCalledTimes(1);
  });

  it("the production state (the indexer's 'auto' row, keeper_status retired) is taken over", async () => {
    h.existing = { id: "6b3346de", metadata_source: "auto", dex_pool_address: null, mainnet_ca: null, keeper_status: "retired" };
    const res = await post(REQUEST);
    expect(res.status).toBe(200);
    expect(h.op).toBe("update");
    expect(h.written).toMatchObject({ keeper_status: "active", metadata_source: "manual", dex_pool_address: POOL, max_leverage: 5 });
  });

  it("NEGATIVE CONTROL: a payload that differs from what the memo bound is refused (no write)", async () => {
    const res = await post({ ...REQUEST, payload: { ...REQUEST.payload, max_leverage: 5 } });
    expect(res.status).toBe(403);
    expect(h.written).toBeNull();
  });
});
