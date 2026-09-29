import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

/**
 * keeper-register must refuse a PumpSwap/Meteora pool quoted in a mint the
 * keeper can't turn into USD (COLLECT/CARDS, Murphy/DOGE), using the pool bytes
 * it already fetched to classify the owner, and write nothing. WSOL/USD-quoted
 * pools pass. Runs the admin path, so only the mainnet pool read is mocked.
 */
const h = vi.hoisted(() => ({
  pool: null as null | { owner: string; data: Uint8Array },
  rowWrites: 0,
  blobWrites: 0,
}));

process.env.NEXT_PUBLIC_DEFAULT_NETWORK = "devnet";
process.env.ADMIN_API_SECRET = "quote-mint-test-secret";

vi.mock("@solana/web3.js", async (importOriginal) => {
  const real = await importOriginal<typeof import("@solana/web3.js")>();
  class Connection {
    async getAccountInfo() {
      if (!h.pool) return null;
      return { owner: new real.PublicKey(h.pool.owner), data: Buffer.from(h.pool.data) };
    }
  }
  return { ...real, Connection };
});
vi.mock("@/lib/market-registration", () => ({
  upsertRegisteredMarketRow: vi.fn(async () => {
    h.rowWrites++;
    return { ok: true };
  }),
}));
vi.mock("@/lib/playground-registered-markets", () => ({
  upsertRegisteredMarket: vi.fn(async () => {
    h.blobWrites++;
  }),
}));
vi.mock("@/lib/supabase", () => ({ getServerNetwork: () => "devnet", getServiceClient: () => ({}) }));
vi.mock("@sentry/nextjs", () => ({ captureMessage: vi.fn(), captureException: vi.fn() }));

const { POST } = await import("@/app/api/playground/keeper-register/route");
const { Keypair, PublicKey } = await import("@solana/web3.js");

const PUMPSWAP = "pAMMBay6oceH9fJKBRHGP5D4bD4sWpmSwMn52FMfXEA";
const METEORA = "LBUZKhRxPF3XUpBCjp4YzTKgLccjZhTSDM9YuVaPwxo";
const RAYDIUM = "CAMMCzo5YL8w4VFF8KVHrK22GGUsp5VTaW7grrKgrWqK";
const WSOL = "So11111111111111111111111111111111111111112";
const USDC = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";
const CARDS = "CARDSccUMFKoPRZxt5vt3ksUbxEFEcnZ3H2pd3dKxYjp";

/** PumpSwap pool: base mint @43, quote mint @75, vaults @139/@171. */
function pumpswapPool(quote: string): Uint8Array {
  const d = Buffer.alloc(301);
  Keypair.generate().publicKey.toBuffer().copy(d, 43);
  new PublicKey(quote).toBuffer().copy(d, 75);
  Keypair.generate().publicKey.toBuffer().copy(d, 139);
  Keypair.generate().publicKey.toBuffer().copy(d, 171);
  return d;
}

/** Meteora DLMM pool: token X @88, token Y (quote) @120. */
function meteoraPool(quote: string): Uint8Array {
  const d = Buffer.alloc(904);
  Keypair.generate().publicKey.toBuffer().copy(d, 88);
  new PublicKey(quote).toBuffer().copy(d, 120);
  return d;
}

async function register(owner: string, data: Uint8Array) {
  h.pool = { owner, data };
  const res = await POST(
    new NextRequest("http://localhost/api/playground/keeper-register", {
      method: "POST",
      headers: { "content-type": "application/json", "x-admin-secret": "quote-mint-test-secret" },
      body: JSON.stringify({
        slabAddress: Keypair.generate().publicKey.toBase58(),
        dexPoolAddress: Keypair.generate().publicKey.toBase58(),
        dexType: "pumpswap",
        symbol: "TEST",
        deployer: Keypair.generate().publicKey.toBase58(),
      }),
    }),
  );
  return { status: res.status, body: (await res.json()) as { error?: string } };
}

beforeEach(() => {
  h.rowWrites = 0;
  h.blobWrites = 0;
});

describe("keeper-register refuses pools the keeper can't price in USD", () => {
  it.each([
    ["PumpSwap", PUMPSWAP, pumpswapPool],
    ["Meteora DLMM", METEORA, meteoraPool],
  ])("%s pool quoted in CARDS: 400 naming the mint, nothing written", async (_n, owner, build) => {
    const { status, body } = await register(owner, build(CARDS));
    expect(status).toBe(400);
    expect(body.error).toContain(CARDS);
    expect(h.rowWrites).toBe(0);
    expect(h.blobWrites).toBe(0);
  });

  it.each([
    ["PumpSwap / WSOL", PUMPSWAP, pumpswapPool, WSOL],
    ["PumpSwap / USDC", PUMPSWAP, pumpswapPool, USDC],
    ["Meteora DLMM / WSOL", METEORA, meteoraPool, WSOL],
  ])("%s pool is registered", async (_n, owner, build, quote) => {
    const { status } = await register(owner, build(quote));
    expect(status).toBe(200);
    expect(h.rowWrites).toBe(1);
  });

  it("a truncated pool account is refused as unsupported, not waved through", async () => {
    const { status, body } = await register(PUMPSWAP, new Uint8Array(100));
    expect(status).toBe(400);
    expect(body.error).toMatch(/unsupported DEX program/);
    expect(h.rowWrites).toBe(0);
  });

  it("Raydium keeps its own refusal message", async () => {
    const { status, body } = await register(RAYDIUM, new Uint8Array(1544));
    expect(status).toBe(400);
    expect(body.error).toMatch(/Raydium pools are not supported/);
  });
});
