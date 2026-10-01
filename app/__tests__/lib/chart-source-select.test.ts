/**
 * The chart drew a flat line at 114.629292 — ONE stale internal trade — with
 * the price axis pinned to 114.58-114.68, while the header read $121.253 and
 * the DEX source held 1000 bars ending at 121.51.
 *
 * Cause: an escape hatch let a sub-threshold Percolator series win whenever an
 * external feed errored, and because the DEX source was only consulted after
 * Percolator lost, it was never reached.
 *
 * NO PYTH: the chart's sources are Percolator trades, the mint's DEX pool
 * history (GeckoTerminal) and the market's on-chain mark history (oracle).
 * The external price-feed tier is gone; these tests pin that the chart still
 * picks the DEX source for DEX-priced markets.
 *
 * See lib/chart-source-select.ts.
 */

import { describe, expect, it } from "vitest";
import {
  selectChartSource,
  MIN_PERC_BARS,
  type ChartFetchStatus,
  type ChartSourceState,
} from "@/lib/chart-source-select";

const none: ChartSourceState = { status: "success", pricedBars: 0 };
const loading: ChartSourceState = { status: "loading", pricedBars: 0 };
const idle: ChartSourceState = { status: "idle", pricedBars: 0 };
const errored: ChartSourceState = { status: "error", pricedBars: 0 };
const empty: ChartSourceState = { status: "empty", pricedBars: 0 };
const bars = (n: number): ChartSourceState => ({ status: "success", pricedBars: n });

describe("DEX-priced markets chart from the DEX (GeckoTerminal) source", () => {
  it("a fresh relaunch market (pumpswap / meteora-dlmm pool, no trades yet) shows the pool history", () => {
    expect(selectChartSource({ percolator: none, dex: bars(184) })).toBe("dex");
  });

  it("the DEX source wins while Percolator is still loading", () => {
    expect(
      selectChartSource({ percolator: { status: "loading", pricedBars: 0 }, dex: bars(1000) }),
    ).toBe("dex");
  });

  it("the DEX source wins over an errored Percolator route", () => {
    expect(selectChartSource({ percolator: errored, dex: bars(1000) })).toBe("dex");
  });

  it("no input combination ever selects anything outside percolator / dex / oracle", () => {
    // There is no external price-feed tier any more. Sweep the whole input
    // space so a resurrected tier would have to show up here.
    const statuses: ChartFetchStatus[] = ["idle", "loading", "success", "empty", "error"];
    const counts = [0, 1, MIN_PERC_BARS - 1, MIN_PERC_BARS, 500];
    const allowed = new Set(["percolator", "dex", "oracle"]);
    for (const ps of statuses) for (const pn of counts)
      for (const ds of statuses) for (const dn of counts)
        for (const applicable of [true, false]) {
          const out = selectChartSource({
            percolator: { status: ps, pricedBars: pn },
            dex: { status: ds, pricedBars: dn, applicable },
          });
          expect(allowed.has(out), `${ps}/${pn} ${ds}/${dn}/${applicable} -> ${out}`).toBe(true);
        }
  });
});

describe("a thin internal series must not outrank a healthy one", () => {
  it("THE BUG: 1 Percolator bar loses to 1000 DEX bars", () => {
    // Exactly the shipped defect, in the numbers measured on SOL/USD 5m.
    expect(selectChartSource({ percolator: bars(1), dex: bars(1000) })).toBe("dex");
  });

  it("holds at every count below the threshold", () => {
    for (let n = 1; n < MIN_PERC_BARS; n++) {
      expect(selectChartSource({ percolator: bars(n), dex: bars(1000) })).toBe("dex");
    }
  });

  it("CONTROL: at the threshold Percolator wins, as it always should have", () => {
    // Guards against fixing the override by disabling the internal source —
    // the market's own trades ARE the truest series once there are enough.
    expect(
      selectChartSource({ percolator: bars(MIN_PERC_BARS), dex: bars(1000) }),
    ).toBe("percolator");
  });

  it("CONTROL: one bar below the threshold does not win", () => {
    // The classic off-by-one on a `>=` boundary.
    expect(
      selectChartSource({ percolator: bars(MIN_PERC_BARS - 1), dex: bars(500) }),
    ).toBe("dex");
  });
});

describe("something still beats nothing", () => {
  it("a lone Percolator bar wins once the DEX source settles empty", () => {
    // The escape hatch's real intent, preserved: a long-tail token with no
    // DEX pool should show its own trades rather than a blank chart.
    expect(selectChartSource({ percolator: bars(1), dex: none })).toBe("percolator");
    expect(selectChartSource({ percolator: bars(3), dex: errored })).toBe("percolator");
  });

  it("falls to the oracle when nothing has any bars", () => {
    expect(selectChartSource({ percolator: none, dex: errored })).toBe("oracle");
  });
});

describe("a source still loading is not a source with nothing", () => {
  it("does not promote a thin series while the DEX request is in flight", () => {
    // THE FLICKER: the stub used to flash in during the DEX round trip and
    // then be replaced, which read as "good chart for a second, then one line".
    expect(selectChartSource({ percolator: bars(1), dex: loading })).toBe("oracle");
  });

  it("promotes it once that request settles with nothing", () => {
    // CONTROL for the above: "wait for loading" must not become "wait forever".
    expect(selectChartSource({ percolator: bars(1), dex: none })).toBe("percolator");
  });

  it("treats an APPLICABLE idle source as not-yet-settled", () => {
    // A source that has simply not started yet must not count as "nothing".
    // An INAPPLICABLE idle source is different and is covered below.
    expect(selectChartSource({ percolator: bars(1), dex: idle })).toBe("oracle");
  });
});

describe("bars without a settled status do not count", () => {
  // Every fixture pairs `success` with a bar count, so the status guards were
  // never actually exercised: a version that dropped `status === "success"`
  // and looked only at `pricedBars` passed everything.
  it("ignores an in-flight Percolator batch that already carries bars", () => {
    expect(
      selectChartSource({ percolator: { status: "loading", pricedBars: 50 }, dex: bars(184) }),
    ).toBe("dex");
  });

  it("does not let an in-flight Percolator batch take the last-resort slot", () => {
    expect(
      selectChartSource({ percolator: { status: "loading", pricedBars: 5 }, dex: errored }),
    ).toBe("oracle");
  });
});

describe("the empty status", () => {
  // The hooks report "empty" — not "success" with zero rows — for a batch that
  // came back with nothing. Checking only "success" made the fallback
  // unreachable for the commonest real case: a mint with no GeckoTerminal
  // pool, or an upstream 429 the route maps to an empty 200.
  it("counts as settled, so a market still shows its own trades", () => {
    expect(selectChartSource({ percolator: bars(2), dex: empty })).toBe("percolator");
  });

  it("CONTROL: an empty Percolator source still cannot WIN over DEX data", () => {
    expect(selectChartSource({ percolator: empty, dex: bars(184) })).toBe("dex");
  });

  it("CONTROL: loading still waits", () => {
    // Only `loading` blocks the fallback; if "empty" had been folded in as
    // "pending", the case above would wrongly return oracle.
    expect(selectChartSource({ percolator: bars(2), dex: loading })).toBe("oracle");
  });
});

describe("a source that can never answer is settled, not pending", () => {
  // useTokenChart sets `idle` and returns without fetching when its mint is
  // null, and stays there for the life of the page.
  const inapplicable: ChartSourceState = { status: "idle", pricedBars: 0, applicable: false };

  it("shows a market its OWN trades when the DEX source does not apply", () => {
    // THE REGRESSION THIS PREVENTS: a market with no mainnet_ca would
    // otherwise sit on `idle` forever, never satisfy "settled empty", and
    // render the oracle series permanently instead of the trades it has.
    expect(selectChartSource({ percolator: bars(3), dex: inapplicable })).toBe("percolator");
  });

  it("an inapplicable source never wins even if it somehow reports bars", () => {
    expect(
      selectChartSource({
        percolator: none,
        dex: { status: "success", pricedBars: 500, applicable: false },
      }),
    ).toBe("oracle");
  });

  it("CONTROL: applicable defaults to true when omitted", () => {
    // Every other test in this file omits the flag; if the default flipped,
    // they would all silently change meaning.
    expect(selectChartSource({ percolator: bars(1), dex: loading })).toBe("oracle");
  });
});
