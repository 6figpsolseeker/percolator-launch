/**
 * The create wizard's launch gate ("Need ~N SOL") read the wallet's SOL once, so an airdrop
 * from the faucet modal or faucet.solana.com in another tab left it disabled until a reload.
 * useSolBalance re-reads every SOL_BALANCE_POLL_MS while visible and on returning to the tab.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, renderHook } from "@testing-library/react";
import { PublicKey } from "@solana/web3.js";

const mock = vi.hoisted(() => ({ on: false }));
vi.mock("@/lib/mock-mode", () => ({ isMockMode: () => mock.on }));

import { SOL_BALANCE_POLL_MS, useSolBalance } from "@/hooks/useSolBalance";

const WALLET = new PublicKey("9WzDXwBbmkg8ZTbNMqUxvQRAyrZzDsGYdLVL9zYtAWWM");
const sol = (n: number) => n * 1_000_000_000;
const settle = () => act(async () => { await Promise.resolve(); await Promise.resolve(); });
let visibility: DocumentVisibilityState = "visible";

beforeEach(() => {
  vi.useFakeTimers();
  mock.on = false;
  visibility = "visible";
  vi.spyOn(document, "visibilityState", "get").mockImplementation(() => visibility);
});
afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("useSolBalance", () => {
  it("picks up an airdrop on the next poll, without a remount", async () => {
    const getBalance = vi.fn().mockResolvedValue(0);
    const { result } = renderHook(({ c }) => useSolBalance(WALLET, c), { initialProps: { c: { getBalance } as never } });
    await settle();
    expect(result.current).toBe(0);
    getBalance.mockResolvedValue(sol(2));
    await act(async () => { await vi.advanceTimersByTimeAsync(SOL_BALANCE_POLL_MS); });
    expect(result.current).toBe(2);
  });

  it("re-reads the moment the tab becomes visible again (airdrop in another tab)", async () => {
    const getBalance = vi.fn().mockResolvedValue(0);
    const { result } = renderHook(({ c }) => useSolBalance(WALLET, c), { initialProps: { c: { getBalance } as never } });
    await settle();
    visibility = "hidden";
    document.dispatchEvent(new Event("visibilitychange"));
    await act(async () => { await vi.advanceTimersByTimeAsync(SOL_BALANCE_POLL_MS * 2); });
    const hiddenReads = getBalance.mock.calls.length;
    expect(hiddenReads).toBe(1); // no polling while hidden
    getBalance.mockResolvedValue(sol(1.5));
    visibility = "visible";
    document.dispatchEvent(new Event("visibilitychange"));
    await settle();
    expect(result.current).toBe(1.5);
  });

  it("a failed poll keeps the last balance; a failed first read reports null", async () => {
    const getBalance = vi.fn().mockResolvedValue(sol(3));
    const { result } = renderHook(({ c }) => useSolBalance(WALLET, c), { initialProps: { c: { getBalance } as never } });
    await settle();
    getBalance.mockRejectedValue(new Error("429"));
    await act(async () => { await vi.advanceTimersByTimeAsync(SOL_BALANCE_POLL_MS); });
    expect(result.current).toBe(3);

    const failing = vi.fn().mockRejectedValue(new Error("429"));
    const second = renderHook(({ c }) => useSolBalance(WALLET, c), { initialProps: { c: { getBalance: failing } as never } });
    await settle();
    expect(second.result.current).toBeNull();
  });

  it("stops polling on unmount; no wallet means null and no reads", async () => {
    const getBalance = vi.fn().mockResolvedValue(0);
    const { unmount } = renderHook(({ c }) => useSolBalance(WALLET, c), { initialProps: { c: { getBalance } as never } });
    await settle();
    unmount();
    await act(async () => { await vi.advanceTimersByTimeAsync(SOL_BALANCE_POLL_MS * 3); });
    expect(getBalance).toHaveBeenCalledTimes(1);

    const none = vi.fn();
    const { result } = renderHook(({ c }) => useSolBalance(null, c), { initialProps: { c: { getBalance: none } as never } });
    expect(result.current).toBeNull();
    expect(none).not.toHaveBeenCalled();
  });

  it("mock mode reports a funded 8.5 SOL", async () => {
    mock.on = true;
    const { result } = renderHook(({ c }) => useSolBalance(WALLET, c), { initialProps: { c: { getBalance: vi.fn() } as never } });
    await settle();
    expect(result.current).toBe(8.5);
  });
});
