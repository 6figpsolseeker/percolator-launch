/**
 * UX WP-9 AC2 (audit §3.11, MM-1): claim-all on 3 markets = ONE wallet prompt. The wallet's
 * signAllTransactions is called once with 3 txs and signTransaction never; each market stays its
 * own tx. Result copy: "Claimed {total} from {n} markets." (+ the partial clause).
 */
import { describe, expect, it, vi } from "vitest";
import { act, renderHook } from "@testing-library/react";
import { Keypair, TransactionInstruction, type Transaction } from "@solana/web3.js";

const PAYER = Keypair.generate().publicKey;
const signAllTransactions = vi.fn(async (txs: Transaction[]) => txs);
const signTransaction = vi.fn(async (tx: Transaction) => tx);
const WALLET = { publicKey: PAYER, signAllTransactions, signTransaction };
const CONN = { connection: { getAccountInfo: vi.fn(async () => ({ data: Buffer.alloc(8) })) } };
vi.mock("@/hooks/useWalletCompat", () => ({ useWalletCompat: () => WALLET, useConnectionCompat: () => CONN }));
vi.mock("@/lib/config", async (orig) => ({ ...(await orig<object>()), getConfig: () => ({ programId: PROG }) }));
vi.mock("@/lib/programAllowlist", () => ({ assertKnownProgram: () => undefined }));
const PROG = Keypair.generate().publicKey.toBase58();
let refuse = "";
vi.mock("@/lib/creator-fee-claim-ix", async (orig) => ({
  ...(await orig<object>()),
  buildCreatorFeeClaimIx: vi.fn(async ({ market }: { market: { toBase58(): string } }) => ({
    instruction: new TransactionInstruction({ programId: Keypair.generate().publicKey, keys: [], data: Buffer.from(market.toBase58().slice(0, 4)) }),
    amount: 1_500_000n,
  })),
}));
const broadcast = vi.fn(async () => "sig");
vi.mock("@/lib/tx", async (orig) => ({
  ...(await orig<object>()),
  getFreshBlockhash: async () => "11111111111111111111111111111111",
  getPriorityFee: async () => 1000,
  simulateForGate: async (_c: unknown, _p: unknown, ixs: TransactionInstruction[]) => ({
    err: Buffer.from(ixs[0]!.data).toString() === refuse ? { InstructionError: [0, { Custom: 86 }] } : null,
    consumed: 20_000,
    logs: [],
    rpcFailed: false,
    simulated: ixs,
  }),
  broadcastSignedTx: (...a: unknown[]) => broadcast(...(a as [])),
  // jsdom's cross-realm Uint8Array breaks web3 tx building here; the tx shape is covered in node tests.
  buildBatchTx: (p: { instructions: TransactionInstruction[]; priorityFeeMicroLamports: number }) => ({ ixs: p.instructions, fee: p.priorityFeeMicroLamports }),
}));

const { useClaimCreatorFees, claimAllResultCopy } = await import("@/hooks/useClaimCreatorFees");
const slabs = [0, 1, 2].map(() => Keypair.generate().publicKey.toBase58());

describe("AC2: claim all on 3 markets = 1 prompt", () => {
  it("one signAllTransactions with 3 txs, no signTransaction, 3 claimed", async () => {
    const { result } = renderHook(() => useClaimCreatorFees());
    let out: Awaited<ReturnType<typeof result.current.claim>> = [];
    await act(async () => {
      out = await result.current.claim(slabs);
    });
    expect(signAllTransactions).toHaveBeenCalledTimes(1);
    expect(signAllTransactions.mock.calls[0]![0]).toHaveLength(3);
    expect(signTransaction).not.toHaveBeenCalled();
    expect(out.every((o) => o.signature === "sig")).toBe(true);
    expect(claimAllResultCopy(out, (a) => `${Number(a) / 1e6}`)).toBe("Claimed 4.5 from 3 markets.");
  });
  it("one market refused in simulation: still 1 prompt (2 txs), partial copy", async () => {
    signAllTransactions.mockClear();
    refuse = slabs[1]!.slice(0, 4);
    const { result } = renderHook(() => useClaimCreatorFees());
    let out: Awaited<ReturnType<typeof result.current.claim>> = [];
    await act(async () => {
      out = await result.current.claim(slabs);
    });
    expect(signAllTransactions).toHaveBeenCalledTimes(1);
    expect(signAllTransactions.mock.calls[0]![0]).toHaveLength(2);
    expect(out[1]!.error).toBeTruthy();
    expect(claimAllResultCopy(out, (a) => `${Number(a) / 1e6}`)).toBe("Claimed 3 from 2 markets. 1 couldn't be claimed right now; we'll show them here.");
  });
});
