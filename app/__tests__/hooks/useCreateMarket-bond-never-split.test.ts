/**
 * #3601: a launch with a v2.2 capacity bond exists only as ONE transaction. After the bond refusal the wizard's
 * Continue called create(params, 0), which takes the step-by-step path: it never reads the bond, so the market went
 * live without it (and the Earn seed between the steps disables bonds for good). The step-by-step path now refuses a
 * bond launch at step 0 with the same message, and sends nothing.
 */
import { act, renderHook } from "@testing-library/react";
import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
import { Keypair, PublicKey } from "@solana/web3.js";

const mocks = vi.hoisted(() => ({
  sendTx: vi.fn(), getAccountInfo: vi.fn(), getProgramAccounts: vi.fn(), getAccount: vi.fn(), deriveVaultAuthority: vi.fn(), getAssociatedTokenAddress: vi.fn(),
  connection: null as unknown as Record<string, unknown>, wallet: null as unknown as Record<string, unknown>, config: null as unknown as Record<string, unknown>,
}));
vi.mock("@solana/web3.js", async (orig) => {
  const a = await orig<typeof import("@solana/web3.js")>();
  return { ...a, SystemProgram: { ...a.SystemProgram, createAccount: (p: { fromPubkey: PublicKey; newAccountPubkey: PublicKey }) => new a.TransactionInstruction({ programId: a.SystemProgram.programId, keys: [{ pubkey: p.fromPubkey, isSigner: true, isWritable: true }, { pubkey: p.newAccountPubkey, isSigner: true, isWritable: true }], data: Buffer.alloc(0) }) } };
});
vi.mock("@/hooks/useWalletCompat", () => ({ useConnectionCompat: () => ({ connection: mocks.connection }), useWalletCompat: () => mocks.wallet }));
vi.mock("@/lib/tx", () => ({ sendTx: mocks.sendTx }));
vi.mock("@/lib/config", () => ({ getConfig: () => mocks.config, getNetwork: () => "mainnet" }));
vi.mock("@/lib/inFlightMarket", () => ({ saveInFlightMarket: vi.fn(), updateInFlightStep: vi.fn(), clearInFlightMarket: vi.fn(), loadLastInFlightMarket: vi.fn(() => null) }));
vi.mock("@solana/spl-token", async () => ({ ...(await vi.importActual<object>("@solana/spl-token")), getAccount: mocks.getAccount, getAssociatedTokenAddress: mocks.getAssociatedTokenAddress }));
vi.mock("@percolatorct/sdk", async () => ({ ...(await vi.importActual<object>("@percolatorct/sdk")), deriveVaultAuthority: mocks.deriveVaultAuthority, deriveMatcherDelegate: () => [new PublicKey(new Uint8Array(32).fill(29)), 254] }));

import { useCreateMarket, type CreateMarketParams } from "@/hooks/useCreateMarket";
import { bondNeedsSingleTxMessage } from "@/lib/v22/launch-wire";

const base = { mint: Keypair.generate().publicKey, initialPriceE6: 100_000_000n, lpCollateral: 1_000_000n, insuranceAmount: 100_000n, oracleFeed: "0".repeat(64), invert: false, tradingFeeBps: 10, initialMarginBps: 1_500, maxAccounts: 4_096, decimals: 6, symbol: "TEST", name: "Test Market", oracleMode: "admin" as const };
const withBond = { ...base, v22: { lotExp: 0, bond: { stub: true } } } as unknown as CreateMarketParams;

beforeEach(() => {
  vi.clearAllMocks();
  vi.useFakeTimers();
  const wallet = Keypair.generate();
  const programId = new PublicKey("69VUZ7a2BeXBTpRRManLamF5UWTaNR9B1hy5Se3cdXy9");
  mocks.config = { programId: programId.toBase58(), matcherProgramId: new PublicKey("4seJWjv3R5qfXY8R5ntuPHWsoqcVvaxvfFSnU2AnGMhT").toBase58(), programsBySlabTier: undefined };
  mocks.connection = { getAccountInfo: mocks.getAccountInfo, getProgramAccounts: mocks.getProgramAccounts, getMinimumBalanceForRentExemption: async () => 1, getBalance: async () => 50_000_000_000 };
  mocks.wallet = { publicKey: wallet.publicKey, connected: true, connecting: false, signTransaction: vi.fn(async (t) => t), signAllTransactions: vi.fn(async (t) => t), signMessage: vi.fn(), disconnect: vi.fn() };
  mocks.deriveVaultAuthority.mockReturnValue([new PublicKey(new Uint8Array(32).fill(23)), 255]);
  mocks.getAssociatedTokenAddress.mockResolvedValue(new PublicKey(new Uint8Array(32).fill(24)));
  mocks.getAccount.mockResolvedValue({ amount: 0n });
  mocks.getAccountInfo.mockResolvedValue(null);
  mocks.getProgramAccounts.mockResolvedValue([]);
  mocks.sendTx.mockRejectedValue(new Error("stop after the first transaction"));
});
afterEach(() => vi.useRealTimers());

async function retryStep0(params: CreateMarketParams) {
  const { result } = renderHook(() => useCreateMarket());
  await act(async () => {
    const p = result.current.create(params, 0) as unknown as Promise<void>;
    await vi.advanceTimersByTimeAsync(10_000);
    await p;
  });
  return result;
}

describe("#3601: a bond launch is never sent step by step", () => {
  it("Continue after the bond refusal (create(params, 0)) refuses with the bond message and sends nothing", async () => {
    const result = await retryStep0(withBond);
    expect(mocks.sendTx).not.toHaveBeenCalled();
    expect(result.current.state.error).toBe(bondNeedsSingleTxMessage);
    expect(result.current.state.loading).toBe(false);
  });

  it("a FRESH bond launch whose one-approval attempt falls back (a wallet without signAllTransactions) refuses too", async () => {
    mocks.wallet = { ...mocks.wallet, signAllTransactions: undefined };
    const { result } = renderHook(() => useCreateMarket());
    await act(async () => {
      const p = result.current.create(withBond) as unknown as Promise<void>;
      await vi.advanceTimersByTimeAsync(10_000);
      await p;
    });
    expect(mocks.sendTx).not.toHaveBeenCalled();
    expect(result.current.state.error).toBe(bondNeedsSingleTxMessage);
    expect(result.current.state.batchFallbackReason ?? null).toBeNull();
  });

  it("CONTROL: the same retry without a bond goes on to send step 0", async () => {
    await retryStep0(base as CreateMarketParams);
    expect(mocks.sendTx).toHaveBeenCalled();
  });
});
