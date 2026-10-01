// Render captured REAL component markup (vitest UX_SHOTS_OUT) with the app's compiled CSS,
// at 1440 (a 340 px ticket rail) and 375 (the mobile sheet, 12 px padding), and screenshot it.
// node scripts/ux-shots/shoot-html.mjs <previewUrl> <htmlDir> <outDir> <prefix> [desktopWidthPx=340]
import { chromium } from "@playwright/test";
import { readdirSync, readFileSync } from "node:fs";
const [url, dir, outDir, prefix, railPx = "340"] = process.argv.slice(2);
const browser = await chromium.launch();
for (const f of readdirSync(dir).filter((x) => x.endsWith(".html")).sort()) {
  const html = readFileSync(`${dir}/${f}`, "utf8");
  const name = f.replace(/\.html$/, "");
  for (const [w, h] of [[1440, 900], [375, 812]]) {
    const page = await browser.newPage({ viewport: { width: w, height: h } });
    await page.goto(url, { waitUntil: "networkidle", timeout: 180_000 });
    await page.getByTestId("dev-preview").waitFor({ timeout: 60_000 });
    await page.evaluate(
      ({ html, w, railPx }) => {
        const main = document.querySelector("[data-testid=dev-preview]");
        main.removeAttribute("class");
        main.style.cssText = w > 1000
          ? `width:${railPx}px;margin:24px 0 24px auto;margin-right:24px;border:1px solid var(--border);background:var(--panel-bg)`
          : "width:100%;padding:12px;background:var(--bg)";
        main.innerHTML = html;
      },
      { html, w, railPx },
    );
    const scrollW = await page.evaluate(() => document.documentElement.scrollWidth);
    await page.screenshot({ path: `${outDir}/${prefix}-${name}-${w}.png`, fullPage: true });
    console.log(`${name} ${w}px: scrollWidth=${scrollW}`);
    await page.close();
  }
}
await browser.close();
