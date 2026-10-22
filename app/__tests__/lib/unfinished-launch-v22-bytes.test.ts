/**
 * #3606: readLaunchFootprint read the LP-vault backing buckets with the installed SDK's VERSION-18-only parser,
 * which throws on a v2.2 (VERSION 19) market, so every v2.2 unfinished launch stayed "unknown" on /my-markets.
 * Real captured v2.2 bytes, nothing mocked.
 */
import { afterEach, describe, expect, it } from "vitest";
import { __setDevnetV22ForTest } from "@/lib/v22/flag";
import { readMarketGroupHeader } from "@/lib/v18-wire";
import { classifyLaunchStage, readLaunchFootprint } from "@/lib/unfinished-launch";
import { LAYOUT_V22 } from "@/lib/v22/sdk/layout";
import { v22MarketBytes } from "../helpers/v22-fixtures";
import RUST from "../fixtures/v22-rust-layout-aca02ba6.json";

afterEach(() => __setDevnetV22ForTest(null));

describe("#3606: the launch footprint of a v2.2 market", () => {
  it("flag on: the footprint is read, so the launch stage is known", () => {
    __setDevnetV22ForTest(true);
    const bytes = v22MarketBytes();
    const f = readLaunchFootprint(bytes);
    expect(f).not.toBeNull();
    const h = readMarketGroupHeader(bytes);
    expect(f!.cTot).toBe(h.cTot);
    expect(f!.portfolios).toBe(h.materializedPortfolioCount);
    expect(classifyLaunchStage(f, 0n).kind).not.toBe("unknown");
  });

  it("the backing buckets are read at v2.2 offsets: the captured market's are funded; zeroed at the deployed struct's offsets, they are not", () => {
    __setDevnetV22ForTest(true);
    expect(readLaunchFootprint(v22MarketBytes())!.backingFunded).toBe(true);
    const d = v22MarketBytes();
    const engine = LAYOUT_V22.marketGroupOff + LAYOUT_V22.marketGroupLen + LAYOUT_V22.wrapperSlotLen;
    for (const side of [RUST.offsets.EngineAssetSlotV16Account.backing_long, RUST.offsets.EngineAssetSlotV16Account.backing_short]) {
      d.fill(0, engine + side, engine + side + RUST.sizes.BackingBucketV16Account);
    }
    expect(readLaunchFootprint(d)!.backingFunded).toBe(false);
  });

  it("CONTROL: bytes too short to be a market are still unknown, never a guess", () => {
    __setDevnetV22ForTest(true);
    expect(readLaunchFootprint(new Uint8Array(10))).toBeNull();
  });
});
