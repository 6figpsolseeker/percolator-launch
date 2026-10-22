/**
 * #3603: cross-device resume (/create?resume=<slab>, #3267) classified every v2.2 launch as "not an initialised
 * market": the card checked the bytes with the installed SDK's isV17Account, which accepts wrapper VERSION 18 only,
 * and a v2.2 market is VERSION 19. The check now goes through lib/v22/layout. Real v2.2 market bytes, nothing mocked.
 */
import { afterEach, describe, expect, it } from "vitest";
import { parseWrapperConfigV17, V17_HEADER_LEN } from "@percolatorct/sdk";
import { classifyResumeSlab } from "@/components/create/ResumeFromChainCard";
import { __setDevnetV22ForTest } from "@/lib/v22/flag";
import { V22_SLAB, v22MarketBytes } from "@/__tests__/helpers/v22-fixtures";
import { LAYOUT_V22 } from "@/lib/v22/sdk";

afterEach(() => __setDevnetV22ForTest(null));
const notFinished = () => false;

describe("#3603: resuming a v2.2 launch from another browser", () => {
  it("a v2.2 market is read as the creator's launch, not 'not an initialised market'", () => {
    __setDevnetV22ForTest(true);
    const bytes = v22MarketBytes();
    const creator = parseWrapperConfigV17(bytes, V17_HEADER_LEN).marketauth;
    const r = classifyResumeSlab(bytes, V22_SLAB, creator, notFinished);
    expect(r.kind).toBe("ready");
    // The insurance balance is read at the v2.2 offset, not v2.1's (the u128 at group + insurance in LAYOUT_V22).
    const at = LAYOUT_V22.marketGroupOff + LAYOUT_V22.group.insurance;
    const dv = new DataView(bytes.buffer, bytes.byteOffset);
    const insurance = dv.getBigUint64(at, true) | (dv.getBigUint64(at + 8, true) << 64n);
    if (r.kind === "ready") expect(r.insuranceAtoms).toBe(insurance);
  });

  it("a wrapper VERSION this build can't decode is 'unreadable', not 'nothing to continue'", () => {
    __setDevnetV22ForTest(true);
    const bytes = v22MarketBytes();
    new DataView(bytes.buffer, bytes.byteOffset).setUint16(8, 99, true);
    expect(classifyResumeSlab(bytes, V22_SLAB, V22_SLAB, notFinished).kind).toBe("unreadable");
  });

  it("CONTROL: bytes that aren't a wrapper market are still 'not-a-market'", () => {
    __setDevnetV22ForTest(true);
    expect(classifyResumeSlab(new Uint8Array(4_000), V22_SLAB, V22_SLAB, notFinished).kind).toBe("not-a-market");
  });
});
