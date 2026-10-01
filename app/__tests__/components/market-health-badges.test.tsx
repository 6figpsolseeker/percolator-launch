import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { MarketHealthBadges, MarketHealthBanner } from "@/components/market/MarketHealthBadges";
import type { MarketHealthRow } from "@/lib/market-health";

const row = (over: Partial<MarketHealthRow> = {}): MarketHealthRow => ({
  lpCapital: "0",
  lpDepleted: true,
  payoutHaircutBps: 5179,
  openProfitAtoms: "10000000",
  realizableProfitAtoms: "4821000",
  lockReasons: ["repairable"],
  badges: [
    { id: "lp-depleted", label: "LP depleted", tone: "danger", detail: "no LP capital" },
    { id: "payout-haircut", label: "Payout haircut 52%", tone: "danger", detail: "48%" },
    { id: "repairable", label: "Needs repair", tone: "info", detail: "repair" },
  ],
  ...over,
});

describe("MarketHealthBadges", () => {
  it("renders badges with stable testids", () => {
    render(<MarketHealthBadges row={row()} />);
    const ids = screen.getAllByTestId("market-health-badge").map((e) => e.getAttribute("data-badge"));
    expect(ids).toEqual(["lp-depleted", "payout-haircut", "repairable"]);
    expect(screen.getByText("LP depleted")).toBeTruthy();
  });
  it("compact + hideInfo keeps only Close-only / Paused / Settled (UX WP-10 §4.3) and caps the count", () => {
    render(<MarketHealthBadges row={row()} compact hideInfo />);
    expect(screen.getAllByTestId("market-health-badge").map((e) => e.getAttribute("data-badge"))).toEqual(["lp-depleted"]);
  });
  it("NEGATIVE CONTROL: unknown health renders nothing (not 'healthy', not 'broken')", () => {
    const { container } = render(<MarketHealthBadges row={null} />);
    expect(container.innerHTML).toBe("");
  });
  it("NEGATIVE CONTROL: a healthy row (no badges) renders nothing", () => {
    const { container } = render(<MarketHealthBanner row={row({ badges: [], lpDepleted: false, lockReasons: [] })} />);
    expect(container.innerHTML).toBe("");
  });
  it("banner shows only serious badges with their explanation", () => {
    render(<MarketHealthBanner row={row()} />);
    expect(screen.getByTestId("market-health-banner")).toBeTruthy();
    expect(screen.getByText("no LP capital")).toBeTruthy();
    expect(screen.queryByText("Needs repair")).toBeNull();
  });
});
