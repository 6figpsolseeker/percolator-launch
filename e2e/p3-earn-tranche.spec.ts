import { test, expect } from '@playwright/test';

/**
 * E2E B17: on a P3 bound-vault market, /earn/<slab> shows the tranche card and the NAV share
 * price. Needs a P3 program + bound market (the E2E fork run), so it is skipped unless
 * E2E_P3_EARN_SLAB names one and the app was built with NEXT_PUBLIC_LIMITS_P3=1.
 */
const slab = process.env.E2E_P3_EARN_SLAB;

test.describe('P3 Earn tranche card (B17)', () => {
  test.skip(!slab, 'set E2E_P3_EARN_SLAB to a bound-vault market on the P3 fork');

  test('tranche card and share price render on /earn/<slab>', async ({ page }) => {
    await page.goto(`/earn/${slab}`);
    const card = page.getByTestId('limits-tranche-card');
    await expect(card).toBeVisible({ timeout: 30_000 });
    await expect(card).not.toHaveAttribute('data-state', 'loading', { timeout: 30_000 });
    await expect(page.getByTestId('limits-share-price')).toBeVisible();
  });
});
