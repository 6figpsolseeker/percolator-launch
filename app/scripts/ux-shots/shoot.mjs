// Screenshot a dev-preview route at 1440 and 375 px (UX work-package evidence).
// node scripts/ux-shots/shoot.mjs <url> <outPrefix> [clickTestId]
import { chromium } from "@playwright/test";
const [url, out, click] = process.argv.slice(2);
const browser = await chromium.launch();
for (const [w, h] of [[1440, 900], [375, 812]]) {
  const page = await browser.newPage({ viewport: { width: w, height: h } });
  await page.goto(url, { waitUntil: "networkidle", timeout: 180_000 });
  await page.getByTestId("dev-preview").waitFor({ timeout: 60_000 });
  if (click) await page.getByTestId(click).first().click();
  const scrollW = await page.evaluate(() => document.documentElement.scrollWidth);
  await page.screenshot({ path: `${out}-${w}.png`, fullPage: true });
  console.log(`${w}px: scrollWidth=${scrollW}`);
  await page.close();
}
await browser.close();
