// @vitest-environment node
/**
 * REGRESSION (security review 2026-09-30, WP-7 M-1 / M-2): the reviewer's PoC
 * (sentinel-wp7-replay-poc) made permanent. A creation-tx proof is PUBLIC, so a stranger can
 * replay it; this suite pins what a replay can and cannot do:
 *  1. the PoC itself: the creator's public M1 + a crafted payload (name "Official SOL Perp",
 *     stranger oracle_authority / mint, 100x, 0 bps) -> REFUSED (403), nothing written;
 *  2. an exact replay (the creator's own payload) over the creator-registered ('manual') row ->
 *     200 but NO database write: the row stays as registered, keeper_status is not touched;
 *  3. an exact replay over a row a maintainer RETIRED -> 403, no database write, no blob write;
 *  4. an exact replay whose pool differs from the row's existing pool -> 422 (final), no write
 *     (first proof-registered binding wins);
 *  5. the indexer's 'auto' row IS replaced by the creator's registration (the reason this route
 *     writes at all), with every value from the memo-bound payload.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { Keypair, PublicKey } from "@solana/web3.js";
import bs58 from "bs58";

process.env.NEXT_PUBLIC_DEFAULT_NETWORK = "devnet";
const h = vi.hoisted(() => ({
  tx: null as unknown,
  programId: "",
  existing: null as null | Record<string, unknown>,
  writes: [] as Array<{ op: string; payload: Record<string, unknown>; guard?: string }>,
}));
const blobUpsert = vi.fn(async () => undefined);
vi.mock("@/lib/playground-registered-markets", () => ({ upsertRegisteredMarket: blobUpsert }));
vi.mock("@/lib/token-logo", () => ({ resolveTokenLogo: async () => null }));
vi.mock("@/lib/supabase", () => ({
  getServerNetwork: () => "devnet",
  getServiceClient: () => ({
    from: () => ({
      select: () => ({ eq: () => ({ eq: () => ({ maybeSingle: async () => ({ data: h.existing, error: null }) }) }) }),
      update: (p: Record<string, unknown>) => {
        h.writes.push({ op: "update", payload: p });
        const q: Record<string, unknown> = {
          eq: (col: string, v: unknown) => {
            if (col === "metadata_source") h.writes[h.writes.length - 1]!.guard = String(v);
            return q;
          },
          select: async () => ({ data: [{ id: 1 }], error: null }),
          then: (res: (v: unknown) => void) => res({ error: null }),
        };
        return q;
      },
      insert: async (p: Record<string, unknown>) => {
        h.writes.push({ op: "insert", payload: p });
        return { error: null };
      },
    }),
  }),
}));
vi.mock("@sentry/nextjs", () => ({ captureException: vi.fn(), captureMessage: vi.fn() }));
vi.mock("@/lib/config", async (orig) => {
  const m = await orig<{ getConfig: () => Record<string, unknown> }>();
  return { ...m, getConfig: () => ({ ...m.getConfig(), programId: h.programId }) };
});
const HEADER = (() => {
  const b = Buffer.alloc(64);
  b.writeBigUInt64LE(0x5045_5243_5631_3600n, 0);
  b.writeUInt16LE(18, 8);
  b[10] = 1;
  return b;
})();
vi.mock("@/lib/server-rpc", () => ({
  getServerConnection: () => ({
    getAccountInfo: async (pk: PublicKey) => (pk.toBase58() === SLAB_KP.publicKey.toBase58() ? { owner: new PublicKey(h.programId), data: HEADER } : null),
    getTransaction: async () => h.tx,
  }),
}));
const POOL = "LBUZKhRxPF3XUpBCjp4YzTKgLccjZhTSDM9YuVaPwxo";
vi.mock("@/lib/dex-pool-owner", async (orig) => ({ ...(await orig<object>()), classifyPoolsByOwner: vi.fn(async () => ({ [POOL]: "meteora-dlmm" })) }));

const { buildM1Instructions } = await import("@/lib/create-market-m1");
const { buildBatchTx } = await import("@/lib/tx");
const { buildKeeperRegisterMemoIx, keeperMemoParams } = await import("@/lib/keeper-register-memo");
const { buildV17InitMarketArgs } = await import("@/lib/create-market-args");
const { deriveMarketParams } = await import("@/lib/market-params");
const { POST } = await import("@/app/api/playground/keeper-register/route");

const SLAB_KP = Keypair.generate();
const CREATOR = Keypair.generate();
const STRANGER = Keypair.generate();
const REQ = { slabAddress: SLAB_KP.publicKey.toBase58(), dexPoolAddress: POOL, mainnetCA: null, dexType: "meteora-dlmm", symbol: "TEST" };
/** The creator's markets-row payload (what the wizard's buildMarketRegistrationPayload sends). */
const CREATOR_PAYLOAD = {
  slab_address: SLAB_KP.publicKey.toBase58(),
  mint_address: "DJ54k4wH92NTtNP8RuHAwG8si1bevXEknzctDdqYN8eC",
  symbol: "TEST",
  name: "Test Token",
  decimals: 6,
  deployer: CREATOR.publicKey.toBase58(),
  oracle_mode: "keeper",
  dex_pool_address: POOL,
  oracle_authority: Keypair.generate().publicKey.toBase58(),
  initial_price_e6: "1000000",
  max_leverage: 5,
  trading_fee_bps: 30,
  lp_collateral: "1000000000",
  mainnet_ca: null,
};
const SIG = bs58.encode(new Uint8Array(64).fill(5));

async function creatorM1Landed() {
  const k = () => Keypair.generate().publicKey;
  const ixs = buildM1Instructions({
    programId: new PublicKey(h.programId), wallet: CREATOR.publicKey, slab: SLAB_KP.publicKey, mint: k(), vaultAta: k(), vaultPda: k(), nftRegistry: k(),
    slabRent: 1, slabSize: 3675, initArgs: buildV17InitMarketArgs({ initialPriceE6: 1_000_000n, tradingFeeBps: 30 }, deriveMarketParams(5, 1_000_000_000n, 1_000_000n)),
    memo: await buildKeeperRegisterMemoIx(CREATOR.publicKey, await keeperMemoParams({ ...REQ, payload: CREATOR_PAYLOAD })),
  });
  const tx = buildBatchTx({ instructions: ixs, computeUnits: 400_000, priorityFeeMicroLamports: 1, blockhash: "11111111111111111111111111111111", feePayer: CREATOR.publicKey });
  tx.sign(CREATOR, SLAB_KP);
  const msg = tx.compileMessage();
  return { meta: { err: null }, transaction: { message: { staticAccountKeys: msg.accountKeys, header: msg.header,
    compiledInstructions: msg.instructions.map((ix) => ({ programIdIndex: ix.programIdIndex, accountKeyIndexes: ix.accounts, data: Buffer.from(bs58.decode(ix.data)) })) } } };
}

/** The stranger sends NO header / secret: only the public signature and public row fields. */
const replay = (payload: Record<string, unknown>, extra: Record<string, unknown> = {}) =>
  POST(new NextRequest("http://localhost/api/playground/keeper-register", {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ ...REQ, proofTx: SIG, payload, ...extra }),
  }));

describe("REGRESSION WP-7 M-1/M-2: a replayed public creation tx cannot rewrite a market", () => {
  beforeEach(async () => {
    h.programId = Keypair.generate().publicKey.toBase58();
    h.tx = await creatorM1Landed();
    h.writes = [];
    blobUpsert.mockClear();
  });

  it("1. the reviewer's PoC: a crafted payload is REFUSED and nothing is written", async () => {
    h.existing = { id: 1, metadata_source: "manual", dex_pool_address: POOL, mainnet_ca: null, keeper_status: "active" };
    const r = await replay({
      name: "Official SOL Perp", symbol: "SOL", oracle_authority: STRANGER.publicKey.toBase58(),
      mint_address: STRANGER.publicKey.toBase58(), decimals: 9, max_leverage: 100, trading_fee_bps: 0,
    });
    expect(r.status).toBe(403);
    expect(h.writes).toEqual([]);
    expect(blobUpsert).not.toHaveBeenCalled();
    // One field changed is enough to be refused.
    for (const tweak of [{ name: "Official SOL Perp" }, { max_leverage: 100 }, { trading_fee_bps: 0 }, { oracle_authority: STRANGER.publicKey.toBase58() }]) {
      expect((await replay({ ...CREATOR_PAYLOAD, ...tweak })).status, JSON.stringify(tweak)).toBe(403);
    }
    expect(h.writes).toEqual([]);
  });

  it("2. an exact replay over the creator-registered row: 200, NO database write, keeper_status untouched", async () => {
    h.existing = { id: 1, metadata_source: "manual", dex_pool_address: POOL, mainnet_ca: null, keeper_status: "active" };
    const r = await replay(CREATOR_PAYLOAD);
    expect(r.status).toBe(200);
    expect(h.writes).toEqual([]);
  });

  it("3. an exact replay cannot re-enroll a market a maintainer retired (403, no writes, no blob)", async () => {
    h.existing = { id: 1, metadata_source: "manual", dex_pool_address: POOL, mainnet_ca: null, keeper_status: "retired" };
    const r = await replay(CREATOR_PAYLOAD);
    expect(r.status).toBe(403);
    expect(h.writes).toEqual([]);
    expect(blobUpsert).not.toHaveBeenCalled();
  });

  it("4. a row that already has another pool keeps it (422, final: the client shows the reason, no retry loop)", async () => {
    h.existing = { id: 1, metadata_source: "manual", dex_pool_address: Keypair.generate().publicKey.toBase58(), mainnet_ca: null, keeper_status: "active" };
    const r = await replay(CREATOR_PAYLOAD);
    expect(r.status).toBe(422);
    expect(((await r.json()) as { error: string }).error).toMatch(/different price source/);
    expect(h.writes).toEqual([]);
    expect(blobUpsert).not.toHaveBeenCalled();
  });

  it("5. the indexer's 'auto' row IS replaced by the creator's (memo-bound) registration", async () => {
    h.existing = { id: 1, metadata_source: "auto", dex_pool_address: null, mainnet_ca: null, keeper_status: "retired" };
    const r = await replay(CREATOR_PAYLOAD);
    expect(r.status).toBe(200);
    expect(h.writes).toHaveLength(1);
    expect(h.writes[0]!.guard).toBe("auto");
    expect(h.writes[0]).toMatchObject({
      op: "update",
      payload: { name: "Test Token", symbol: "TEST", max_leverage: 5, trading_fee_bps: 30, oracle_authority: CREATOR_PAYLOAD.oracle_authority, deployer: CREATOR.publicKey.toBase58(), dex_pool_address: POOL, metadata_source: "manual", keeper_status: "active" },
    });
  });

  it("no row yet: the first registration inserts it", async () => {
    h.existing = null;
    expect((await replay(CREATOR_PAYLOAD)).status).toBe(200);
    expect(h.writes.map((w) => w.op)).toEqual(["insert"]);
  });
});
