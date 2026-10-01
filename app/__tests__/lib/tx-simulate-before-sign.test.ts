// @vitest-environment node
//
// Node, not jsdom — same reason as tx.test.ts (requestHeapFrame's encoder
// rejects jsdom's realm-separated Uint8Array).
import { describe, it, expect, vi, afterEach } from "vitest";
import { Keypair, SystemProgram, Transaction } from "@solana/web3.js";
import bs58 from "bs58";

const netState = vi.hoisted(() => ({ network: "devnet" as "mainnet" | "devnet" }));
vi.mock("@/lib/config", () => ({
  getConfig: () => ({ network: "devnet", rpcUrl: "https://api.devnet.solana.com" }),
  getNetwork: () => netState.network,
}));

import { sendTx, presimulateOrThrow, SimulationRefusal } from "@/lib/tx";

const SIG = bs58.encode(new Uint8Array(64).fill(7));
// The retry's re-sent keeper hand-off, as the deployed wrapper answers it.
const UNAUTHORIZED_SIM = {
  value: {
    err: { InstructionError: [0, { Custom: 8 }] },
    logs: ["Program GnwdeQrAh4qzChJeVLrM21CXXWC1akjLH3DiijwzEEYZ failed: custom program error: 0x8"],
  },
};

function makeConn(simResult: unknown) {
  const events: string[] = [];
  const conn = {
    rpcEndpoint: "https://percolator-playground.vercel.app/api/rpc",
    getRecentPrioritizationFees: vi.fn().mockResolvedValue([]),
    getBalance: vi.fn().mockResolvedValue(1_000_000_000),
    getLatestBlockhash: vi.fn().mockResolvedValue({
      blockhash: "11111111111111111111111111111111",
      lastValidBlockHeight: 10_000_000,
    }),
    getBlockHeight: vi.fn().mockResolvedValue(1),
    simulateTransaction: vi.fn(async () => {
      events.push("simulate");
      return simResult;
    }),
    sendRawTransaction: vi.fn(async () => {
      events.push("broadcast");
      return SIG;
    }),
    getSignatureStatuses: vi.fn().mockResolvedValue({ value: [{ confirmationStatus: "confirmed", err: null }] }),
  } as any;
  return { conn, events };
}

function makeWallet(events: string[]) {
  const kp = Keypair.generate();
  return {
    publicKey: kp.publicKey,
    signTransaction: vi.fn(async (tx: Transaction) => {
      events.push("wallet-prompt");
      tx.partialSign(kp);
      return tx;
    }),
  };
}

afterEach(() => {
  netState.network = "devnet";
  vi.restoreAllMocks();
});

describe("sendTx simulateBeforeSign (devnet sign-then-submit path)", () => {
  it("a tx that will revert never reaches the wallet: our decoded error is thrown first", async () => {
    const { conn, events } = makeConn(UNAUTHORIZED_SIM);
    const wallet = makeWallet(events);

    await expect(
      sendTx({ connection: conn, wallet, instructions: [], simulateBeforeSign: true }),
    ).rejects.toThrow(/Transaction simulation failed: .*"Custom":8/);

    expect(wallet.signTransaction).not.toHaveBeenCalled();
    expect(events).toEqual(["simulate"]);
  });

  it("UX WP-1: WITHOUT the flag too, a doomed tx never opens the wallet (SimulationRefusal)", async () => {
    const { conn, events } = makeConn(UNAUTHORIZED_SIM);
    const wallet = makeWallet(events);

    const err = await sendTx({ connection: conn, wallet, instructions: [] }).catch((e) => e);
    expect(err).toBeInstanceOf(SimulationRefusal);
    expect(err.message).toMatch(/Transaction simulation failed: .*"Custom":8/);
    expect(err.code).toBe(8);
    expect(wallet.signTransaction).not.toHaveBeenCalled();
    expect(events).toEqual(["simulate"]);
  });

  it("simulates before the prompt even with keypair signers (sigVerify:false needs no signatures)", async () => {
    const { conn, events } = makeConn({ value: { err: null, logs: [] } });
    const wallet = makeWallet(events);
    const extra = Keypair.generate();

    const sig = await sendTx({
      connection: conn,
      wallet,
      instructions: [SystemProgram.transfer({ fromPubkey: extra.publicKey, toPubkey: wallet.publicKey, lamports: 1 })],
      signers: [extra],
      simulateBeforeSign: true,
    });

    expect(sig).toBe(SIG);
    expect(events).toEqual(["simulate", "wallet-prompt", "broadcast"]);
    const simOpts = (conn.simulateTransaction.mock.calls[0] as unknown[])[1] as { sigVerify: boolean };
    expect(simOpts.sigVerify).toBe(false);
  });

  it("UX WP-1: without the flag a multi-signer tx is ALSO simulated before the prompt", async () => {
    const { conn, events } = makeConn({ value: { err: null, logs: [] } });
    const wallet = makeWallet(events);
    const extra = Keypair.generate();

    await sendTx({
      connection: conn,
      wallet,
      instructions: [SystemProgram.transfer({ fromPubkey: extra.publicKey, toPubkey: wallet.publicKey, lamports: 1 })],
      signers: [extra],
    });
    expect(events).toEqual(["simulate", "wallet-prompt", "broadcast"]);
  });
});

describe("presimulateOrThrow", () => {
  const tx = () => {
    const payer = Keypair.generate().publicKey;
    const t = new Transaction().add(SystemProgram.transfer({ fromPubkey: payer, toPubkey: payer, lamports: 1 }));
    t.feePayer = payer;
    t.recentBlockhash = "11111111111111111111111111111111";
    return t;
  };

  it("throws the program error and failing log line when the tx would revert", async () => {
    const { conn } = makeConn(UNAUTHORIZED_SIM);
    await expect(presimulateOrThrow(conn, tx())).rejects.toThrow(/custom program error: 0x8/);
  });

  it("does not throw when the tx simulates clean", async () => {
    const { conn } = makeConn({ value: { err: null, logs: [] } });
    await expect(presimulateOrThrow(conn, tx())).resolves.toBeUndefined();
  });

  it("does not block on an RPC failure of the simulation itself", async () => {
    const { conn } = makeConn(null);
    conn.simulateTransaction = vi.fn().mockRejectedValue(new Error("429 Too Many Requests"));
    await expect(presimulateOrThrow(conn, tx())).resolves.toBeUndefined();
  });
});
