/**
 * Stable `data-testid` hooks for the Playwright E2E lane. These are a
 * contract with the E2E specs: renaming one silently breaks the lane, so
 * they are pinned here. Each block includes a negative control — a testid
 * that must NOT be present in the state where the control isn't rendered —
 * so an "always present" regression (or a vacuous query) fails.
 */
import { describe, expect, it, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";

vi.mock("@/hooks/usePrefersReducedMotion", () => ({ usePrefersReducedMotion: () => true }));
vi.mock("@/hooks/useLockBodyScroll", () => ({ useLockBodyScroll: () => {} }));
vi.mock("gsap", () => ({
  default: { set: () => {}, to: () => {}, fromTo: () => {}, killTweensOf: () => {} },
}));

import { TradeConfirmationModal } from "@/components/trade/TradeConfirmationModal";
import { ClosePositionForm } from "@/components/trade/ClosePositionForm";
import { LaunchProgress } from "@/components/create/LaunchProgress";

type ConfirmProps = Parameters<typeof TradeConfirmationModal>[0];
const confirmProps = (over: Partial<ConfirmProps> = {}): ConfirmProps => ({
  direction: "long",
  positionSize: 1_000_000n,
  margin: 100_000_000n,
  leverage: 2,
  estimatedLiqPrice: 950_000n,
  tradingFee: 50_000n,
  worstFillPriceE6: 1_010_000n,
  accountEquity: 500_000_000n,
  symbol: "SOL",
  collateralSymbol: "USDC",
  decimals: 6,
  onConfirm: () => {},
  onCancel: () => {},
  ...over,
});

/** Mirrors OrderTicket: the modal only mounts once the user clicks submit. */
function Host({ open, props }: { open: boolean; props: ConfirmProps }) {
  return <div>{open && <TradeConfirmationModal {...props} />}</div>;
}

describe("trade confirm modal testids", () => {
  it("negative control: confirm/cancel are absent before the modal opens", () => {
    render(<Host open={false} props={confirmProps()} />);
    expect(screen.queryByTestId("trade-confirm")).toBeNull();
    expect(screen.queryByTestId("trade-cancel")).toBeNull();
  });

  it("exposes confirm and cancel and wires them to the callbacks", () => {
    const onConfirm = vi.fn();
    const onCancel = vi.fn();
    render(<Host open props={confirmProps({ onConfirm, onCancel })} />);
    fireEvent.click(screen.getByTestId("trade-confirm"));
    expect(onConfirm).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByTestId("trade-cancel"));
    expect(onCancel).toHaveBeenCalledTimes(1);
  });
});

type CloseProps = Parameters<typeof ClosePositionForm>[0];
const closeProps = (over: Partial<CloseProps> = {}): CloseProps => ({
  positionSize: 1_000_000n,
  entryPrice: 100_000_000n,
  currentPrice: 110_000_000n,
  capital: 500_000_000n,
  symbol: "SOL",
  collateralSymbol: "USDC",
  decimals: 6,
  priceUsd: 110,
  isLong: true,
  loading: false,
  onConfirm: () => {},
  onCancel: () => {},
  ...over,
});

describe("close position form testids", () => {
  it("exposes percent input, chips, confirm and cancel; confirm passes the chosen percent", () => {
    const onConfirm = vi.fn();
    render(<ClosePositionForm {...closeProps({ onConfirm })} />);
    expect(screen.getByTestId("close-percent-input")).toBeInTheDocument();
    const chips = screen.getAllByTestId("close-percent-chip");
    expect(chips.map((c) => c.getAttribute("data-percent"))).toEqual(["25", "50", "75", "100"]);
    fireEvent.click(chips[1]);
    fireEvent.click(screen.getByTestId("close-confirm"));
    expect(onConfirm).toHaveBeenCalledWith(50);
    expect(screen.getByTestId("close-cancel")).toBeInTheDocument();
  });

  it("negative control: no error element without an error, present with one", () => {
    const { rerender } = render(<ClosePositionForm {...closeProps()} />);
    expect(screen.queryByTestId("close-error")).toBeNull();
    rerender(<ClosePositionForm {...closeProps({ error: "Close failed" })} />);
    expect(screen.getByTestId("close-error")).toHaveTextContent("Close failed");
  });

  it("negative control: inline variant has no cancel button", () => {
    render(<ClosePositionForm {...closeProps({ variant: "inline" })} />);
    expect(screen.queryByTestId("close-cancel")).toBeNull();
    expect(screen.getByTestId("close-confirm")).toBeInTheDocument();
  });
});

type ProgressState = Parameters<typeof LaunchProgress>[0]["state"];
const progress = (over: Partial<ProgressState> = {}): ProgressState => ({
  step: 2,
  loading: false,
  error: null,
  slabAddress: null,
  txSigs: [],
  stepLabel: "",
  ...over,
});

describe("create wizard launch-progress testids", () => {
  it("negative control: no error/retry while the launch is healthy", () => {
    render(<LaunchProgress state={progress({ loading: true })} onRetry={() => {}} onReset={() => {}} />);
    expect(screen.queryByTestId("wizard-error")).toBeNull();
    expect(screen.queryByTestId("wizard-retry")).toBeNull();
    expect(screen.getAllByTestId("wizard-launch-step").length).toBeGreaterThan(0);
  });

  it("shows error, retry and reset when the launch fails", () => {
    const onRetry = vi.fn();
    render(<LaunchProgress state={progress({ error: "boom" })} onRetry={onRetry} onReset={() => {}} />);
    expect(screen.getByTestId("wizard-error")).toHaveTextContent("boom");
    fireEvent.click(screen.getByTestId("wizard-retry"));
    expect(onRetry).toHaveBeenCalledTimes(1);
    expect(screen.getByTestId("wizard-reset")).toBeInTheDocument();
    const active = screen.getAllByTestId("wizard-launch-step").find((e) => e.getAttribute("data-status") === "error");
    expect(active?.getAttribute("data-step")).toBe("2");
  });
});
