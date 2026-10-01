/**
 * UX WP-1 AC1 (jsdom half; the Playwright half is e2e/ux-wp1-refusal.spec.ts): a trade the
 * pre-sign simulation refuses with 66 renders ONE status-line[data-kind=price-moved] with an
 * inline "Use {max}" that fills the size; no raw code in the body; nothing else in its place.
 */
import { act, fireEvent, render, screen } from "@testing-library/react";
import { PublicKey } from "@solana/web3.js";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  useWalletCompat: vi.fn(),
  useConnectionCompat: vi.fn(),
  useUserAccount: vi.fn(),
  useSlabState: vi.fn(),
  useEngineState: vi.fn(),
  trade: vi.fn(),
  engineStale: false,
  listeners: new Set<() => void>(),
}));
/** Flip the freshness hook the way the real one does (a store update re-renders subscribers). */
function setEngineStale(v: boolean) {
  mocks.engineStale = v;
  for (const l of mocks.listeners) l();
}

vi.mock("@/hooks/useWalletCompat", () => ({ useWalletCompat: mocks.useWalletCompat, useConnectionCompat: mocks.useConnectionCompat }));
vi.mock("@/hooks/useUserAccount", () => ({ useUserAccount: mocks.useUserAccount }));
vi.mock("@/components/providers/SlabProvider", () => ({ useSlabState: mocks.useSlabState }));
vi.mock("@/hooks/useEngineState", () => ({ useEngineState: mocks.useEngineState }));
vi.mock("@solana/spl-token", () => ({ getAssociatedTokenAddressSync: vi.fn(() => new PublicKey("11111111111111111111111111111111")) }));
vi.mock("@/hooks/useTrade", () => ({ useTrade: () => ({ trade: mocks.trade, loading: false, error: null }), prewarmTradeSubmission: vi.fn() }));
vi.mock("@/hooks/useMarketFillCap", () => ({ useMarketFillCap: () => null }));
vi.mock("@/hooks/useTokenMeta", () => ({ useTokenMeta: () => null }));
vi.mock("@/hooks/useOracleFreshness", () => ({ useOracleFreshness: () => ({ isStale: false, stale: false }) }));
vi.mock("@/hooks/useEngineFreshness", async () => {
  const React = await import("react");
  return {
    useEngineFreshness: () => ({
      engineStale: React.useSyncExternalStore(
        (l: () => void) => { mocks.listeners.add(l); return () => mocks.listeners.delete(l); },
        () => mocks.engineStale,
      ),
    }),
  };
});
vi.mock("@/hooks/usePrivySafe", () => ({ usePrivyLogin: () => vi.fn(), usePrivyAvailable: () => false }));
vi.mock("@/hooks/useWalletAdapterAvailable", () => ({ useWalletAdapterAvailable: () => true }));
vi.mock("@/hooks/useLivePrice", () => ({ useLivePrice: () => ({ priceE6: 1_000_000n, priceUsd: 1 }) }));
vi.mock("@/lib/mock-mode", () => ({ isMockMode: () => false }));
vi.mock("@/lib/priceStore/priceStore", async (orig) => ({
  ...(await orig<object>()),
  getLivePriceSnapshot: () => ({ priceUsd: 1, priceE6: 1_000_000n }),
}));
vi.mock("@/lib/mock-trade-data", () => ({ isMockSlab: () => false, getMockUserAccountIdle: () => null, getMockUserAccount: () => null }));
vi.mock("@/lib/tx", () => ({ prewarmTxLanding: vi.fn() }));
vi.mock("@/components/trade/DepositWithdrawCard", () => ({ DepositWithdrawCard: () => null }));
vi.mock("@/components/ConnectButton", () => ({ ConnectButton: () => null }));
vi.mock("@/components/trade/TradeConfirmationModal", () => ({
  TradeConfirmationModal: (p: { onConfirm: () => void }) => (
    <button data-testid="confirm-trade" onClick={p.onConfirm}>confirm</button>
  ),
}));
// The live side max the resolver offers as "Use {max}": 12.5 of the base token (1e6 scale).
vi.mock("@/lib/limits/ticket", async (orig) => {
  const real = await orig<typeof import("@/lib/limits/ticket")>();
  return {
    ...real,
    deriveTicketLimits: (i: Parameters<typeof real.deriveTicketLimits>[0]) => ({
      ...real.deriveTicketLimits(i),
      sideLimits: {
        long: { maxQ: 12_500_000n, reason: "lp-exposure", halted: false },
        short: { maxQ: 12_500_000n, reason: "lp-exposure", halted: false },
      },
    }),
  };
});

import { OrderTicket } from "@/components/trade/OrderTicket";
import { WRAPPER_ERR } from "@/lib/wrapper-errors";
import { resolveDevnetProgramIds } from "@/lib/program-ids";

const SLAB = "CjdnH8fTmxNMsuUevBt9VjSi87E3ESTcuWuoSrjUjvXE";
const MINT = new PublicKey("So11111111111111111111111111111111111111112");
const WRAPPER = resolveDevnetProgramIds().wrapper;

beforeEach(() => {
  vi.clearAllMocks();
  mocks.engineStale = false;
  mocks.useWalletCompat.mockReturnValue({ publicKey: new PublicKey("11111111111111111111111111111111"), connected: true });
  mocks.useConnectionCompat.mockReturnValue({ connection: {} });
  mocks.useUserAccount.mockReturnValue({ account: { capital: 1_000_000_000n, positionSize: 0n, entryPrice: 0n, pnl: 0n }, accountIndex: 0 });
  mocks.useSlabState.mockReturnValue({ accounts: [], config: { collateralMint: MINT, decimals: 6 }, header: null, refresh: vi.fn(), programId: new PublicKey("11111111111111111111111111111111") });
  mocks.useEngineState.mockReturnValue({ engine: null, params: { initialMarginBps: 1000n, maintenanceMarginBps: 500n }, insuranceBalance: 1_000_000n, totalOI: 0n, hasData: true });
});

/** What sendTx's gate throws for a 66 (SimulationRefusal shape: message + fields). */
function band66(): Error {
  const e = new Error(`Transaction simulation failed: {"InstructionError":[2,{"Custom":${WRAPPER_ERR.ExecPriceOutsideOracleBand}}]}\nProgram ${WRAPPER} failed: custom program error: 0x42`);
  return Object.assign(e, { name: "SimulationRefusal", code: WRAPPER_ERR.ExecPriceOutsideOracleBand, programId: WRAPPER, logs: [`Program ${WRAPPER} failed: custom program error: 0x42`], instructionIndex: 2 });
}

async function submitOnce() {
  const size = screen.getByTestId("trade-size-input") as HTMLInputElement;
  fireEvent.change(size, { target: { value: "5" } });
  await act(async () => {
    fireEvent.click(screen.getByTestId("trade-submit"));
  });
  const confirm = screen.queryByTestId("confirm-trade");
  if (confirm) {
    await act(async () => {
      fireEvent.click(confirm);
    });
  }
}

describe("a refused trade shows ONE StatusLine with the next step", () => {
  it("66 -> status-line[data-kind=price-moved], plain body, 'Use 12.5' fills the size", async () => {
    mocks.trade.mockRejectedValueOnce(band66());
    render(<OrderTicket slabAddress={SLAB} />);
    await submitOnce();
    expect(mocks.trade).toHaveBeenCalledTimes(1);
    const lines = screen.getAllByTestId("status-line");
    expect(lines).toHaveLength(1);
    const line = lines[0];
    expect(line.dataset.kind).toBe("price-moved");
    expect(line.dataset.legacyTestid).toBe("trade-error");
    const body = screen.getByTestId("status-line-body").textContent ?? "";
    expect(body).toMatch(/The price moved too far for this size\. Most you can open now: 12\.5/);
    expect(body).not.toMatch(/0x42|Custom|66|Program/);
    // the legacy red banner is not ALSO rendered
    expect(screen.queryByText(/Program error|custom program error/i)).toBeNull();
    const action = screen.getByTestId("status-line-action");
    expect(action.textContent).toBe("Use 12.5");
    await act(async () => {
      fireEvent.click(action);
    });
    expect((screen.getByTestId("trade-size-input") as HTMLInputElement).value).toMatch(/^12\.50?$/);
    expect(screen.queryByTestId("status-line")).toBeNull(); // editing the size clears it
  });

  it("CONTROL: a user cancellation shows nothing (quiet)", async () => {
    mocks.trade.mockRejectedValueOnce(new Error("User rejected the request."));
    render(<OrderTicket slabAddress={SLAB} />);
    await submitOnce();
    expect(mocks.trade).toHaveBeenCalledTimes(1);
    expect(screen.queryByTestId("status-line")).toBeNull();
    expect(screen.queryByTestId("trade-error")).toBeNull();
  });
});

describe("UX WP-2 AC2: beyond the catch-up cap the ticket waits calmly and re-enables itself", () => {
  it("engine-catching-up StatusLine + disabled 'Waiting for prices…'; clears with no click", async () => {
    mocks.engineStale = true;
    render(<OrderTicket slabAddress={SLAB} />);
    fireEvent.change(screen.getByTestId("trade-size-input"), { target: { value: "5" } });
    const line = screen.getByTestId("status-line");
    expect(line.dataset.kind).toBe("engine-catching-up");
    expect(line.dataset.variant).toBe("wait");
    const btn = screen.getByTestId("trade-submit") as HTMLButtonElement;
    expect(btn.disabled).toBe(true);
    expect(btn.textContent).toBe("Waiting for prices…");
    expect(document.body.textContent).not.toMatch(/maintainer|re-seed|crank behind/i);
    // the keeper catches up: the freshness hook flips; no click, no reload
    await act(async () => setEngineStale(false));
    const btn2 = screen.getByTestId("trade-submit") as HTMLButtonElement;
    expect(btn2.disabled).toBe(false);
    expect(btn2.textContent).not.toBe("Waiting for prices…");
    expect(screen.queryByTestId("status-line")).toBeNull();
  });
});
