/**
 * What a market creator may and may not set — the Control Room contract.
 *
 * Spec: creators choose LEVERAGE, LIQUIDITY and INSURANCE. They must never be
 * able to change the TRADING FEE — one rate for every market, so nobody
 * undercuts the fees that keep their market solvent.
 *
 * This file replaces step-parameters-contract.test.tsx: PR #2404 deleted
 * StepParameters in favour of StepControlRoom and, in doing so, wired the
 * trading fee to an editable RotaryDial. The invariant survived the redesign
 * only because it is re-asserted here against the NEW component — a contract
 * test that points at a deleted file protects nothing.
 *
 * The insurance floor is tested for the same reason: insurance is written ONCE
 * at creation, and markets seeded at 0 (H9ey1RBn… / 4hJ9hUot…) are permanently
 * blocklisted because they cannot be repaired.
 */
import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { StepControlRoom } from "@/components/create/StepControlRoom";

/** The component's own source — these are contract assertions about what the
 *  file may contain, which is stronger than any render-time probe. */
const SRC = readFileSync(
  join(__dirname, "../../components/create/StepControlRoom.tsx"),
  "utf8",
);

function renderStep(over: Record<string, unknown> = {}) {
  const props = {
    symbol: "TEST",
    oracleLabel: "Keeper (Pump.fun)",
    startPrice: "$0.004869",
    slabBytes: 26508,
    rentSol: 0.185,
    initialMarginBps: 1000,
    tradingFeeBps: 30,
    lpCollateral: "1000",
    insuranceAmount: "100",
    collateralSymbol: "USDC",
    // 1,000 LP + 100 insurance + 2 x 1,000 backing (the wizard passes its launch-gate total).
    seedTotal: 3100,
    seedBacking: 2000,
    onMarginBpsChange: vi.fn(),
    onLpCollateralChange: vi.fn(),
    onInsuranceChange: vi.fn(),
    onLaunch: vi.fn(),
    onBack: vi.fn(),
    ...over,
  };
  return render(<StepControlRoom {...(props as never)} />);
}

describe("StepControlRoom — creator-settable contract", () => {
  it("exposes NO setter for the trading fee in its prop contract", () => {
    // The strongest form of this assertion: the component cannot receive a
    // fee-change handler at all, so no future edit can quietly wire a control
    // to one without also changing the contract.
    expect(SRC).not.toMatch(/onTradingFeeBpsChange/);
  });

  it("renders the trading fee as fixed text, not an editable control", () => {
    renderStep({ tradingFeeBps: 30 });
    // UX WP-10 (§5.1): shown as a percentage.
    expect(screen.getAllByText(/0\.30%/i).length).toBeGreaterThan(0);
    // No slider/spinbutton is bound to the fee value.
    const dials = screen.queryAllByRole("slider").concat(screen.queryAllByRole("spinbutton"));
    for (const d of dials) {
      expect(d.getAttribute("aria-label") ?? "").not.toMatch(/trading fee/i);
    }
  });

  it("does NOT claim the fee is the same on every market", () => {
    // This test previously asserted the opposite, pinning a claim the code
    // does not implement: the fee is derived from the token's liquidity tier
    // (20 / 10 / 5 bps in useQuickLaunch) and that value is what reaches the
    // chain, so the readout rendered e.g. "20 bps - same on every market" and
    // contradicted itself. FIXED_TRADING_FEE_BPS declares the uniform-rate
    // policy but has no callers. See #2563.
    renderStep();
    expect(document.body.textContent ?? "").not.toMatch(/same on every market/i);
  });

  it("explains that the fee is chosen for the creator, not by them", () => {
    // The true half of the original claim, and the part a creator needs: they
    // cannot set this number (see the fixed-text test above), it is set by the
    // token's liquidity.
    renderStep();
    expect(document.body.textContent ?? "").toMatch(/set by token liquidity/i);
  });

  it("never lets the insurance dial reach 0 — insurance is write-once", () => {
    // The dial's floor is the named constant, not a literal 0.
    expect(SRC).toMatch(/const MIN_INSURANCE = 100/);
    expect(SRC).toMatch(/min=\{MIN_INSURANCE\}/);
    expect(SRC).not.toMatch(/label="Insurance"[\s\S]{0,120}min=\{0\}/);
  });

  it("still lets the creator set leverage, liquidity and insurance", () => {
    const onMarginBpsChange = vi.fn();
    const onLpCollateralChange = vi.fn();
    const onInsuranceChange = vi.fn();
    renderStep({ onMarginBpsChange, onLpCollateralChange, onInsuranceChange });
    const body = document.body.textContent ?? "";
    expect(body).toMatch(/leverage/i);
    expect(body).toMatch(/liquidity/i);
    expect(body).toMatch(/insurance/i);
  });

  it("GH#2622: states the rent-reclaim rule up front, before launch", () => {
    // Issue #2622's "set expectations up front" ask: a creator should learn
    // the reclaim window BEFORE they hit RecoverSolBanner's gated RECLAIM
    // button after already getting stuck, not only after the fact.
    renderStep({ rentSol: 0.185 });
    const body = document.body.textContent ?? "";
    expect(body).toMatch(/reclaimable only if you stop before any deposit/i);
    expect(body).toMatch(/commits this rent permanently/i);
  });
});
