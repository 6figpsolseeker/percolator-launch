/**
 * After a capped payout, "Withdraw max available now" re-requests a smaller ticket and arms the
 * payout to open by itself when the new cooldown ends (DepositWithdrawPanel.handleResize). The pending
 * card stays mounted across the re-request, and its once-only autoFired flag from the first attempt
 * was never reset, so the armed payout never opened. A new ticketKey now resets it.
 */
import { act, render } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

vi.mock("@/hooks/useCooldownCountdown", () => ({ useCooldownCountdown: () => ({ remainingMs: 0 }) }));

import { EarnPendingWithdrawal } from "@/components/earn/EarnPendingWithdrawal";

const props = (over: Partial<Parameters<typeof EarnPendingWithdrawal>[0]>) => ({
  amountLabel: "100 USDC",
  cooldownElapsed: true,
  cooldownRemainingSlots: 0,
  armed: true,
  onCollect: vi.fn().mockResolvedValue(undefined),
  ticketKey: "1000",
  ...over,
});

describe("EarnPendingWithdrawal: automatic payout per ticket", () => {
  it("a re-requested ticket opens its own payout when its cooldown ends", async () => {
    const onCollect = vi.fn().mockResolvedValue(undefined);
    const { rerender } = render(<EarnPendingWithdrawal {...props({ onCollect })} />);
    await act(async () => {});
    expect(onCollect).toHaveBeenCalledTimes(1); // the first (capped) attempt

    // "Withdraw max available now": a smaller ticket, a new cooldown, still armed.
    rerender(<EarnPendingWithdrawal {...props({ onCollect, ticketKey: "600", cooldownElapsed: false })} />);
    await act(async () => {});
    expect(onCollect).toHaveBeenCalledTimes(1);

    rerender(<EarnPendingWithdrawal {...props({ onCollect, ticketKey: "600", cooldownElapsed: true })} />);
    await act(async () => {});
    expect(onCollect).toHaveBeenCalledTimes(2);
  });

  it("CONTROL: the same ticket never fires twice", async () => {
    const onCollect = vi.fn().mockResolvedValue(undefined);
    const { rerender } = render(<EarnPendingWithdrawal {...props({ onCollect })} />);
    await act(async () => {});
    rerender(<EarnPendingWithdrawal {...props({ onCollect, cooldownElapsed: false })} />);
    rerender(<EarnPendingWithdrawal {...props({ onCollect, cooldownElapsed: true })} />);
    await act(async () => {});
    expect(onCollect).toHaveBeenCalledTimes(1);
  });

  it("CONTROL: not armed, nothing fires", async () => {
    const onCollect = vi.fn().mockResolvedValue(undefined);
    render(<EarnPendingWithdrawal {...props({ onCollect, armed: false })} />);
    await act(async () => {});
    expect(onCollect).not.toHaveBeenCalled();
  });
});
