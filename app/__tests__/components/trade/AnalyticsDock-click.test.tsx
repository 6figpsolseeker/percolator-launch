/**
 * The trade page's analytics dock tabs opened on mouseenter/focus, then the click that follows toggled
 * the panel closed, so a mouse click looked dead, and a touch tap (mouseenter, then click) never
 * opened it at all. A click now keeps a panel that hover/focus opened, and a second click closes it.
 */
import { fireEvent, render, screen } from "@testing-library/react";
import { beforeAll, describe, expect, it, vi } from "vitest";

vi.mock("@/hooks/useEngineState", () => ({ useEngineState: () => ({ engine: null, params: null, hasData: false, insuranceBalance: 0n, totalOI: 0n }) }));
vi.mock("@/components/providers/SlabProvider", () => ({ useSlabState: () => ({ config: null, header: null, raw: null, accounts: [] }) }));
vi.mock("@/hooks/useMarketInfo", () => ({ useMarketInfo: () => ({ market: null }) }));
vi.mock("@/hooks/useStakePool", () => ({ useStakePool: () => ({}) }));
vi.mock("@/hooks/useTokenMeta", () => ({ useTokenMeta: () => null }));
vi.mock("@/hooks/useLivePrice", () => ({ useLivePrice: () => ({}) }));
vi.mock("@/components/trade/EngineHealthCard", () => ({ EngineHealthCard: () => null }));
vi.mock("@/components/trade/CrankHealthCard", () => ({ CrankHealthCard: () => null }));

import { AnalyticsDock } from "@/components/trade/AnalyticsDock";

beforeAll(() => {
  vi.stubGlobal("IntersectionObserver", class { observe() {} disconnect() {} });
});

const tab = (name: RegExp) => screen.getByRole("button", { name });
const expanded = (name: RegExp) => tab(name).getAttribute("aria-expanded");

describe("analytics dock tabs", () => {
  it("mouse: hover opens, the click that follows keeps it open, a second click closes", () => {
    render(<AnalyticsDock slab="Slab111" />);
    fireEvent.mouseEnter(tab(/health/i));
    expect(expanded(/health/i)).toBe("true");
    fireEvent.focus(tab(/health/i));
    fireEvent.click(tab(/health/i));
    expect(expanded(/health/i)).toBe("true");
    fireEvent.click(tab(/health/i));
    expect(expanded(/health/i)).toBe("false");
  });

  it("touch: a tap (mouseenter, then click) opens it, and a second tap closes it", () => {
    render(<AnalyticsDock slab="Slab111" />);
    // Separate events, as a browser delivers them: a render happens between the two.
    fireEvent.mouseEnter(tab(/capital/i));
    fireEvent.click(tab(/capital/i));
    expect(expanded(/capital/i)).toBe("true");
    fireEvent.click(tab(/capital/i));
    expect(expanded(/capital/i)).toBe("false");
  });

  it("a click on another tab switches to it", () => {
    render(<AnalyticsDock slab="Slab111" />);
    fireEvent.click(tab(/health/i));
    fireEvent.mouseEnter(tab(/fees/i));
    fireEvent.click(tab(/fees/i));
    expect(expanded(/fees/i)).toBe("true");
    expect(expanded(/health/i)).toBe("false");
  });
});
