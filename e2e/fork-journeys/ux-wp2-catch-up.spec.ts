/**
 * UX WP-2 AC1/AC2 (+AC4 control), for the #2701 fork harness (copy to e2e-fork/journeys/ui/).
 * AC1: stop the keeper for 300 real slots, click Long: exactly 1 prompt; if the market lagged far
 *      enough to refuse, the landed tx is [CU…, crank×k, trade] (the app's catch-up, lib/self-heal
 *      planCatchUp). On 4b1a5d30 a trade usually catches the engine up by itself (LiteSVM probe
 *      `limits_probe_lag`), so the journey asserts 1 prompt + a landed trade either way and records
 *      whether cranks were included.
 * AC2: beyond the catch-up cap (dt x 40 slots), the ticket shows status-line[data-kind=engine-catching-up]
 *      and a disabled "Waiting for prices…"; restarting the keeper re-enables it with no click/reload.
 */
import { test, expect } from "@playwright/test";
import { installTestWallet } from "../../wallet/inject.ts";
import * as P from "../../lib/perc.ts";
import { check } from "../../lib/results.ts";
import { keeper } from "../chain/forced.ts";

test("UX WP-2 AC1: keeper stopped 300 slots -> one prompt, the trade lands (cranks prepended if needed)", async ({ page }) => {
  const J = "UX-WP2-catch-up";
  const sym = "SOL";
  const m = P.markets()[sym];
  const kp = await P.newWallet({ usdc: 3_000_000_000n });
  const port = await P.createPortfolio(kp, m);
  await P.mustSend("deposit", [await P.depositIx(kp.publicKey, m, port, 1_000_000_000n)], [kp]);
  keeper("stop");
  try {
    await P.advanceSlots(300);
    const log = await installTestWallet(page, kp);
    await page.goto(`/trade/${m.slab}`);
    await page.getByTestId("trade-side-long").click({ timeout: 60_000 });
    await page.getByTestId("trade-size-input").fill("20");
    await page.getByTestId("trade-submit").click();
    if (await page.getByTestId("trade-confirm").isVisible({ timeout: 4000 }).catch(() => false)) await page.getByTestId("trade-confirm").click();
    await expect.poll(async () => (await P.readPortfolio(port)).legs.length, { timeout: 90_000 }).toBeGreaterThan(0);
    const prompts = log.filter((e) => e.kind === "tx").length;
    const sig = log.filter((e) => e.kind === "tx").pop()?.sig;
    const ixs = sig ? await P.txIxs(sig) : [];
    const cranks = ixs.filter((i) => i.program === P.WRAPPER.toBase58() && i.tag === 5).length;
    check(J, sym, "1 prompt, trade landed", prompts === 1, "prompts=1", `prompts=${prompts} cranks=${cranks} ixs=${JSON.stringify(ixs)}`, sig ? [sig] : []);
    expect(prompts).toBe(1);
    await page.screenshot({ path: `.run/shots/UX-WP2-catch-up-1440.png`, fullPage: true }).catch(() => undefined);
  } finally {
    keeper("start");
  }
});

test("UX WP-2 AC2: beyond the cap -> calm waiting state that clears itself", async ({ page }) => {
  const J = "UX-WP2-beyond-cap";
  const sym = "SOL";
  const m = P.markets()[sym];
  const kp = await P.newWallet({ usdc: 3_000_000_000n });
  const port = await P.createPortfolio(kp, m);
  await P.mustSend("deposit", [await P.depositIx(kp.publicKey, m, port, 1_000_000_000n)], [kp]);
  const dt = Number((await P.readMarket(m)).config?.maxAccrualDtSlots ?? 500);
  keeper("stop");
  try {
    await P.advanceSlots(dt * 40 + 50);
    await installTestWallet(page, kp);
    await page.goto(`/trade/${m.slab}`);
    const line = page.getByTestId("status-line");
    await expect(line).toHaveAttribute("data-kind", "engine-catching-up", { timeout: 60_000 });
    await expect(page.getByTestId("trade-submit")).toBeDisabled();
    await expect(page.getByTestId("trade-submit")).toHaveText("Waiting for prices…");
    await page.screenshot({ path: `.run/shots/UX-WP2-beyond-cap-1440.png`, fullPage: true }).catch(() => undefined);
    await page.setViewportSize({ width: 375, height: 812 });
    await page.screenshot({ path: `.run/shots/UX-WP2-beyond-cap-375.png`, fullPage: true }).catch(() => undefined);
  } finally {
    keeper("start");
  }
  await expect(page.getByTestId("trade-submit")).toBeEnabled({ timeout: 180_000 });
  check(J, sym, "re-enabled with no click or reload", true, "enabled", "enabled");
});
