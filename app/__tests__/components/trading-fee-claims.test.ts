/**
 * The create page told creators their market's trading fee was "the same on
 * every market". It is not — the fee is derived from the token's liquidity
 * tier (20 / 10 / 5 bps), and that value is what reaches the chain.
 *
 * These pin the CLAIMS, because the defect is a claim. A fee readout that
 * states a policy the code does not implement is worse than one that states
 * nothing: a creator reads it, believes their market matches every other, and
 * is wrong.
 *
 * The policy itself was real — `FIXED_TRADING_FEE_BPS` was declared with
 * "one rate for every market" — but it was never wired to anything. Rather
 * than implement it (a pricing decision, not a bug fix), the claims are
 * corrected to describe what actually ships.
 */

import { describe, expect, it } from "vitest";
import fs from "fs";
import path from "path";

const read = (rel: string) =>
  fs.readFileSync(path.resolve(__dirname, "../../", rel), "utf8");

/**
 * Strip comments before asserting about a CLAIM.
 *
 * These tests forbid phrases, and the fix explains the old wording in a
 * comment — so a naive `not.toContain` fails on the explanation rather than
 * the claim. What is rendered is what matters; what is documented about the
 * history is not a claim to the user.
 */
const code = (src: string) =>
  src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");

const CONTROL_ROOM = read("components/create/StepControlRoom.tsx");
const MARKET_PARAMS = read("lib/market-params.ts");
const QUICK_LAUNCH = read("hooks/useQuickLaunch.ts");

describe("the create page does not claim a uniform fee", () => {
  it("drops the 'same on every market' claim", () => {
    // THE BUG. It interpolated the ACTUAL tier-derived fee and then appended
    // the claim, so a low-liquidity token literally read
    // "20 bps · same on every market".
    expect(code(CONTROL_ROOM)).not.toContain("same on every market");
  });

  it("still shows the fee itself", () => {
    // CONTROL. Removing the false half must not remove the true half — the
    // creator does need to know what their market will charge.
    expect(CONTROL_ROOM).toMatch(/Trading fee/);
    // UX WP-10 (§5.1): the fee is shown as a percentage of the same value.
    expect(CONTROL_ROOM).toMatch(/\$\{bpsPct\(tradingFeeBps\)\}/);
  });
});

describe("the dead policy constant does not assert a policy that is not enforced", () => {
  it("no longer claims one rate for every market", () => {
    // The comment was half true: "NOT creator-settable" is correct (the fee
    // has no UI — FeeSlider is never rendered and setTradingFeeBps has no
    // consumers), but "one rate for every market" is not.
    expect(code(MARKET_PARAMS)).not.toContain("one rate for every market");
  });

  it("CONTROL: the tier derivation that actually ships is untouched", () => {
    // This PR corrects claims; it does not change pricing. If these move, the
    // change stopped being a documentation fix.
    expect(QUICK_LAUNCH).toMatch(/tradingFeeBps\s*=\s*20;/);
    expect(QUICK_LAUNCH).toMatch(/tradingFeeBps\s*=\s*10;/);
    expect(QUICK_LAUNCH).toMatch(/tradingFeeBps\s*=\s*5;/);
  });
});

describe("the portfolio label was already honest and stays that way", () => {
  it("only says 'Varies by market' when it actually found several fees", () => {
    // StatsBar shows a single value when every open position shares a fee and
    // falls back to the phrase only when it finds more than one. It was
    // reporting reality; the create page was the one contradicting it.
    const stats = read("components/dashboard/StatsBar.tsx");
    expect(stats).toContain("Varies by market");
    expect(stats).toMatch(/feeBpsValues\.length\s*>\s*1/);
    expect(stats).toMatch(/feeBpsValues\.length\s*===\s*1/);
  });
});
