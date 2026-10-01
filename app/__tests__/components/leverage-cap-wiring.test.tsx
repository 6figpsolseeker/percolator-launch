/**
 * GH#2621 — what the creator's dial actually offers, asserted on the RENDERED
 * control rather than on the exported constants.
 *
 * The first version of these tests was a pure unit test over two numbers and two
 * pure functions. It never rendered StepControlRoom, so review reintroduced the
 * entire bug with one-line edits that left it 9/9 green:
 *
 *   max={MAX_LEVERAGE}  ->  max={6.5}                       the dial stops at 6.5x again
 *   max={MAX_LEVERAGE}  ->  max={MIN_LEVERAGE}              the dial collapses to one point
 *   onChange={(v) => onMarginBpsChange(leverageToMarginBps(v))}
 *     -> onMarginBpsChange(Math.max(1500, leverageToMarginBps(v)))
 *                                                           WORSE than the original bug:
 *                                                           shows 10x, writes 1500 bps
 *
 * The converters were well covered; the wiring between them and the control was
 * not covered at all. These close that.
 */

import { describe, expect, it, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { MAX_LEVERAGE_X, MIN_LEVERAGE_X } from "@/lib/market-params";
import { StepControlRoom } from "@/components/create/StepControlRoom";

function renderStep(over: Record<string, unknown> = {}) {
  const onMarginBpsChange = vi.fn();
  const props = {
    symbol: "TEST",
    oracleLabel: "Keeper (Pump.fun)",
    startPrice: "$0.004869",
    slabBytes: 26508,
    rentSol: 0.185,
    initialMarginBps: 2000,
    tradingFeeBps: 30,
    lpCollateral: "1000",
    insuranceAmount: "100",
    collateralSymbol: "USDC",
    // 1,000 LP + 100 insurance + 2 x 1,000 backing (the wizard passes its launch-gate total).
    seedTotal: 3100,
    seedBacking: 2000,
    onMarginBpsChange,
    onLpCollateralChange: vi.fn(),
    onInsuranceChange: vi.fn(),
    onLaunch: vi.fn(),
    onBack: vi.fn(),
    ...over,
  };
  render(<StepControlRoom {...(props as never)} />);
  return { onMarginBpsChange, dial: screen.getByRole("slider", { name: /leverage/i }) };
}

describe("the rendered leverage dial", () => {
  it("offers the engine's full range, not a private ceiling", () => {
    const { dial } = renderStep();
    expect(dial).toHaveAttribute("aria-valuemax", String(MAX_LEVERAGE_X));
    expect(dial).toHaveAttribute("aria-valuemin", String(MIN_LEVERAGE_X));
  });

  it("turning it to the top writes 1000 bps — 10x — to the wizard", () => {
    // The assertion the bug was actually about: what a creator who turns the
    // dial all the way up ends up creating. A floor hidden in the onChange
    // handler shows 10x on screen and writes 1500 bps; only this catches that.
    const { onMarginBpsChange, dial } = renderStep();
    fireEvent.keyDown(dial, { key: "End" });

    expect(onMarginBpsChange).toHaveBeenCalled();
    expect(onMarginBpsChange.mock.calls[onMarginBpsChange.mock.calls.length - 1][0]).toBe(1000);
  });

  it("turning it to the bottom writes 5000 bps — 2x", () => {
    // CONTROL for the above: the dial tracks its input rather than emitting a
    // constant, so the 1000 is a real traverse and not a stub.
    const { onMarginBpsChange, dial } = renderStep();
    fireEvent.keyDown(dial, { key: "Home" });
    expect(onMarginBpsChange.mock.calls[onMarginBpsChange.mock.calls.length - 1][0]).toBe(5000);
  });

  it("still steps in halves", () => {
    // The quantisation tests are premised on a 0.5 grid but import the
    // converters directly, so they never see the prop. A step of 1 changes what
    // a creator can reach without failing anything.
    const { onMarginBpsChange, dial } = renderStep({ initialMarginBps: 2000 }); // 5x
    fireEvent.keyDown(dial, { key: "ArrowUp" });
    // 5x -> 5.5x is 1818 bps; a step of 1 would give 6x -> 1667.
    expect(onMarginBpsChange).toHaveBeenLastCalledWith(1818);
  });

  it("does not tell the creator a protocol floor caps them", () => {
    // Half the defect was the explanation: "Max leverage is capped at 6.5x by
    // the protocol's 15% margin floor" described a rule that does not exist.
    // Nothing asserted this caption, so reverting the text alone stayed green.
    renderStep();
    const body = document.body.textContent ?? "";
    expect(body).not.toMatch(/margin floor/i);
    expect(body).not.toMatch(/capped at/i);
    // CONTROL: the explanatory paragraph IS rendered — this is a changed claim,
    // not a deleted one.
    expect(body).toMatch(/Leverage/);
    expect(body).toMatch(new RegExp(`Max leverage is ${MAX_LEVERAGE_X}×`));
  });
});
