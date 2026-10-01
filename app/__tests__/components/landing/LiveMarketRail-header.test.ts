/**
 * Binds the live-market rail's column-header row to its source.
 *
 * The rail rendered three unlabeled stat columns (max leverage, 24h volume,
 * live price), so the numbers read as ambiguous — "10x" as a bare badge, a lone
 * "$3.3M" on the only market with 24h volume as if it were an error, and no
 * label for the price. RailHeader adds a column key. This test guards that:
 *   - the header exists and is rendered inside the card, before the rows;
 *   - it labels all three stat columns plus the market column;
 *   - each stat label carries the SAME responsive reveal breakpoint as its data
 *     column (Lev on sm:, 24h Vol on md:) so labels stay above their columns;
 *   - it is aria-hidden (values are already exposed by the row links — the
 *     header is a visual key, not a second a11y source).
 *
 * Source-binding (reads the component text) rather than a render: the payoff is
 * the layout WIRING matching RailRow, and the rail would otherwise need
 * useAllMarketStats/priceStore/next-link mocks to render. Same rationale as
 * create-market-price-gate.test.ts.
 */
import { describe, expect, it } from "vitest";
import fs from "fs";
import path from "path";

const SRC = fs.readFileSync(
  path.resolve(__dirname, "../../../components/landing/LiveMarketRail.tsx"),
  "utf8",
);

describe("LiveMarketRail column header", () => {
  it("defines a RailHeader and renders it inside the card before the rows", () => {
    expect(SRC).toMatch(/const RailHeader: FC =/);
    // Rendered ahead of the rows.map(...) row list.
    const headerAt = SRC.indexOf("<RailHeader />");
    const mapAt = SRC.indexOf("rows.map");
    expect(headerAt).toBeGreaterThan(-1);
    expect(mapAt).toBeGreaterThan(-1);
    expect(headerAt).toBeLessThan(mapAt);
  });

  it("labels the market column and all three stat columns", () => {
    expect(SRC).toMatch(/>\s*Market\s*</);
    expect(SRC).toMatch(/>\s*Lev\s*</);
    expect(SRC).toMatch(/>\s*24h Vol\s*</);
    expect(SRC).toMatch(/>\s*Price\s*</);
  });

  it("reveals each stat label at the same breakpoint as its data column", () => {
    const header = SRC.slice(
      SRC.indexOf("const RailHeader"),
      SRC.indexOf("The landing page's live market rail"),
    );
    // Lev column is sm:block in RailRow; 24h Vol is md:block. minWidths match too.
    expect(header).toMatch(/hidden shrink-0 text-right sm:block[^>]*minWidth: 28/s);
    expect(header).toMatch(/hidden shrink-0 text-right md:block[^>]*minWidth: 68/s);
    expect(header).toMatch(/shrink-0 text-right[^>]*minWidth: 84/s);
  });

  it("is aria-hidden — the row links already expose each value", () => {
    const header = SRC.slice(SRC.indexOf("const RailHeader"), SRC.indexOf("LiveMarketRail()"));
    expect(header).toContain('aria-hidden="true"');
  });
});
