/**
 * UX WP-5 AC1 for the #2701 fork harness (copy to e2e-fork/journeys/ui/): stop the keeper, trade
 * so the vault LP holds inventory (its certificate goes stale), open the Earn page. The card shows
 * a share value within 1 atom of the value after a real crank; "Needs refresh" never renders; the
 * deposit button stays enabled and a deposit lands in ONE prompt (the 85 crank is bundled).
 */
import { test, expect } from "@playwright/test";
import { installTestWallet } from "../../wallet/inject.ts";
import * as P from "../../lib/perc.ts";
import { check } from "../../lib/results.ts";
import { keeper } from "../chain/forced.ts";

test("UX WP-5 AC1: stale certificate -> valued by simulation, deposit in one prompt", async ({ page }) => {
  const J = "UX-WP5-earn-card";
  const m = P.markets().SOL;
  keeper("stop");
  try {
    const trader = await P.newWallet({ usdc: 3_000_000_000n });
    await P.openPosition(trader, m, 20_000_000n); // the vault LP takes the other side
    const kp = await P.newWallet({ usdc: 2_000_000_000n });
    const log = await installTestWallet(page, kp);
    await page.goto(`/earn/${m.slab}`);
    const card = page.getByTestId("limits-tranche-card");
    await expect(card).toBeVisible({ timeout: 60_000 });
    await expect.poll(async () => (await page.getByTestId("limits-share-price").getAttribute("data-price-e6")) ?? "", { timeout: 60_000 }).not.toBe("");
    expect(await page.locator("body").textContent()).not.toMatch(/Needs refresh/);
    const shown = BigInt((await page.getByTestId("limits-share-price").getAttribute("data-price-e6")) ?? "0");
    await P.crankVaultLp(m);
    const actual = await P.earnSharePriceE6(m);
    check(J, "SOL", "simulated share value = post-crank", shown - actual <= 1n && actual - shown <= 1n, `actual=${actual}`, `shown=${shown}`, []);
    await page.locator("[data-testid=earn-tab][data-tab=deposit]").click();
    await page.getByTestId("earn-deposit-input").fill("10");
    await expect(page.getByTestId("earn-deposit-submit")).toBeEnabled();
    await page.getByTestId("earn-deposit-submit").click();
    await expect.poll(async () => log.filter((e) => e.kind === "tx").length, { timeout: 90_000 }).toBe(1);
  } finally {
    keeper("start");
  }
});
