// @vitest-environment node
/**
 * UX WP-10 (audit FA-1 S0 / AC1, AC3): /api/playground/faucet sends SOL from the SERVER wallet
 * (env check only) when the public devnet airdrop fails, and no response ever names an env var.
 * Harness mirrors playground-faucet-claim-release.test.ts (the real handler, mocked I/O).
 */
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
  grantServerSol: vi.fn(),
  requestAirdrop: vi.fn(),
  getBalance: vi.fn(),
}));

vi.mock("@/lib/server-sol-faucet", () => ({
  grantServerSol: (...a: unknown[]) => mocks.grantServerSol(...a),
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
  // The PUBLIC devnet airdrop fails (rate-limited), as it usually does.
  class Connection {
    requestAirdrop = (...a: unknown[]) => mocks.requestAirdrop(...a);
  }
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
    getBalance: mocks.getBalance,
  });
  mocks.requestAirdrop.mockRejectedValue(new Error("429 Too Many Requests: airdrop limit"));
  mocks.getBalance.mockResolvedValue(0);
  mocks.grantServerSol.mockResolvedValue({ status: "skipped", reason: "disabled" });

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


/** Env var names never reach a caller (UX WP-10 AC3). */
const ENV_NAME = /\b[A-Z][A-Z0-9]*_[A-Z0-9_]{3,}\b/;

describe("UX WP-10 AC1: SOL from the server wallet when the public airdrop fails", () => {
  it("server grant sent: one click funds the top-up (public airdrop never needed); the true amount is reported", async () => {
    mocks.grantServerSol.mockResolvedValue({ status: "sent", signature: "server-sol-sig", lamports: 50_000_000 });
    const res = await POST(createRequest());
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body).toMatchObject({ funded: true, sol_airdropped: true, sol_source: "server", sol_sig: "server-sol-sig", sol_amount: 0.05 });
    expect(mocks.grantServerSol).toHaveBeenCalledTimes(1);
    expect(mocks.requestAirdrop).not.toHaveBeenCalled();
  });
  it("already has enough: nothing sent, sol_amount 0", async () => {
    mocks.grantServerSol.mockResolvedValue({ status: "funded", lamports: 0 });
    const body = await (await POST(createRequest())).json();
    expect(body).toMatchObject({ sol_airdropped: true, sol_amount: 0 });
    expect(mocks.requestAirdrop).not.toHaveBeenCalled();
  });
  it("L-1: a pending server send is never topped up again from the public airdrop", async () => {
    mocks.grantServerSol.mockResolvedValue({ status: "pending", signature: "p-sig" });
    const body = await (await POST(createRequest())).json();
    expect(body).toMatchObject({ sol_pending: true, sol_airdropped: false });
    expect(mocks.requestAirdrop).not.toHaveBeenCalled();
  });
  it("NEGATIVE CONTROL (server skipped: disabled / budget / limits): the public airdrop is tried, which fails -> no SOL", async () => {
    for (const reason of ["disabled", "budget", "ip-limit"]) {
      mocks.grantServerSol.mockResolvedValue({ status: "skipped", reason });
      mocks.requestAirdrop.mockClear();
      const body = await (await POST(createRequest())).json();
      expect(body.sol_airdropped, reason).toBe(false);
      expect(mocks.requestAirdrop).toHaveBeenCalled();
      expect(JSON.stringify(body)).not.toMatch(ENV_NAME);
    }
  });
});

describe("UX WP-10 AC3: no env var names in faucet responses", () => {
  it("not configured, mint failure, and an unexpected throw all answer in plain words", async () => {
    mocks.getDevnetMintSigner.mockReturnValue(null);
    const a = await (await POST(createRequest())).json();
    expect(JSON.stringify(a)).not.toMatch(ENV_NAME);
    expect(a.error).toBe("The faucet isn't available right now. Try again later.");

    mocks.getDevnetMintSigner.mockReturnValue({ publicKey: () => "11111111111111111111111111111111", signTransaction: (tx: unknown) => tx });
    mocks.sendRawTransaction.mockRejectedValue(new Error("DEVNET_MINT_AUTHORITY_KEYPAIR is not the mint authority"));
    const b = await (await POST(createRequest())).json();
    expect(JSON.stringify(b)).not.toMatch(ENV_NAME);

    mocks.getServerConnection.mockImplementation(() => {
      throw new Error("DEVNET_RPC_URL is not set");
    });
    const c = await (await POST(createRequest())).json();
    expect(JSON.stringify(c)).not.toMatch(ENV_NAME);
    expect(c.error).toBe("Something went wrong and nothing was sent. Try again in a moment.");
  });
  it("no response literal in either faucet route names an env var", async () => {
    const { readFileSync } = await import("node:fs");
    for (const f of ["app/api/playground/faucet/route.ts", "app/api/faucet/route.ts"]) {
      const src = readFileSync(`${process.cwd()}/${f}`, "utf8").replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
      const bodies = src.match(/NextResponse\.json\(\s*\{[\s\S]*?\}\s*,/g) ?? [];
      for (const b of bodies) expect(b.replace(/process\.env\.\w+/g, ""), f).not.toMatch(/"[^"\n]*\b[A-Z][A-Z0-9]*_[A-Z0-9_]{3,}\b[^"\n]*"/);
    }
  });
});
