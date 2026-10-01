// @vitest-environment node
/** P1 `lp-halted` market-health badge (lib/market-health.ts), flag-gated, on live bytes. */
import { describe, it, expect, afterEach } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { decodeMarketHealth, healthBadges } from "@/lib/market-health";
import { __setLimitsFlagsForTest } from "@/lib/limits/flags";
import * as C from "@/lib/limits/constants";
import { ALL_ON } from "./fixtures";

const pengu = () =>
  new Uint8Array(Buffer.from(readFileSync(join(__dirname, "..", "..", "fixtures", "v18-liveness", "pengu-market-v18-healthy.b64"), "utf8").trim(), "base64"));
const SLOT = 505580400n;
function withFloor(d: Uint8Array, floor: bigint): Uint8Array {
  const out = d.slice();
  const dv = new DataView(out.buffer);
  const o = C.assetWrapperOff(0) + C.ASSET_RISK_LIMITS_OFF + C.RL_LP_FLOOR_ATOMS;
  dv.setBigUint64(o, floor & 0xffff_ffff_ffff_ffffn, true);
  dv.setBigUint64(o + 8, floor >> 64n, true);
  return out;
}

afterEach(() => __setLimitsFlagsForTest(null));

describe("lp-halted badge", () => {
  it("P1 on: capital at/below the floor => 'LP halted' (supersedes 'LP depleted')", () => {
    __setLimitsFlagsForTest(ALL_ON);
    const ids = healthBadges(decodeMarketHealth(pengu(), SLOT, 0n)).map((b) => b.id);
    expect(ids).toContain("lp-halted");
    expect(ids).not.toContain("lp-depleted");
    const floored = healthBadges(decodeMarketHealth(withFloor(pengu(), 5_000_000n), SLOT, 4_000_000n)).map((b) => b.id);
    expect(floored).toContain("lp-halted");
    const above = healthBadges(decodeMarketHealth(withFloor(pengu(), 5_000_000n), SLOT, 6_000_000n)).map((b) => b.id);
    expect(above).not.toContain("lp-halted");
  });
  it("P1 off: unchanged P0b behaviour (LP depleted, no halted badge)", () => {
    __setLimitsFlagsForTest({ ...ALL_ON, p1: false });
    const ids = healthBadges(decodeMarketHealth(pengu(), SLOT, 0n)).map((b) => b.id);
    expect(ids).toContain("lp-depleted");
    expect(ids).not.toContain("lp-halted");
  });
});
