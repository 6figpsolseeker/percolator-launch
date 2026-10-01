/**
 * Review of #2720: with the new /api/insurance on a v18 market with zero open interest, the
 * dashboard must not invent "$0 fee revenue (+$0/d)" or flag "Low · 0.0x coverage".
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";

vi.mock("@/components/providers/SlabProvider", () => ({ useSlabState: () => ({ engine: null, config: null }) }));

import { InsuranceDashboard } from "@/components/market/InsuranceDashboard";

beforeEach(() => {
  globalThis.fetch = vi.fn(async () =>
    new Response(JSON.stringify({ balance: "250039611", totalRisk: "0", totalOpenInterestQ: "0", feeRevenue: null, dailyAccumulationRate: null, historicalBalance: [], source: "on-chain" }), { status: 200 }),
  ) as typeof fetch;
});

describe("InsuranceDashboard on a v18 market with no open interest", () => {
  it("shows the balance, no fee revenue row, and 'No open interest' instead of 'Low'", async () => {
    render(<InsuranceDashboard slabAddress="9EPm8nB8Fs7WcEZgE1WGFPTGc6rAzD6GhFJyMm4dEFHn" />);
    await waitFor(() => expect(screen.getByText(/No open interest/)).toBeTruthy());
    expect(screen.queryByText(/Fee Revenue/i)).toBeNull();
    expect(screen.queryByText(/^Low$/)).toBeNull();
    expect(screen.queryByText(/x coverage/)).toBeNull();
  });
});
