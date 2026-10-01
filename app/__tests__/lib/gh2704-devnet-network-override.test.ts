/**
 * GH#2704: a devnet deployment must ignore a "percolator-network"="mainnet"
 * localStorage override (mirror of the GH#2229 mainnet guard). Otherwise the
 * playground swaps to mainnet program IDs while devnet markets still render
 * via the placeholder allowlist, and assertCanonicalMatcher refuses every trade.
 */
import { describe, it, expect, vi, afterEach } from "vitest";
import * as fs from "fs";
import * as path from "path";
import { getNetwork, getConfig } from "@/lib/config";
import { assertCanonicalMatcher } from "@/lib/programAllowlist";

const DEVNET_MATCHER = "4seJWjv3R5qfXY8R5ntuPHWsoqcVvaxvfFSnU2AnGMhT";
const KEY = "percolator-network";

describe("GH#2704: deployment network pins getNetwork()", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    localStorage.clear();
  });

  it("devnet deployment ignores a mainnet override", () => {
    vi.stubEnv("NEXT_PUBLIC_DEFAULT_NETWORK", "devnet");
    localStorage.setItem(KEY, "mainnet");
    expect(getNetwork()).toBe("devnet");
    expect(getConfig().matcherProgramId).toBe(DEVNET_MATCHER);
    expect(() => assertCanonicalMatcher(DEVNET_MATCHER)).not.toThrow();
  });

  it("mainnet deployment still ignores a devnet override (GH#2229 control)", () => {
    vi.stubEnv("NEXT_PUBLIC_DEFAULT_NETWORK", "mainnet");
    localStorage.setItem(KEY, "devnet");
    expect(getNetwork()).toBe("mainnet");
  });

  it.each(["mainnet", "devnet"] as const)(
    "unset deployment still honours a %s override (local dev control)",
    (ov) => {
      vi.stubEnv("NEXT_PUBLIC_DEFAULT_NETWORK", undefined as unknown as string);
      localStorage.setItem(KEY, ov);
      expect(getNetwork()).toBe(ov);
    },
  );

  it("unset deployment with no override fails closed to mainnet", () => {
    vi.stubEnv("NEXT_PUBLIC_DEFAULT_NETWORK", undefined as unknown as string);
    expect(getNetwork()).toBe("mainnet");
  });
});

// Both deployments pin the network, so a button that writes the override and reloads only lands on
// the same screen: "Switch to Mainnet" on devnet, and "Switch to Devnet & Retry" on mainnet.
describe("GH#2704: the trade page offers no network switch the build would ignore", () => {
  const src = fs.readFileSync(path.resolve(__dirname, "../../app/trade/[slab]/page.tsx"), "utf8");

  it("never writes the network override", () => {
    expect(src).not.toMatch(/localStorage\.setItem\(\s*"percolator-network"/);
  });

  it("has no Switch to Mainnet / Switch to Devnet button", () => {
    expect(src).not.toMatch(/>\s*Switch to (Mainnet|Devnet)/);
  });
});
