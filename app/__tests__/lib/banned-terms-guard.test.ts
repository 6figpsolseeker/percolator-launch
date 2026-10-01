// @vitest-environment node
/**
 * UX WP-10 (audit §5.1): the banned-terms guard. Extends the loss-copy guard
 * (p3-single-asset-loss-copy.test.ts) from the loss rule to the whole vocabulary: no user-visible
 * string the app's copy tables, the one resolver (resolveUserMessage, every wrapper code × every
 * surface), humanizeError or the Earn mapper can produce may say LP, tranche, senior/junior, NAV,
 * crank, keeper, slot, recall, harvest, escrow, matcher, vAMM, bps, slab, portfolio, a program
 * code, "the program refused", "SOL-PERP", "units", … Such words are allowed only in Details,
 * dev-chrome titles and code comments, none of which are harvested here.
 */
import { describe, expect, it } from "vitest";
import { BANNED, bannedHits, collectCopyStrings } from "./banned-terms-harvest";

describe("§5.1 banned terms in user-visible strings", () => {
  it("none in the copy tables, the resolver, humanizeError or the Earn mapper", async () => {
    const all = await collectCopyStrings();
    // The harvest must really cover the surfaces (never a vacuous pass).
    expect(all.length).toBeGreaterThan(1_000);
    expect(all.some((s) => s.source.startsWith("resolve("))).toBe(true);
    expect(all.some((s) => s.source.startsWith("humanizeError("))).toBe(true);
    expect(all.some((s) => s.source.startsWith("earnErrorMessage("))).toBe(true);
    expect(all.some((s) => s.source.startsWith("limits/copy.COPY."))).toBe(true);
    const hits = bannedHits(all).map((h) => `${h.source} [${h.term}]: ${h.text}`);
    expect(hits).toEqual([]);
  });
  it("NEGATIVE CONTROL: the detector catches each banned form", () => {
    const samples = [
      "the LP is at its floor", "junior tranche", "Earn seniors", "NAV", "cranked", "the keeper", "in 1,000 slots", "recall the backing",
      "harvest fees", "escrowed", "this pot", "the matcher", "a vAMM", "30 bps", "the slab", "your portfolio", "sub-account",
      "RebalanceReduce", "tag 94", "permissionless", "the program refused it", "Custom(21)", "0x4b", "code 21", "Program error: x",
      "Transaction failed: {", "SOL-PERP", "12 units", "cushion", "certified equity", "re-seed",
    ];
    const hit = bannedHits(samples.map((text, i) => ({ source: `s${i}`, text })));
    const caught = new Set(hit.map((h) => h.source));
    expect(samples.filter((_, i) => !caught.has(`s${i}`))).toEqual([]);
    expect(bannedHits([{ source: "ok", text: "Your creator stake covers the first losses. Withdraw available in 2 min." }])).toEqual([]);
    expect(BANNED.length).toBeGreaterThanOrEqual(38);
  });
});
