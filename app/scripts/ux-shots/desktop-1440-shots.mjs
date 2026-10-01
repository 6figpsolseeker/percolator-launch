// UX WP-10: 1440 px captures of the routes the mobile pass changed (markets, trade header, earn).
// node scripts/ux-shots/desktop-1440-shots.mjs <baseUrl> <outDir>
import { chromium } from "@playwright/test";
const [base, out] = process.argv.slice(2);
const b = await chromium.launch();
for (const r of ["/markets", "/trade/AzagguvrWmRgcBpsKuqomW7Yb1YUUd6UzcrkiRsqdhr", "/earn"]) {
  const p = await b.newPage({ viewport: { width: 1440, height: 900 } });
  await p.goto(base + r, { waitUntil: "domcontentloaded", timeout: 180000 });
  await p.waitForTimeout(8000);
  const sw = await p.evaluate(() => document.documentElement.scrollWidth);
  await p.screenshot({ path: `${out}/d1440${r.replace(/\//g, "_")}.png` });
  console.log(r, "scrollWidth", sw);
  await p.close();
}
await b.close();
