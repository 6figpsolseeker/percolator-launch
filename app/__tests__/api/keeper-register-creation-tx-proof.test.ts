// @vitest-environment node
/**
 * UX WP-7 AC3 at the ROUTE (SECURITY REVIEW REQUIRED before merge): POST
 * /api/playground/keeper-register authenticates with the market-creation transaction (proofTx),
 * not a signed message. Driving the real handler with a mocked devnet connection:
 *  - no proofTx -> 400; a signed-message body (deployer + signature, the removed H1v2 path) is
 *    NOT accepted any more -> 400;
 *  - the creator's M1 with the matching memo -> passes auth (reaches the pool classification);
 *  - a stranger's memo tx, a memo for another pool, a missing tx -> refused (403 / 409), no write.
 * Security review 2026-09-30 (FIX-FIRST) additions:
 *  - L-1: the slab must be owned by THIS wrapper and carry a v18 market header;
 *  - L-2: a malformed proofTx is refused before any RPC call, and nothing reaches the logo lookup
 *    unless auth passed;
 *  - I-1: only the keeper's dex vocabulary is accepted.
 */
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { Keypair, PublicKey, Transaction } from "@solana/web3.js";
import bs58 from "bs58";

const prevNetwork = process.env.NEXT_PUBLIC_DEFAULT_NETWORK;
process.env.NEXT_PUBLIC_DEFAULT_NETWORK = "devnet";
afterAll(() => {
  process.env.NEXT_PUBLIC_DEFAULT_NETWORK = prevNetwork;
});

const h = vi.hoisted(() => ({ tx: null as unknown, programId: "", slabOwner: "", slabData: null as Buffer | null, rpcCalls: 0, logoCalls: 0 }));
const blobPut = vi.fn(async () => ({ url: "https://blob.invalid/x" }));

vi.mock("@vercel/blob", () => ({ put: blobPut, list: vi.fn(async () => ({ blobs: [] })), head: vi.fn(async () => null), del: vi.fn(async () => undefined) }));
vi.mock("@lib/supabase", () => ({}));
vi.mock("@/lib/supabase", () => ({
  getServerNetwork: () => "devnet",
  getServiceClient: () => ({ from: () => ({ upsert: vi.fn(async () => ({ error: null })), select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: null, error: null }) }) }) }) }),
}));
vi.mock("@sentry/nextjs", () => ({ captureException: vi.fn(), captureMessage: vi.fn() }));
vi.mock("@/lib/config", async (orig) => {
  const m = await orig<{ getConfig: () => Record<string, unknown> }>();
  return { ...m, getConfig: () => ({ ...m.getConfig(), programId: h.programId }) };
});
vi.mock("@/lib/token-logo", () => ({ resolveTokenLogo: async () => { h.logoCalls++; return null; } }));
vi.mock("@/lib/server-rpc", () => ({
  getServerConnection: () => ({
    getAccountInfo: async (pk: PublicKey) => {
      h.rpcCalls++;
      return pk.toBase58() === SLAB_KP.publicKey.toBase58() ? { owner: new PublicKey(h.slabOwner || h.programId), data: h.slabData ?? V18_MARKET_HEADER } : null;
    },
    getTransaction: async () => {
      h.rpcCalls++;
      return h.tx;
    },
  }),
}));

/** A v18 wrapper market account header: magic "PERCV16\0" u64 LE, version 18, kind 1. */
const V18_MARKET_HEADER = (() => {
  const b = Buffer.alloc(64);
  b.writeBigUInt64LE(0x5045_5243_5631_3600n, 0);
  b.writeUInt16LE(18, 8);
  b[10] = 1;
  return b;
})();
const SIG = bs58.encode(new Uint8Array(64).fill(3));
// Past auth the route classifies the pool on mainnet: stop there, deterministically.
vi.mock("@/lib/dex-pool-owner", async (orig) => ({ ...(await orig<object>()), classifyPoolsByOwner: vi.fn(async () => new Map()) }));

const { buildM1Instructions } = await import("@/lib/create-market-m1");
const { buildBatchTx } = await import("@/lib/tx");
const { buildKeeperRegisterMemoIx, keeperMemoParams } = await import("@/lib/keeper-register-memo");
const { buildV17InitMarketArgs } = await import("@/lib/create-market-args");
const { deriveMarketParams } = await import("@/lib/market-params");
const { POST } = await import("@/app/api/playground/keeper-register/route");

const SLAB_KP = Keypair.generate();
const CREATOR = Keypair.generate();
const POOL = "LBUZKhRxPF3XUpBCjp4YzTKgLccjZhTSDM9YuVaPwxo";
const REQ = { slabAddress: SLAB_KP.publicKey.toBase58(), dexPoolAddress: POOL, mainnetCA: null, dexType: "meteora-dlmm", symbol: "TEST" };

function landed(tx: Transaction) {
  const msg = tx.compileMessage();
  return {
    meta: { err: null },
    transaction: {
      message: {
        staticAccountKeys: msg.accountKeys,
        header: msg.header,
        compiledInstructions: msg.instructions.map((ix) => ({ programIdIndex: ix.programIdIndex, accountKeyIndexes: ix.accounts, data: Buffer.from(bs58.decode(ix.data)) })),
      },
    },
  };
}

async function creatorM1(pool = POOL, signer = CREATOR) {
  const derived = deriveMarketParams(5, 1_000_000_000n, 1_000_000n);
  const k = () => Keypair.generate().publicKey;
  const ixs = buildM1Instructions({
    programId: new PublicKey(h.programId), wallet: signer.publicKey, slab: SLAB_KP.publicKey, mint: k(), vaultAta: k(), vaultPda: k(), nftRegistry: k(),
    slabRent: 1, slabSize: 3675, initArgs: buildV17InitMarketArgs({ initialPriceE6: 1_000_000n, tradingFeeBps: 30 }, derived),
    memo: await buildKeeperRegisterMemoIx(signer.publicKey, await keeperMemoParams({ ...REQ, dexPoolAddress: pool })),
  });
  const tx = buildBatchTx({ instructions: ixs, computeUnits: 400_000, priorityFeeMicroLamports: 1, blockhash: "11111111111111111111111111111111", feePayer: signer.publicKey });
  tx.sign(signer, SLAB_KP);
  return tx;
}

const post = (body: Record<string, unknown>) =>
  POST(new NextRequest("http://localhost/api/playground/keeper-register", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ ...REQ, ...body }) }));

describe("keeper-register authenticates with the creation transaction", () => {
  beforeEach(() => {
    h.programId = Keypair.generate().publicKey.toBase58();
    h.slabOwner = "";
    h.slabData = null;
    h.tx = null;
    h.rpcCalls = 0;
    h.logoCalls = 0;
    blobPut.mockClear();
  });

  it("no proofTx -> 400; the removed signed-message body is not accepted", async () => {
    expect((await post({})).status).toBe(400);
    const r = await post({ deployer: CREATOR.publicKey.toBase58(), signature: Buffer.alloc(64, 7).toString("base64") });
    expect(r.status).toBe(400);
    expect(((await r.json()) as { error: string }).error).toMatch(/proofTx/);
    expect(blobPut).not.toHaveBeenCalled();
  });

  it("the creator's M1 with the matching memo passes auth (the route moves on to the pool check)", async () => {
    h.tx = landed(await creatorM1());
    const r = await post({ proofTx: SIG });
    const body = (await r.json()) as { error?: string };
    expect([401, 403, 409]).not.toContain(r.status);
    expect(body.error ?? "").not.toMatch(/proof|proofTx/i);
  });

  it("NEGATIVE: a memo for another pool (repointing) -> 403, nothing written", async () => {
    h.tx = landed(await creatorM1(Keypair.generate().publicKey.toBase58()));
    const r = await post({ proofTx: SIG });
    expect(r.status).toBe(403);
    expect(blobPut).not.toHaveBeenCalled();
  });

  it("NEGATIVE: a stranger's memo tx (no InitMarket; the junior-owner path is gone) -> 403", async () => {
    const stranger = Keypair.generate();
    const tx = new Transaction({ feePayer: stranger.publicKey, recentBlockhash: "11111111111111111111111111111111" }).add(
      await buildKeeperRegisterMemoIx(stranger.publicKey, await keeperMemoParams(REQ)),
    );
    tx.sign(stranger);
    h.tx = landed(tx);
    expect((await post({ proofTx: SIG })).status).toBe(403);
    expect(blobPut).not.toHaveBeenCalled();
  });

  it("not landed yet -> 409 (the client's backoff retries it)", async () => {
    h.tx = null;
    expect((await post({ proofTx: SIG })).status).toBe(409);
  });

  it("L-2: a malformed proofTx -> 400 with NO RPC call and no logo lookup", async () => {
    for (const bad of ["sig", "the-creators-public-m1-signature", bs58.encode(new Uint8Array(32).fill(1)), 12345]) {
      const r = await post({ proofTx: bad, mainnetCA: Keypair.generate().publicKey.toBase58() });
      expect(r.status, String(bad)).toBe(400);
    }
    expect(h.rpcCalls).toBe(0);
    expect(h.logoCalls).toBe(0);
  });

  it("L-2: a refused proof never reaches the third-party logo lookup", async () => {
    const ca = Keypair.generate().publicKey.toBase58();
    h.tx = landed(await creatorM1(Keypair.generate().publicKey.toBase58()));
    expect((await post({ proofTx: SIG, mainnetCA: ca })).status).toBe(403);
    expect(h.logoCalls).toBe(0);
  });

  it("L-1: a slab owned by another program (a sibling) -> 400", async () => {
    h.tx = landed(await creatorM1());
    h.slabOwner = Keypair.generate().publicKey.toBase58();
    const r = await post({ proofTx: SIG });
    expect(r.status).toBe(400);
    expect(((await r.json()) as { error: string }).error).toMatch(/not a market of this deployment/);
  });

  it("L-1: a wrapper-owned account that is not a v18 market (bad header) -> 400", async () => {
    h.tx = landed(await creatorM1());
    for (const data of [Buffer.alloc(8), Buffer.alloc(64), (() => { const b = Buffer.from(V18_MARKET_HEADER); b[10] = 2; return b; })()]) {
      h.slabData = data;
      const r = await post({ proofTx: SIG });
      expect(r.status).toBe(400);
      expect(((await r.json()) as { error: string }).error).toMatch(/not a market of this deployment/);
    }
    expect(blobPut).not.toHaveBeenCalled();
  });

  it("I-1: a dexType outside the keeper's vocabulary -> 400 before any RPC", async () => {
    expect((await post({ proofTx: SIG, dexType: "meteora" })).status).toBe(400);
    expect(h.rpcCalls).toBe(0);
  });
});
