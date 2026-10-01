// @vitest-environment node
/** TradingChart no longer fetches /api/markets/:slab/prices (nothing records it on v18: always 404). */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

describe("TradingChart", () => {
  it("makes no oracle price-history request", () => {
    const src = readFileSync(join(__dirname, "..", "..", "components", "trade", "TradingChart.tsx"), "utf8");
    expect(src).not.toMatch(/\/api\/markets\/\$\{[^}]+\}\/prices/);
  });
});
