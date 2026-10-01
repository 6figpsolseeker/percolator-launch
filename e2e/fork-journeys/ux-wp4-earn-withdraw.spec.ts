/**
 * UX WP-4 for the #2701 fork harness (copy to e2e-fork/journeys/ui/). User decision 2026-09-30:
 * the redemption cooldown stays (~150 slots), so a withdrawal is TWO signatures that feel like
 * one flow; only a cooldown-0 vault does [76, 77] in one tx.
 *  AC1 U2 on P3 bytes: click Withdraw -> prompt 1 (76) -> pending card counts down -> prompt 2
 *      (77) opens by itself with no click -> USDC in wallet; the wallet delta equals the
 *      "You receive ≈" estimate (withdraw-side worse-of price) to the cent.
 *  AC2 88 forced (p3_senior_draw.limits-app.patch recipe): "Withdraw {max_now}" shows BEFORE
 *      any prompt; choosing it lands with the same two prompts.
 *  AC3 reload between 76 and 77: the card says "Ready to collect" / "Finish withdrawal"; one
 *      click collects (1 prompt).
 *  AC4 "No active LP position" / "Max: 0 LP" never render while a ticket is pending.
 *  AC5 control: a cooldown-0 vault withdraws in ONE prompt ([76, 77] in one tx).
 */
import { test, expect } from "@playwright/test";
import { installTestWallet } from "../../wallet/inject.ts";
import * as P from "../../lib/perc.ts";
import { check } from "../../lib/results.ts";

const J = "UX-WP4-earn-withdraw";

test("UX WP-4 AC1/AC4: two prompts, one flow, the payout opens by itself", async ({ page }) => {
  const sym = "SOL";
  const m = P.markets()[sym];
  const kp = await P.newWallet({ usdc: 2_000_000_000n });
  await P.earnDeposit(kp, m, 1_000_000_000n);
  const log = await installTestWallet(page, kp);
  await page.goto(`/earn/${m.slab}`);
  await page.locator("[data-testid=earn-tab][data-tab=withdraw]").click({ timeout: 60_000 });
  await page.getByTestId("earn-withdraw-input").fill("100");
  const est = (await page.getByTestId("earn-withdraw-receive").textContent()) ?? "";
  const before = await P.usdcBalance(kp.publicKey);
  await page.getByTestId("earn-withdraw-request").click();
  await expect(page.getByTestId("earn-pending-withdrawal")).toHaveAttribute("data-phase", "counting", { timeout: 60_000 });
  // AC4 while pending
  expect(await page.locator("body").textContent()).not.toMatch(/No active LP position|Max:\s*0\s*LP/);
  // no click: the payout opens when the cooldown ends
  await expect.poll(async () => log.filter((e) => e.kind === "tx").length, { timeout: 180_000 }).toBe(2);
  await expect.poll(async () => P.usdcBalance(kp.publicKey), { timeout: 60_000 }).toBeGreaterThan(before);
  const delta = (await P.usdcBalance(kp.publicKey)) - before;
  const estAtoms = BigInt(Math.round(Number((est.match(/≈ ([\d,.]+)/)?.[1] ?? "0").replace(/,/g, "")) * 1e6));
  check(J, sym, "2 prompts, payout auto-opened, delta ≈ estimate", delta >= estAtoms && delta - estAtoms < 10_000n, `est=${estAtoms}`, `delta=${delta} prompts=${log.filter((e) => e.kind === "tx").length}`, []);
  await page.screenshot({ path: `.run/shots/${J}-1440.png`, fullPage: true }).catch(() => undefined);
});

test("UX WP-4 AC3: reload between 76 and 77 -> 'Finish withdrawal', one click, one prompt", async ({ page }) => {
  const m = P.markets().SOL;
  const kp = await P.newWallet({ usdc: 2_000_000_000n });
  await P.earnDeposit(kp, m, 1_000_000_000n);
  await P.earnRequestRedeem(kp, m, 50_000_000n);
  await P.advanceSlots(Number(await P.earnCooldownSlots(m)) + 2);
  const log = await installTestWallet(page, kp);
  await page.goto(`/earn/${m.slab}`);
  await expect(page.getByTestId("earn-pending-withdrawal")).toHaveAttribute("data-phase", "ready", { timeout: 60_000 });
  await page.getByTestId("earn-withdraw-execute").click();
  await expect.poll(async () => log.filter((e) => e.kind === "tx").length, { timeout: 90_000 }).toBe(1);
});
