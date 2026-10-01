// @vitest-environment node
/**
 * Security review 2026-09-30 (WP-8..10) Info I-3 + L-1 at the ROUTE: /api/faucet type=sol with the
 * server wallet (lib/server-sol-faucet.ts grantServerSol, mocked here; its limits are tested in
 * __tests__/lib/server-sol-faucet.test.ts). Drives the real handler:
 *  - sent: 200 with the TRUE amount (0.05, not the public airdrop's 2) and the claim KEPT;
 *  - funded: 200, sol_amount 0, no public airdrop;
 *  - pending (L-1): 503 pending, the claim is KEPT (never released), no public airdrop;
 *  - skipped: the public airdrop path, unchanged.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { Keypair } from "@solana/web3.js";

const m = vi.hoisted(() => ({
  grant: vi.fn(),
  release: vi.fn(async () => undefined),
  requestAirdrop: vi.fn(),
  confirmTransaction: vi.fn(),
}));
vi.mock("@/lib/server-sol-faucet", () => ({ grantServerSol: (...a: unknown[]) => m.grant(...a), getSolFaucetSigner: () => ({}) }));
vi.mock("@/lib/fund-ip-rate-limit", () => ({ checkFundRateLimit: async () => ({ allowed: true, retryAfter: 0 }) }));
vi.mock("@/lib/supabase", () => ({ getServiceClient: () => ({ from: () => ({ insert: async () => ({ error: null }) }) }) }));
vi.mock("@/lib/faucet-rate-gate", () => ({ tryFaucetGate: async () => ({ allowed: true, nextClaimAt: null, claimId: 9 }), releaseFaucetClaim: m.release }));
vi.mock("@/lib/server-rpc", () => ({ getServerConnection: () => ({}) }));
vi.mock("@sentry/nextjs", () => ({ captureException: vi.fn() }));
vi.mock("@solana/web3.js", async (orig) => {
  const real = await orig<typeof import("@solana/web3.js")>();
  class Connection {
    requestAirdrop = (...a: unknown[]) => m.requestAirdrop(...a);
    confirmTransaction = (...a: unknown[]) => m.confirmTransaction(...a);
  }
  return { ...real, Connection };
});

process.env.NEXT_PUBLIC_DEFAULT_NETWORK = "devnet";
const { POST } = await import("@/app/api/faucet/route");
const req = () =>
  new NextRequest("http://localhost/api/faucet", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ wallet: Keypair.generate().publicKey.toBase58(), type: "sol" }) });

beforeEach(() => {
  m.grant.mockReset();
  m.release.mockClear();
  m.requestAirdrop.mockReset().mockRejectedValue(new Error("429 Too Many Requests: airdrop limit"));
});

describe("/api/faucet server SOL path", () => {
  it("sent: the true amount, the claim kept, no public airdrop", async () => {
    m.grant.mockResolvedValue({ status: "sent", signature: "srv", lamports: 50_000_000 });
    const res = await POST(req());
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body).toMatchObject({ funded: true, sol_airdropped: true, sol_source: "server", sol_amount: 0.05, signature: "srv" });
    expect(m.release).not.toHaveBeenCalled();
    expect(m.requestAirdrop).not.toHaveBeenCalled();
  });
  it("funded: nothing sent, sol_amount 0, and (re-review I-C) the wallet's claim is given back", async () => {
    m.grant.mockResolvedValue({ status: "funded", lamports: 0 });
    const body = await (await POST(req())).json();
    expect(body).toMatchObject({ funded: true, sol_airdropped: false, sol_amount: 0 });
    expect(m.requestAirdrop).not.toHaveBeenCalled();
    expect(m.release).toHaveBeenCalledWith(expect.anything(), 9);
  });
  it("L-1 pending: 503 pending, the claim is KEPT, no second send from the public airdrop", async () => {
    m.grant.mockResolvedValue({ status: "pending", signature: "p" });
    const res = await POST(req());
    const body = await res.json();
    expect(res.status).toBe(503);
    expect(body).toMatchObject({ pending: true, retryable: false, signature: "p" });
    expect(m.release).not.toHaveBeenCalled();
    expect(m.requestAirdrop).not.toHaveBeenCalled();
  });
  it("NEGATIVE CONTROL skipped (budget spent): the public airdrop path runs as before", async () => {
    m.grant.mockResolvedValue({ status: "skipped", reason: "budget" });
    const res = await POST(req());
    expect(m.requestAirdrop).toHaveBeenCalled();
    expect(res.status).toBe(429); // the public faucet's own rate limit, calm copy
    expect((await res.json()).error).toMatch(/rate limit reached/);
  });
});
