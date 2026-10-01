// @vitest-environment node
/** E2E B3 / B5 / B6 / B17 (feat/limits-ui). */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { buildMarketDirectoryFallback } from "@/lib/markets-fallback";
import { PLAYGROUND_SLAB_META } from "@/lib/playground-slab-meta";
import { chargedTradeFeeLabel } from "@/lib/limits/format";
import { positionNftEmptyText, sideCapacityForDisplay } from "@/lib/trade-display";

const src = (f: string) => readFileSync(join(process.cwd(), f), "utf8");

describe("B3: the markets static fallback comes from config", () => {
  it("one row per curated slab, all under the given (configured) program id, template fields kept", () => {
    const rows = buildMarketDirectoryFallback(PLAYGROUND_SLAB_META, "PROG", { decimals: 6, volume_24h: 0 });
    expect(rows.map((r) => r.slab_address).sort()).toEqual(Object.keys(PLAYGROUND_SLAB_META).sort());
    for (const r of rows) {
      expect(r.program_id).toBe("PROG");
      expect(r.decimals).toBe(6);
      expect(r.symbol).toBe(PLAYGROUND_SLAB_META[r.slab_address as string].symbol);
    }
  });
  it("the route has no hard-coded fallback slab any more", () => {
    const s = src("app/api/markets/route.ts");
    expect(s).toContain("buildMarketDirectoryFallback(PLAYGROUND_SLAB_META, resolveDevnetProgramIds().wrapper");
    expect(s).not.toMatch(/slab_address: "AzagguvrWmRgcBpsKuqomW7Yb1YUUd6UzcrkiRsqdhr"/);
  });
});

describe("B5: Earn shows the CHARGED fee (trade_fee_base_bps), not the matcher's tradingFeeBps", () => {
  it("30 bps -> 0.30%; 5 -> 0.05%; 125 -> 1.25%; unreadable -> null", () => {
    expect(chargedTradeFeeLabel(30n)).toBe("0.30%");
    expect(chargedTradeFeeLabel(5n)).toBe("0.05%");
    expect(chargedTradeFeeLabel(125n)).toBe("1.25%");
    expect(chargedTradeFeeLabel(null)).toBeNull();
  });
  it("both Earn surfaces read it from the slab", () => {
    for (const f of ["app/earn/[slab]/page.tsx", "components/earn/VaultDepositRail.tsx"]) {
      expect(src(f)).toContain("chargedTradeFeeLabel(slabRaw ? decodeMarketEngineView(slabRaw)?.tradeFeeBaseBps : null)");
      expect(src(f)).not.toMatch(/tradingFeeBps \?\? 10\) \/ 100\)\.toFixed\(2\)/);
    }
  });
});

describe("B6: trade page copy", () => {
  it("a connected wallet is never asked to connect", () => {
    expect(positionNftEmptyText(false)).toMatch(/Connect wallet/);
    expect(positionNftEmptyText(true)).not.toMatch(/Connect wallet/);
  });
  it("a depleted / underfunded LP advertises no side capacity", () => {
    expect(sideCapacityForDisplay(26_329_000_000n, true)).toBe(0n);
    expect(sideCapacityForDisplay(26_329_000_000n, false)).toBe(26_329_000_000n);
    expect(sideCapacityForDisplay(null, true)).toBeNull();
  });
});

describe("B17: the P3 tranche card is on the market's own Earn page", () => {
  it("/earn/[slab] mounts EarnTrancheCardView with the page's limits + view", () => {
    const s = src("app/earn/[slab]/page.tsx");
    expect(s).toContain("<EarnTrancheCardView");
    expect(s).toContain("const earnLimits = useMarketLimits(slabAddress);");
    expect(s).toContain("earnViewFromLimits(earnLimits, lpVaultState.vaultTotalAtoms, lpVaultState.userLpBalance, undefined, lpValuation.value)");
  });
});
