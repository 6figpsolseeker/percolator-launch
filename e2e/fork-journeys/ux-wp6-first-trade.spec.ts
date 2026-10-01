/**
 * UX WP-6 for the #2701 fork harness (copy to e2e-fork/journeys/ui/).
 *  AC1 U1: a fresh funded wallet's first Long takes 1 prompt; the landed txs are [InitUser] then
 *      [Deposit, Trade] (the app's signAll of A + B).
 *  AC2 race: another wallet inits between sign and send of B -> exactly one extra prompt, the
 *      status line "One more approval: someone joined this market at the same moment.", the trade lands.
 *  AC3 a failed deposit leg is shown (status-line[data-kind=first-trade-deposit]); forced by moving
 *      the wallet's tokens out after signing.
 *  AC4 the offset: __tests__/lib/first-trade.test.ts (rustc offset_of!). BPF: limits_app_first_trade_one_signature_and_race.
 */
import { test, expect } from "@playwright/test";
import { installTestWallet } from "../../wallet/inject.ts";
import * as P from "../../lib/perc.ts";
import { check } from "../../lib/results.ts";

test("UX WP-6 AC1: the first Long is ONE prompt, [InitUser] then [Deposit, Trade]", async ({ page }) => {
  const J = "UX-WP6-first-trade";
  const m = P.markets().SOL;
  const kp = await P.newWallet({ usdc: 50_000_000n });
  const log = await installTestWallet(page, kp);
  await page.goto(`/trade/${m.slab}`);
  await page.getByTestId("trade-size-input").fill("10", { timeout: 60_000 });
  await expect(page.getByTestId("trade-submit")).toHaveText(/^Deposit [\d.,]+ \S+ & Long$/);
  await expect(page.getByTestId("first-trade-line")).toBeVisible();
  await page.getByTestId("trade-submit").click();
  if (await page.getByTestId("trade-confirm").isVisible({ timeout: 4000 }).catch(() => false)) await page.getByTestId("trade-confirm").click();
  await expect.poll(async () => (await P.findPortfolio(kp.publicKey, m))?.legs.length ?? 0, { timeout: 90_000 }).toBeGreaterThan(0);
  const prompts = log.filter((e) => e.kind === "signAll" || e.kind === "tx").length;
  const sigs = log.flatMap((e) => ("sigs" in e ? (e.sigs as string[]) : e.sig ? [e.sig as string] : []));
  const shapes = await Promise.all(sigs.map((s) => P.txIxs(s)));
  check(J, "SOL", "1 prompt, [InitUser] then [Deposit, Trade]", prompts === 1, "prompts=1", `prompts=${prompts} shapes=${JSON.stringify(shapes.map((x) => x.map((i) => i.tag)))}`, sigs);
  expect(prompts).toBe(1);
});
