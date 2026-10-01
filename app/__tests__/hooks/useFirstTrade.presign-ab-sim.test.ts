/**
 * 2026-10-01: the first trade on a market signs [A = create+init] and [B = deposit+trade] in one
 * prompt, but only A was simulated. A trade-leg refusal (the creator's SameOwnerTrade, Custom 67)
 * therefore surfaced late and unmapped. B is now simulated together with A (one simulated list),
 * and a refusal throws SimulationRefusal BEFORE the wallet opens.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { Keypair, PublicKey, TransactionInstruction } from "@solana/web3.js";

const WRAPPER = new PublicKey("ETDLAdiAyWnEUngspYczTXUceT6X8f92eZQvr8nmSkWB");
const owner = Keypair.generate().publicKey;
const signAll = vi.fn();
const simulateForGate = vi.fn();

vi.mock("@/hooks/useWalletCompat", () => ({
  useWalletCompat: () => ({ publicKey: owner, signAllTransactions: signAll }),
  useConnectionCompat: () => ({
    connection: {
      getAccountInfo: vi.fn(async () => ({ data: Buffer.alloc(8192) })),
      getMinimumBalanceForRentExemption: vi.fn(async () => 1_000_000),
      getLatestBlockhash: vi.fn(async () => ({ blockhash: "11111111111111111111111111111111", lastValidBlockHeight: 1 })),
    },
  }),
}));
vi.mock("@/components/providers/SlabProvider", () => ({
  useSlabState: () => ({
    config: { collateralMint: Keypair.generate().publicKey },
    programId: WRAPPER,
    wrapperConfigV17: { tradeFeeBps: 5n },
    refresh: vi.fn(),
  }),
}));
vi.mock("@percolatorct/sdk", async (orig) => ({
  ...(await orig<typeof import("@percolatorct/sdk")>()),
  getAta: vi.fn(async () => Keypair.generate().publicKey),
  deriveVaultAuthority: vi.fn(() => [Keypair.generate().publicKey, 255]),
}));
vi.mock("@/lib/programAllowlist", () => ({ assertKnownProgram: vi.fn() }));
vi.mock("@/lib/deposit-guard", () => ({ assertDepositWithinBalance: vi.fn() }));
vi.mock("@/lib/v18-wire", () => ({
  fetchAssetMarketId: vi.fn(async () => 1n),
  fetchPortfolioIdentity: vi.fn(async () => ({ portfolioId: 1n, matcherSequence: 0n, positionEpoch: 0n })),
}));
vi.mock("@/hooks/useTrade", () => ({
  findV17Portfolio: vi.fn(async () => null),
  resolveLpTradeAccounts: vi.fn(async () => ({
    accountB: Keypair.generate().publicKey,
    matcherProg: Keypair.generate().publicKey,
    matcherCtx: Keypair.generate().publicKey,
    matcherDelegate: Keypair.generate().publicKey,
  })),
}));
vi.mock("@/lib/portfolio-invalidation", () => ({ invalidatePortfolio: vi.fn() }));
vi.mock("@/lib/first-trade", async (orig) => {
  const real = await orig<typeof import("@/lib/first-trade")>();
  const ix = (tag: number) => new TransactionInstruction({ programId: WRAPPER, keys: [], data: Buffer.from([tag]) });
  return {
    ...real,
    readNextPortfolioId: () => 2n,
    buildFirstTradeInitIxs: () => [ix(1), ix(2)],
    buildFundAndTradeIxs: () => [ix(3), ix(10)],
  };
});
vi.mock("@/lib/tx", async (orig) => {
  const real = await orig<typeof import("@/lib/tx")>();
  return {
    ...real,
    simulateForGate: (...a: unknown[]) => simulateForGate(...a),
    getPriorityFee: vi.fn(async () => 1),
    buildBatchTx: vi.fn(() => ({})),
    broadcastSignedTx: vi.fn(async () => "sig"),
    signAllCompat: (...a: unknown[]) => signAll(...a),
    sendTx: vi.fn(),
  };
});

import { useFirstTrade, PRESIGN_SIM_UNREACHABLE } from "@/hooks/useFirstTrade";
import { resolveUserMessage } from "@/lib/limits/user-message";
import { SimulationRefusal } from "@/lib/tx";

const ok = (ixs: TransactionInstruction[]) => ({ consumed: 40_000, err: null, logs: [], rpcFailed: false, simulated: ixs });

describe("useFirstTrade pre-sign A+B simulation", () => {
  beforeEach(() => {
    signAll.mockReset();
    simulateForGate.mockReset();
  });

  const run = async () => {
    const { result } = renderHook(() => useFirstTrade(Keypair.generate().publicKey.toBase58()));
    let err: unknown = null;
    await act(async () => {
      try {
        await result.current.fundAndTrade({ size: 1_000n, depositAtoms: 330_000_000n, limitPriceE6: 3_700n, amountLabel: "330 USDC" });
      } catch (e) {
        err = e;
      }
    });
    return err;
  };

  it("a trade-leg refusal (67) in the A+B simulation throws SimulationRefusal and never opens the wallet", async () => {
    simulateForGate.mockImplementation(async (_c: unknown, _o: unknown, ixs: TransactionInstruction[]) =>
      ixs.length === 2
        ? ok(ixs)
        : { consumed: null, err: { InstructionError: [5, { Custom: 67 }] }, logs: [`Program ${WRAPPER.toBase58()} failed: custom program error: 0x43`], rpcFailed: false, simulated: ixs },
    );
    const err = await run();
    expect(err).toBeInstanceOf(SimulationRefusal);
    expect((err as SimulationRefusal).code).toBe(67);
    expect((err as SimulationRefusal).programId).toBe(WRAPPER.toBase58());
    expect(simulateForGate).toHaveBeenCalledTimes(2);
    expect((simulateForGate.mock.calls[1][2] as TransactionInstruction[]).length).toBe(4);
    expect(signAll).not.toHaveBeenCalled();
  });

  it("negative control: a clean A+B simulation proceeds to the one prompt", async () => {
    simulateForGate.mockImplementation(async (_c: unknown, _o: unknown, ixs: TransactionInstruction[]) => ok(ixs));
    signAll.mockImplementation(async (_w: unknown, txs: unknown[]) => txs.map(() => ({ partialSign: vi.fn() })));
    const err = await run();
    expect(err).toBeNull();
    expect(signAll).toHaveBeenCalledTimes(1);
  });

  it("a simulation that could not run (RPC error) stops before the wallet, with a plain line", async () => {
    simulateForGate.mockImplementation(async (_c: unknown, _o: unknown, ixs: TransactionInstruction[]) =>
      ixs.length === 2 ? ok(ixs) : { consumed: null, err: null, logs: [], rpcFailed: true, simulated: ixs },
    );
    const err = await run();
    expect(signAll).not.toHaveBeenCalled();
    expect((err as Error).message).toBe(PRESIGN_SIM_UNREACHABLE);
    expect(resolveUserMessage(err, { surface: "trade" }).kind).toBe("rpc-unreachable");
  });

  it("'No portfolio account found' maps to a plain line, not 'Something went wrong'", () => {
    const u = resolveUserMessage(new Error("No portfolio account found for your wallet on this market. Please deposit collateral first to create a portfolio."), { surface: "trade" });
    expect(u.kind).toBe("no-account");
  });
});
