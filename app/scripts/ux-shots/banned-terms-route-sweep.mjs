// UX WP-10 AC6 (audit §5.1 / §6): the live render sweep. Visits every main route at 1440 and
// 375 px and checks the VISIBLE text (innerText: closed <details> and hidden nodes are excluded,
// so Details-only wording is allowed, as §5.1 says) against the banned vocabulary.
// node scripts/ux-shots/banned-terms-route-sweep.mjs <baseUrl> <outJson> [slab]
import { chromium } from "@playwright/test";
import { writeFileSync } from "node:fs";
const [base, out, slab = "AzagguvrWmRgcBpsKuqomW7Yb1YUUd6UzcrkiRsqdhr"] = process.argv.slice(2);
const routes = ["/", "/markets", `/trade/${slab}`, "/earn", `/earn/${slab}`, "/create", "/portfolio", "/my-markets", "/stake", "/faucet"];
const BANNED = [
  ["LP", /\bLPs?\b/], ["liquidity provider", /liquidity provider/i], ["tranche", /\btranches?\b/i], ["senior", /\bseniors?\b/i],
  ["junior", /\bjuniors?\b/i], ["NAV", /\bNAV\b/], ["crank", /\bcrank(ed|s|ing)?\b/i], ["keeper", /\bkeepers?\b/i],
  ["maintainer", /\bmaintainers?\b/i], ["re-seed", /\bre-?seed/i], ["slot", /\bslots?\b/i], ["recall", /\brecall(ed|s)?\b/i],
  ["harvest", /\bharvest/i], ["escrow", /\bescrow/i], ["matcher", /\bmatchers?\b/i], ["vAMM", /\bvAMM\b/i], ["bps", /\bbps\b/i],
  ["slab", /\bslabs?\b/i], ["sub-account", /\bsub-?accounts?\b/i], ["permissionless", /\bpermissionless\b/i],
  ["program refused", /(the program refused|rejected by the program)/i], ["Custom(n)", /Custom\(\d+\)/], ["code N", /\bcode \d+/i],
  ["Program error", /Program error/], ["-PERP", /-PERP\b/], ["units", /\bunits\b/i],
];
const browser = await chromium.launch();
const report = [];
let total = 0;
for (const w of [1440, 375]) {
  for (const r of routes) {
    const page = await browser.newPage({ viewport: { width: w, height: w > 1000 ? 900 : 812 } });
    await page.goto(base + r, { waitUntil: "domcontentloaded", timeout: 180_000 });
    await page.waitForTimeout(8_000);
    // The dev-server overlay and the marquee ticker are not app copy under test here.
    const text = await page.evaluate(() => {
      for (const el of document.querySelectorAll("nextjs-portal, .ticker-banner")) el.remove();
      return document.body.innerText;
    });
    const lines = text.split("\n").map((l) => l.trim()).filter(Boolean);
    const hits = [];
    for (const l of lines) for (const [term, re] of BANNED) if (re.test(l)) hits.push({ term, line: l.slice(0, 140) });
    total += hits.length;
    report.push({ width: w, route: r, lines: lines.length, hits });
    console.log(`${w}px ${r}: ${lines.length} lines, ${hits.length} banned${hits.length ? " " + JSON.stringify(hits.slice(0, 4)) : ""}`);
    await page.close();
  }
}
writeFileSync(out, JSON.stringify({ total, report }, null, 2));
await browser.close();
process.exit(total === 0 ? 0 : 1);
