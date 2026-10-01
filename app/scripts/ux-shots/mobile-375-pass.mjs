// UX WP-10 AC4 (audit MB-1..3, §4.8): a 375 px pass over the app's main routes.
// For each route: document.scrollWidth === 375 (no page-level horizontal scroll), the header
// price text node is fully inside the viewport (trade), and every visible button / link-button is
// at least 44 px high. Writes a JSON report and a screenshot per route.
// node scripts/ux-shots/mobile-375-pass.mjs <baseUrl> <outDir> [slab]
import { chromium } from "@playwright/test";
import { writeFileSync, mkdirSync } from "node:fs";
const [base, outDir, slab = "AzagguvrWmRgcBpsKuqomW7Yb1YUUd6UzcrkiRsqdhr"] = process.argv.slice(2);
mkdirSync(outDir, { recursive: true });
const routes = ["/markets", `/trade/${slab}`, "/earn", `/earn/${slab}`, "/create", "/portfolio", "/my-markets"];
const browser = await chromium.launch();
const report = [];
for (const r of routes) {
  const page = await browser.newPage({ viewport: { width: 375, height: 812 }, isMobile: true, hasTouch: true });
  await page.goto(base + r, { waitUntil: "domcontentloaded", timeout: 180_000 });
  await page.waitForTimeout(8_000);
  const m = await page.evaluate(() => {
    const vw = window.innerWidth;
    const small = [];
    for (const el of document.querySelectorAll("button, [role=button], a[role=menuitem], [role=menuitem]")) {
      const rc = el.getBoundingClientRect();
      const st = getComputedStyle(el);
      if (rc.width === 0 || rc.height === 0 || st.visibility === "hidden" || st.display === "none") continue;
      if (typeof el.checkVisibility === "function" && !el.checkVisibility({ opacityProperty: true, visibilityProperty: true })) continue;
      if (el.closest("[data-dev-chrome], nextjs-portal")) continue;
      if (rc.height < 44) small.push({ text: (el.textContent || el.getAttribute("aria-label") || "").trim().slice(0, 40), h: Math.round(rc.height), tid: el.getAttribute("data-testid") });
    }
    const price = document.querySelector("[data-testid=header-price], [data-testid=market-price]");
    let priceClipped = null;
    if (price) {
      const rc = price.getBoundingClientRect();
      priceClipped = rc.left < 0 || rc.right > vw || price.scrollWidth > price.clientWidth + 1;
    }
    // Text cut off at the viewport edge (not inside a deliberate horizontal scroller).
    const clipped = [];
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    for (let n = walker.nextNode(); n; n = walker.nextNode()) {
      if (!n.textContent || !n.textContent.trim()) continue;
      const el = n.parentElement;
      if (!el || (typeof el.checkVisibility === "function" && !el.checkVisibility({ opacityProperty: true, visibilityProperty: true }))) continue;
      const r = document.createRange();
      r.selectNodeContents(n);
      const rc = r.getBoundingClientRect();
      if (rc.width === 0 || rc.right <= vw + 1) continue;
      let scroller = false;
      for (let a = el; a && a !== document.body; a = a.parentElement) {
        const ox = getComputedStyle(a).overflowX;
        if (ox === "auto" || ox === "scroll") { scroller = true; break; }
      }
      if (!scroller && !el.closest("[aria-hidden=true], .ticker-banner, [data-marquee]")) clipped.push(n.textContent.trim().slice(0, 40));
    }
    return { scrollWidth: document.documentElement.scrollWidth, small, priceClipped, hasPrice: !!price, clipped };
  });
  await page.screenshot({ path: `${outDir}/m375${r.replace(/\//g, "_")}.png`, fullPage: false });
  report.push({ route: r, ...m, smallCount: m.small.length });
  console.log(`${r}: scrollWidth=${m.scrollWidth} price=${m.hasPrice ? (m.priceClipped ? "CLIPPED" : "ok") : "n/a"} buttons<44=${m.small.length} clippedText=${m.clipped.length}${m.clipped.length ? " " + JSON.stringify(m.clipped.slice(0, 6)) : ""}`);
  await page.close();
}
writeFileSync(`${outDir}/mobile-375-report.json`, JSON.stringify(report, null, 2));
await browser.close();
