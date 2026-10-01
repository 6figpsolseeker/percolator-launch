/**
 * The creator row gates the two destructive actions on the authority each one
 * actually needs, instead of letting the user click into a doomed tx:
 *  • "burn admin key" — enabled only when the wallet holds asset_admin
 *    (== creator_fee_authority), which the creator does.
 *  • "close market" — enabled only when the wallet holds marketauth, which
 *    StakeInitPool rotated to the keyless stake-pool PDA, so it's disabled on a
 *    completed (autonomous) market, with an explanation.
 */
import { describe, expect, it } from "vitest";
import fs from "fs";
import path from "path";

const SRC = fs.readFileSync(
  path.resolve(__dirname, "../../../components/my-markets/CreatorMarketRow.tsx"),
  "utf8",
);

describe("CreatorMarketRow admin-action gates", () => {
  it("derives isAssetAdmin from creator_fee_authority and isMarketAuth from marketauth", () => {
    expect(SRC).toMatch(/const isAssetAdmin =[\s\S]*creator_fee_authority === walletB58AdminGate/);
    expect(SRC).toMatch(/const marketAuthB58 = market\.configV17\?\.marketauth\?\.toBase58\(\)/);
    expect(SRC).toMatch(/const isMarketAuth =[\s\S]*marketAuthB58 === walletB58AdminGate/);
  });

  it("disables burn on !isAssetAdmin and close on !isMarketAuth", () => {
    expect(SRC).toMatch(/disabled=\{actions\.loading === "renounceAdmin" \|\| !isAssetAdmin\}/);
    // Merged with WP-9's close checklist: the blocker AND the marketauth gate.
    expect(SRC).toMatch(/disabled=\{closeMarket\.loading \|\| closeBlocker !== null \|\| !isMarketAuth\}/);
    expect(SRC).toContain("<CloseMarketChecklistView checks={closeChecks} />");
  });

  it("explains the autonomous-market state instead of a doomed close", () => {
    expect(SRC).toContain("{!isMarketAuth && (");
    expect(SRC).toMatch(/This market is autonomous/);
  });

  it("the burn confirm says it forfeits creator fees, and warns to claim first when fees are unclaimed", () => {
    expect(SRC).toContain('data-testid="burn-forfeits-fees"');
    expect(SRC).toMatch(/give up this market&apos;s creator fees for good/);
    expect(SRC).toMatch(/\{hasClaimableFees && \(\s*<p data-testid="burn-claim-first"/);
  });
});
