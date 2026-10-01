/** UX WP-10 (audit §4.8): on phones the /markets sort is one "Sort" select; tabs only from md up. */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const src = readFileSync(resolve(process.cwd(), "app/markets/page.tsx"), "utf8");

describe("/markets sort", () => {
  it("a select below md bound to the same sort state; the tab group is md+ only", () => {
    expect(src).toMatch(/<label className="md:hidden[^"]*">\s*<span>Sort<\/span>\s*<select\s+data-testid="markets-sort-select"/);
    expect(src).toContain("value={sortBy}");
    expect(src).toContain("onChange={(e) => setSortBy(e.target.value as SortKey)}");
    expect(src).toContain('className="relative hidden md:flex gap-1');
    // one option list for both, every sort key present
    const opts = src.slice(src.indexOf("const MARKET_SORT_OPTIONS"), src.indexOf("];", src.indexOf("const MARKET_SORT_OPTIONS")));
    for (const k of ["volume", "oi", "health", "recent"]) expect(opts).toContain(`key: "${k}"`);
    expect(src.match(/MARKET_SORT_OPTIONS\.map/g)).toHaveLength(2);
  });
});
