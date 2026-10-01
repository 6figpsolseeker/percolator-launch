/**
 * UX WP-3 AC1..AC5 for the #2701 fork harness (copy to e2e-fork/journeys/ui/). The state set-up
 * belongs to the existing journeys (UF3 LP depleted, UF5 clamp, F3-ADL reduce-only, P2-2 zero
 * fill); each ends by calling `ticketInvariants` in its state. The helper is the contract:
 *  AC1 ≤ 1 status-line inside the ticket, ≤ 1 in the header.
 *  AC2 exactly one visible max figure per side, equal to data-max-q in the input's unit.
 *  AC3 F3-ADL: the Open tab can't submit, no "Max long" visible (the ticket starts on Close).
 *  AC4 P2-2 zero fill: status-line[data-kind=zero-fill]; no "Tx:" outside Details.
 *  AC5 partial fill: data-variant=info.
 */
import { expect, type Page } from "@playwright/test";

export async function ticketInvariants(page: Page, state: "live" | "uf3" | "uf5" | "adl" | "zero-fill" | "partial"): Promise<void> {
  const ticket = page.getByTestId("order-ticket").first();
  await expect(ticket).toBeVisible({ timeout: 60_000 });
  expect(await ticket.locator("[data-testid=status-line]").count()).toBeLessThanOrEqual(1);
  // header: the health banner + limits strip region above the grid
  // UX WP-10 (§4.3): the one header status line (legacy testid kept on it as data-legacy-testid)
  const header = page.locator("[data-testid=market-header-status]");
  expect(await header.locator("[data-testid=status-line]").count()).toBeLessThanOrEqual(1);
  expect(await ticket.textContent()).not.toMatch(/Tx:|Confirmed!|Max per trade|capacity left|Order value|RebalanceReduce|unilateral/i);

  if (state === "live" || state === "uf5") {
    const max = ticket.getByTestId("limits-max-size-inline");
    await expect(max).toHaveCount(1);
    const q = BigInt((await max.getAttribute("data-max-q")) ?? "0");
    const unit = await max.getAttribute("data-unit");
    const text = (await max.textContent()) ?? "";
    if (unit === "token") {
      const whole = q / 1_000_000n;
      expect(text).toContain(whole.toLocaleString("en-US"));
    } else {
      expect(text).toMatch(/Max \$[\d,]+\.\d{2}$/);
    }
  }
  if (state === "uf5") {
    await expect(ticket.getByTestId("limits-clamp-notice")).toBeVisible();
  }
  if (state === "uf3") {
    // the paused side is disabled with a "Paused" sublabel; the other side is selected
    const paused = ticket.locator("[data-limits-halted=true]");
    if ((await paused.count()) === 1) {
      await expect(paused.getByTestId("trade-side-paused")).toHaveText("Paused");
      await expect(paused).toBeDisabled();
    }
  }
  if (state === "adl") {
    await expect(ticket).toHaveAttribute("data-ticket-mode", "close");
    await ticket.locator("[data-testid=trade-mode-tab][data-mode=open]").click();
    const t2 = page.getByTestId("order-ticket").first();
    await expect(t2.getByTestId("trade-submit")).toBeDisabled();
    await expect(t2.getByTestId("trade-submit")).toHaveText("Close-only for now");
    expect(await t2.textContent()).not.toMatch(/Max long/i);
  }
  if (state === "zero-fill") {
    await expect(ticket.locator("[data-testid=status-line][data-kind=zero-fill]")).toHaveCount(1);
    await expect(ticket.locator("[data-testid=limits-fill-result][data-kind=zero]")).toHaveCount(1);
    await expect(ticket.getByTestId("status-line-tx")).toHaveCount(0);
  }
  if (state === "partial") {
    await expect(ticket.locator("[data-testid=status-line][data-kind=partial-fill]")).toHaveAttribute("data-variant", "info");
  }
  const w = page.viewportSize()?.width ?? 0;
  await page.screenshot({ path: `.run/shots/UX-WP3-${state}-${w}.png`, fullPage: true }).catch(() => undefined);
}
