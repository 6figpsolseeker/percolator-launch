/**
 * Live report 2026-10-01: the Earn/Stake withdraw cooldown timer did not tick until a refresh.
 * One shared clock (useCooldownCountdown) for both; a lagging poll never snaps it back.
 */
import "@testing-library/jest-dom";
import { act, render, renderHook, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useCooldownCountdown } from "@/hooks/useCooldownCountdown";
import { useStakeCooldown } from "@/hooks/useStakeCooldown";
import { EarnPendingWithdrawal } from "@/components/earn/EarnPendingWithdrawal";

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());
const tick = (ms: number) => act(() => { vi.advanceTimersByTime(ms); });

describe("useCooldownCountdown", () => {
  it("ticks every second from the chain reading (150 slots = 60 s)", () => {
    const { result } = renderHook(() => useCooldownCountdown({ remainingSlots: 150, elapsed: false, resetKey: "t" }));
    expect(result.current.remainingMs).toBe(60_000);
    tick(10_000);
    expect(result.current.remainingMs).toBe(50_000);
  });

  it("a lagging re-read (slightly LATER deadline) does not snap the clock back", () => {
    const { result, rerender } = renderHook((p: { rem: number }) => useCooldownCountdown({ remainingSlots: p.rem, elapsed: false, resetKey: "t" }), { initialProps: { rem: 150 } });
    tick(10_000);
    rerender({ rem: 130 }); // the poll's slot lags: says 52 s left, the clock says 50 s
    expect(result.current.remainingMs).toBe(50_000);
    tick(1_000);
    expect(result.current.remainingMs).toBe(49_000);
  });

  it("an EARLIER correction is taken, and a new ticket restarts the clock", () => {
    const { result, rerender } = renderHook((p: { rem: number; k: string }) => useCooldownCountdown({ remainingSlots: p.rem, elapsed: false, resetKey: p.k }), { initialProps: { rem: 150, k: "a" } });
    rerender({ rem: 100, k: "a" });
    expect(result.current.remainingMs).toBe(40_000);
    rerender({ rem: 150, k: "b" });
    expect(result.current.remainingMs).toBe(60_000);
  });

  it("at 0 asks the chain (throttled to 2 s) until it reads elapsed", () => {
    const onZero = vi.fn();
    const { result, rerender } = renderHook((p: { elapsed: boolean }) => useCooldownCountdown({ remainingSlots: 5, elapsed: p.elapsed, resetKey: "t", onZero }), { initialProps: { elapsed: false } });
    tick(3_000);
    expect(result.current.remainingMs).toBe(0);
    expect(onZero).toHaveBeenCalledTimes(1);
    tick(1_000);
    expect(onZero).toHaveBeenCalledTimes(1);
    tick(1_000);
    expect(onZero).toHaveBeenCalledTimes(2);
    rerender({ elapsed: true });
    tick(5_000);
    expect(onZero).toHaveBeenCalledTimes(2);
  });
});

describe("Earn pending card", () => {
  it("keeps counting down through a lagging poll (it used to snap back and read as stuck)", () => {
    const props = { amountLabel: "10.00 USDC", cooldownElapsed: false, armed: false, onCollect: vi.fn(async () => {}), ticketKey: "9523809" };
    const { rerender } = render(<EarnPendingWithdrawal {...props} cooldownRemainingSlots={150n} />);
    expect(screen.getByTestId("earn-pending-countdown").textContent).toBe("Ready in 1:00");
    tick(10_000);
    expect(screen.getByTestId("earn-pending-countdown").textContent).toBe("Ready in 0:50");
    rerender(<EarnPendingWithdrawal {...props} cooldownRemainingSlots={130n} />);
    tick(1_000);
    expect(screen.getByTestId("earn-pending-countdown").textContent).toBe("Ready in 0:49");
  });
});

describe("useStakeCooldown", () => {
  it("the stake label ticks (it used to be the last fetch's static text)", () => {
    const pos = { cooldownRemaining: 150, cooldownElapsed: false, lpBalanceRaw: 1_000n };
    const { result } = renderHook(() => useStakeCooldown(pos));
    expect(result.current.label).toBe("Withdraw available in 1:00");
    tick(15_000);
    expect(result.current.label).toBe("Withdraw available in 0:45");
  });
});
