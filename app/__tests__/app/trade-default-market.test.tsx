/**
 * /trade (the mobile nav's Trade tab, the faucet's "Start trading") picks a default market. It sorted
 * by volume_24h, a base-token quantity, so a sub-cent token always won: live 2026-10-01 it sent users
 * to TRENDS ($3,906 of USD volume) over SI ($9,210). It sorts by the USD volume /markets uses now,
 * and the spinner no longer says "Loading SOL…" (no SOL market exists after the relaunch).
 */
import { render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const replace = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ replace }) }));

import TradeRedirectPage from "@/app/trade/page";

function markets(rows: unknown[]) {
  vi.stubGlobal("fetch", vi.fn(async () => ({ ok: true, json: async () => ({ markets: rows }) })));
}

// Live 2026-10-01 rows (trimmed).
const TRENDS = { slab_address: "Fz5J", symbol: "TRENDS", last_price: 0.00016, volume_24h: 24_415_928_423_996, volume_24h_usd: 3906.55, total_open_interest: 1, total_open_interest_usd: 10 };
const SI = { slab_address: "8WC8", symbol: "SI", last_price: 0.0046, volume_24h: 2_017_509_901_313, volume_24h_usd: 9209.93, total_open_interest: 1, total_open_interest_usd: 10 };
const QUIET = { slab_address: "Ev5D", symbol: "PUTIN", last_price: 0.01, volume_24h: null, total_open_interest: null };

describe("/trade default market", () => {
  beforeEach(() => replace.mockReset());

  it("goes to the highest USD volume, not the largest token count", async () => {
    markets([TRENDS, SI, QUIET]);
    render(<TradeRedirectPage />);
    await waitFor(() => expect(replace).toHaveBeenCalledWith("/trade/8WC8"));
  });

  it("without USD fields, values the token volume at the last price", async () => {
    const strip = ({ volume_24h_usd: _v, total_open_interest_usd: _o, ...r }: Record<string, unknown>) => r;
    markets([strip(TRENDS), strip(SI)]);
    render(<TradeRedirectPage />);
    await waitFor(() => expect(replace).toHaveBeenCalledWith("/trade/8WC8"));
  });

  it("no volume anywhere: the USD open interest breaks the tie", async () => {
    markets([
      { ...QUIET, slab_address: "A", total_open_interest_usd: 50 },
      { ...QUIET, slab_address: "B", total_open_interest_usd: 900 },
    ]);
    render(<TradeRedirectPage />);
    await waitFor(() => expect(replace).toHaveBeenCalledWith("/trade/B"));
  });

  it("CONTROL: a SOL market is still preferred when one exists", async () => {
    markets([SI, { ...QUIET, slab_address: "SOL1", symbol: "SOL-PERP" }]);
    render(<TradeRedirectPage />);
    await waitFor(() => expect(replace).toHaveBeenCalledWith("/trade/SOL1"));
  });

  it("the spinner names no market", () => {
    markets([]);
    render(<TradeRedirectPage />);
    expect(screen.getByText("Loading market…")).toBeTruthy();
    expect(screen.queryByText(/Loading SOL/)).toBeNull();
  });
});
