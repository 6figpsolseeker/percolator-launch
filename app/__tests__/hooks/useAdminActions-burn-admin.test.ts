/**
 * "Burn admin key" must renounce the CREATOR's `asset_admin` (asset 0) via
 * UpdateAssetAuthority — NOT `marketauth` via UpdateAuthority. StakeInitPool
 * rotates marketauth to the keyless stake-pool PDA at creation, so the old
 * UpdateAuthority path always failed on a completed market ("not the market
 * admin (stake-pool PDA)"). On-chain verified: asset 0's asset_admin stays the
 * creator's wallet; the stake-pool PDA equals marketauth.
 */
import { describe, expect, it } from "vitest";
import fs from "fs";
import path from "path";

const SRC = fs.readFileSync(
  path.resolve(__dirname, "../../hooks/useAdminActions.ts"),
  "utf8",
);

describe("useAdminActions renounceAdmin (burn admin key)", () => {
  it("builds UpdateAssetAuthority(kind=AssetAdmin, asset 0, burn) — not UpdateAuthority on marketauth", () => {
    expect(SRC).toMatch(/encodeUpdateAssetAuthority\(\{/);
    expect(SRC).toMatch(/kind:\s*ASSET_AUTH_KIND\.AssetAdmin/);
    expect(SRC).toMatch(/assetIndex:\s*0/);
    // the wrong old path is gone
    expect(SRC).not.toContain("encodeUpdateAuthority");
  });

  it("pre-flights against asset_admin (the creator's key), not marketauth", () => {
    expect(SRC).toMatch(/readAssetAdmin\(slabData, 0\)/);
    expect(SRC).not.toContain("requireAdminAuthority");
  });

  it("passes the v18 CAS binding (marketId + authorityEpoch), mirroring keeper-cosign", () => {
    expect(SRC).toMatch(/marketId,/);
    expect(SRC).toMatch(/authorityEpoch,/);
  });
});
