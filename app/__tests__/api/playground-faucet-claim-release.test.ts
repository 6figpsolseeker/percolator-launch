/**
 * GH#2600 — /api/playground/faucet must give back the caller's 1h faucet claim
 * when a THROW between the gate succeeding and the mint section's own try/catch
 * leaves it funding nothing.
 *
 * `tryFaucetGate` is check-AND-reserve. The mint section already releases on its
 * own failure (untouched here — it is PR #2602's territory, refining what counts
 * as a "definite" mint failure). But getDevnetMintSigner(),
 * `new PublicKey(mintSigner.publicKey())`, `new PublicKey(SIM_USDC_MINT)`, and
 * getServerConnection() run BETWEEN the gate and that mint try/catch, unwrapped —
 * a THROW from any of them fell straight to the function's outer catch, which
 * never released. Same defect class as #2597.
 *
 * This drives the real handler, so it asserts behaviour rather than source text.
 */
// @vitest-environment node

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const mocks = vi.hoisted(() => ({
  confirmTransaction: vi.fn(),
  getLatestBlockhash: vi.fn(),
  sendRawTransaction: vi.fn(),

  getAssociatedTokenAddress: vi.fn(),
  getAccount: vi.fn(),

  getDevnetMintSigner: vi.fn(),
  getServerConnection: vi.fn(),

  tryFaucetGate: vi.fn(),
  releaseFaucetClaim: vi.fn(),

  captureException: vi.fn(),
}));

vi.mock("@solana/web3.js", () => {
  class PublicKey {
    constructor(private readonly value: unknown) {}
    toBase58(): string {
      return typeof this.value === "string" ? this.value : "11111111111111111111111111111111";
    }
  }
  class Transaction {
    instructions: unknown[] = [];
    add(...ix: unknown[]) { this.instructions.push(...ix); return this; }
    serialize(): Buffer { return Buffer.from([]); }
  }
  // Public devnet Connection used only for the best-effort SOL airdrop.
  // requestAirdrop is absent — the airdrop loop's own try/catch swallows it.
  class Connection {}
  class SendTransactionError extends Error {}
  return { Connection, PublicKey, Transaction, SendTransactionError, LAMPORTS_PER_SOL: 1_000_000_000 };
});

vi.mock("@solana/spl-token", () => ({
  getAssociatedTokenAddress: mocks.getAssociatedTokenAddress,
  createAssociatedTokenAccountInstruction: vi.fn(),
  createMintToInstruction: vi.fn(),
  getAccount: mocks.getAccount,
  TOKEN_PROGRAM_ID: { toBase58: () => "TokenProgram1111111111111111111111111111" },
}));

vi.mock("@/lib/devnet-signer", () => ({
  getDevnetMintSigner: (...a: unknown[]) => mocks.getDevnetMintSigner(...a),
}));

vi.mock("@/lib/server-rpc", () => ({
  getServerConnection: (...a: unknown[]) => mocks.getServerConnection(...a),
  // #2602: the route confirms by signature status, not confirmTransaction.
  confirmServerSignature: async (_c: unknown, sig: string) => sig,
  ServerSignatureExecutionError: class extends Error {},
  ServerSignatureTimeoutError: class extends Error {},
}));

vi.mock("@/lib/supabase", () => ({
  getServiceClient: () => ({ marker: "service-client" }),
}));

vi.mock("@/lib/faucet-rate-gate", () => ({
  tryFaucetGate: mocks.tryFaucetGate,
  releaseFaucetClaim: mocks.releaseFaucetClaim,
}));

vi.mock("@sentry/nextjs", () => ({
  captureException: mocks.captureException,
}));

function createRequest(): NextRequest {
  return new NextRequest("http://localhost/api/playground/faucet", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ wallet: "11111111111111111111111111111111" }),
  });
}

let POST: typeof import("@/app/api/playground/faucet/route").POST;

beforeEach(async () => {
  vi.resetModules();
  vi.clearAllMocks();

  process.env.NEXT_PUBLIC_DEFAULT_NETWORK = "devnet";
  delete process.env.NEXT_PUBLIC_SOLANA_NETWORK;

  mocks.tryFaucetGate.mockResolvedValue({ allowed: true, nextClaimAt: null, claimId: 77 });
  mocks.releaseFaucetClaim.mockResolvedValue(undefined);

  mocks.getDevnetMintSigner.mockReturnValue({
    publicKey: () => "11111111111111111111111111111111",
    signTransaction: (tx: unknown) => tx,
  });
  mocks.getServerConnection.mockReturnValue({
    confirmTransaction: mocks.confirmTransaction,
    getLatestBlockhash: mocks.getLatestBlockhash,
    sendRawTransaction: mocks.sendRawTransaction,
  });

  mocks.getAssociatedTokenAddress.mockResolvedValue({
    toBase58: () => "11111111111111111111111111111111",
  });
  mocks.getAccount.mockResolvedValue({});
  mocks.getLatestBlockhash.mockResolvedValue({ blockhash: "bh", lastValidBlockHeight: 1 });
  mocks.sendRawTransaction.mockResolvedValue("sig");
  mocks.confirmTransaction.mockResolvedValue({ context: { slot: 1 }, value: { err: null } });

  const route = await import("@/app/api/playground/faucet/route");
  POST = route.POST;
});

afterEach(() => {
  delete process.env.NEXT_PUBLIC_DEFAULT_NETWORK;
  delete process.env.NEXT_PUBLIC_SOLANA_NETWORK;
});

describe("GH#2600: /api/playground/faucet releases the claim on a THROW before the mint try/catch", () => {
  it("releases the claim when getDevnetMintSigner()'s public key is malformed", async () => {
    mocks.getDevnetMintSigner.mockReturnValue({
      publicKey: () => {
        throw new Error("sealed signer blew up");
      },
      signTransaction: (tx: unknown) => tx,
    });

    const res = await POST(createRequest());

    expect(res.status).toBe(500);
    expect(mocks.tryFaucetGate).toHaveBeenCalledTimes(1);
    expect(mocks.releaseFaucetClaim).toHaveBeenCalledWith(expect.anything(), 77);
    expect(mocks.sendRawTransaction).not.toHaveBeenCalled();
  });

  it("releases the claim when getServerConnection() throws", async () => {
    mocks.getServerConnection.mockImplementation(() => {
      throw new Error("no working devnet RPC configured");
    });

    const res = await POST(createRequest());

    expect(res.status).toBe(500);
    expect(mocks.releaseFaucetClaim).toHaveBeenCalledWith(expect.anything(), 77);
  });

  it("existing mint-section release still works (regression guard, untouched by this fix)", async () => {
    mocks.sendRawTransaction.mockRejectedValue(new Error("mint failed"));

    const res = await POST(createRequest());
    const body = await res.json();

    expect(res.status).toBe(503);
    // UX WP-10 AC3: a plain line, never the raw internal error.
    expect(body.error).toMatch(/couldn't send test USDC/i);
    expect(mocks.releaseFaucetClaim).toHaveBeenCalledWith(expect.anything(), 77);
  });

  it("CONTROL: a successful mint keeps the claim (no release)", async () => {
    const res = await POST(createRequest());
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.funded).toBe(true);
    expect(mocks.releaseFaucetClaim).not.toHaveBeenCalled();
  });

  it("CONTROL: a rate-limited wallet reserves nothing to leak", async () => {
    mocks.tryFaucetGate.mockResolvedValue({ allowed: false, nextClaimAt: "2026-01-01T00:00:00Z" });

    const res = await POST(createRequest());

    expect(res.status).toBe(429);
    expect(mocks.releaseFaucetClaim).not.toHaveBeenCalled();
    expect(mocks.sendRawTransaction).not.toHaveBeenCalled();
  });

  it("the release is best-effort — a cleanup failure does not crash the response", async () => {
    mocks.getServerConnection.mockImplementation(() => {
      throw new Error("no working devnet RPC configured");
    });
    mocks.releaseFaucetClaim.mockRejectedValue(new Error("supabase unavailable"));

    const res = await POST(createRequest());

    expect(res.status).toBe(500);
    expect(mocks.releaseFaucetClaim).toHaveBeenCalledTimes(1);
  });
});
