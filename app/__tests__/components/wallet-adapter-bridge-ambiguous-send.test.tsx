// @vitest-environment happy-dom
/**
 * #3667 (mainnet atomic path): sendTx driven THROUGH the wallet-adapter bridge's signAndSendTransaction.
 * A failure before the bridge reached sendRawTransaction (signing stage) or a definite refusal means nothing was sent and
 * keeps the wallet's own message, whatever its wording. Only an error after the broadcast was attempted is ambiguous.
 */
import React, { useContext } from "react";
import { act, render } from "@testing-library/react";
import { Connection, Keypair, PublicKey, SendTransactionError, Transaction, TransactionInstruction } from "@solana/web3.js";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ wallet: null as unknown, publicKey: null as unknown, adapterSign: vi.fn() }));
vi.mock("@/lib/config", () => ({
  getConfig: () => ({ network: "mainnet", rpcUrl: "https://rpc.invalid", programId: "11111111111111111111111111111111" }),
  getNetwork: () => "mainnet",
}));
vi.mock("@solana/wallet-adapter-react", () => ({
  ConnectionProvider: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  WalletProvider: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  useWallet: () => ({
    publicKey: mocks.publicKey, connected: true, connecting: false, wallet: mocks.wallet,
    signTransaction: mocks.adapterSign, signAllTransactions: undefined, signMessage: undefined, disconnect: vi.fn(),
  }),
}));
vi.mock("@solana/wallet-adapter-wallets", () => ({ SolflareWalletAdapter: class { name = "Solflare"; } }));
vi.mock("@/hooks/useWalletCompat", () => ({ useConnectionCompat: () => ({ connection: {} }) }));

import WalletAdapterProviderClient from "@/components/providers/WalletAdapterProviderClient";
import { WalletApiContext, type WalletApi } from "@/hooks/walletApiContext";
import { __setDevnetV22ForTest } from "@/lib/v22/flag";
import { sendTx, isConfirmationTimeoutError } from "@/lib/tx";

const kp = Keypair.generate();
let api: WalletApi | null = null;
const Probe = () => { api = useContext(WalletApiContext) as WalletApi; return null; };

const makeConn = () => ({
  rpcEndpoint: "https://rpc.invalid",
  getRecentPrioritizationFees: vi.fn().mockResolvedValue([]),
  getBalance: vi.fn().mockResolvedValue(1_000_000_000),
  getLatestBlockhash: vi.fn().mockResolvedValue({ blockhash: "11111111111111111111111111111111", lastValidBlockHeight: 123 }),
  simulateTransaction: vi.fn().mockResolvedValue({ value: { err: null, logs: [] } }),
  getSignatureStatuses: vi.fn().mockResolvedValue({ value: [null] }),
}) as unknown as Connection;
const ix = () => new TransactionInstruction({ programId: kp.publicKey, keys: [{ pubkey: kp.publicKey, isSigner: true, isWritable: true }], data: Buffer.from([1]) });

async function run(): Promise<Error> {
  const wallet = { publicKey: kp.publicKey, signAndSendTransaction: api!.signAndSendTransaction! };
  return (await sendTx({ connection: makeConn(), wallet, instructions: [ix()] }).catch((e: unknown) => e)) as Error;
}

beforeEach(() => {
  __setDevnetV22ForTest(false);
  vi.spyOn(console, "info").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
  vi.spyOn(console, "warn").mockImplementation(() => {});
  mocks.publicKey = kp.publicKey;
  mocks.wallet = { adapter: { name: "Solflare" } };
  mocks.adapterSign.mockReset().mockImplementation(async (t: Transaction) => { t.sign(kp); return t; });
  api = null;
  render(<WalletAdapterProviderClient><Probe /></WalletAdapterProviderClient>);
});
afterEach(() => { __setDevnetV22ForTest(null); vi.restoreAllMocks(); });

class NamedError extends Error { constructor(name: string, m = "") { super(m); this.name = name; } }

describe("bridge signing-stage failures: nothing was sent, original message kept (never 'may still land')", () => {
  it.each([
    ["Unexpected error", new Error("Unexpected error")],
    ["Ledger locked", new Error("Ledger device: Locked device (0x5515)")],
    ["Wallet is locked", new Error("Wallet is locked")],
    ["Plugin Closed", new Error("Plugin Closed")],
    ["empty WalletNotConnectedError", new NamedError("WalletNotConnectedError")],
    ["WalletRequestClosedError", new NamedError("WalletRequestClosedError", "The wallet request was closed")],
  ])("%s", async (_n, e) => {
    mocks.adapterSign.mockRejectedValue(e);
    const send = vi.spyOn(Connection.prototype, "sendRawTransaction");
    const err = await run();
    expect(isConfirmationTimeoutError(err)).toBe(false);
    expect(err.message).not.toMatch(/may still land/);
    expect(err.message).toBe(e.message || "Unexpected error"); // sendTx's own fallback for an empty message
    expect(send).not.toHaveBeenCalled();
  });
});

describe("bridge send stage", () => {
  it("a definite refusal (preflight) keeps its own message and is not 'may still land'", async () => {
    vi.spyOn(Connection.prototype, "sendRawTransaction").mockRejectedValue(
      new SendTransactionError({ action: "simulate", signature: "", transactionMessage: "Transaction simulation failed: Error processing Instruction 0: custom program error: 0x13", logs: [] }),
    );
    const err = await run();
    expect(isConfirmationTimeoutError(err)).toBe(false);
    expect(err.message).toMatch(/custom program error: 0x13/);
  });
  it("a node refusal the atomic classifier cannot recognise is still 'not sent' because the bridge marks it (markNotBroadcast)", async () => {
    // "Node is behind" is a provable refusal by sendMayHaveBroadcast, but atomicSendMayHaveBroadcast has no pattern for it:
    // only the bridge's own mark keeps it from reading "may still land".
    vi.spyOn(Connection.prototype, "sendRawTransaction").mockRejectedValue(
      new SendTransactionError({ action: "simulate", signature: "", transactionMessage: "Node is behind by 42 slots", logs: [] }),
    );
    const err = await run();
    expect(isConfirmationTimeoutError(err)).toBe(false);
    expect(err.message).toMatch(/Node is behind by 42 slots/);
    expect(err.message).not.toMatch(/may still land/);
  });
  it("a dropped fetch after the send was attempted is confirmed by the signed tx's signature (never 'nothing was sent')", async () => {
    const send = vi.spyOn(Connection.prototype, "sendRawTransaction").mockRejectedValue(new TypeError("Failed to fetch"));
    const conn = makeConn();
    let sig = "";
    (conn.getSignatureStatuses as ReturnType<typeof vi.fn>).mockImplementation(async (s: string[]) => { sig = s[0]!; return { value: [{ err: null, confirmationStatus: "confirmed" }] }; });
    const wallet = { publicKey: kp.publicKey, signAndSendTransaction: api!.signAndSendTransaction! };
    const out = await sendTx({ connection: conn, wallet, instructions: [ix()] });
    expect(out).toBe(sig);
    expect(send).toHaveBeenCalledTimes(1);
  });
});

void act; void PublicKey;
