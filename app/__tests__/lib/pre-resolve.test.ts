// @vitest-environment node
/**
 * Pre-resolve fee gate (lib/pre-resolve.ts) — the app's reclaim flow must crank
 * the Live-only LP (78) and staker (87 → stake 12) legs before ResolveMarket and
 * refuse when a leg would be burned. Bytes: the real stuck wizard market
 * CaS8oiDW… (all legs 0), with legs written in for the owed cases.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { Keypair, PublicKey, SYSVAR_CLOCK_PUBKEY } from "@solana/web3.js";
import { IX_TAG } from "@percolatorct/sdk";
import { decideLpLeg, decideStakeLeg, planPreResolve, readFeeLegs, STAKE_MINIMUM_LIQUIDITY } from "@/lib/pre-resolve";
import type { PoolState } from "@/lib/pre-resolve";

const fixture = JSON.parse(readFileSync(join(__dirname, "..", "fixtures", "CaS8oiDW.market.json"), "utf-8")) as { dataBase64: string };
const base = () => new Uint8Array(Buffer.from(fixture.dataBase64, "base64"));
const WRAPPER = new PublicKey("GnwdeQrAh4qzChJeVLrM21CXXWC1akjLH3DiijwzEEYZ");
const STAKE = new PublicKey("GCHhcgwPyrai8SWHEVWw3odedguFXEtJobNnWSfWBCU3");
const MARKET = new PublicKey("CaS8oiDWpPNzUD9cwFVZT5cYTNjhWFKB451JE2BNCXuF");
const POOL = Keypair.generate().publicKey;
const CRANKER = Keypair.generate().publicKey;

// WrapperConfigV16 fee-leg u128s (SDK parseWrapperConfigV17, header 16): accrued/withdrawn pairs.
const CFG = 16;
function setU128(d: Uint8Array, off: number, v: bigint) {
  const dv = new DataView(d.buffer, d.byteOffset, d.byteLength);
  dv.setBigUint64(off, v & 0xffff_ffff_ffff_ffffn, true);
  dv.setBigUint64(off + 8, v >> 64n, true);
}
function withLegs(lp: bigint, stake: bigint, protocol = 0n) {
  const d = base();
  setU128(d, CFG + 464, protocol);
  setU128(d, CFG + 496, lp);
  setU128(d, CFG + 528, stake);
  return d;
}
const pool = (over: Partial<PoolState> = {}): PoolState => ({
  slab: MARKET,
  poolMode: 0,
  totalLpSupply: 1_000_000n,
  isInitialized: true,
  percolatorProgram: WRAPPER,
  vault: Keypair.generate().publicKey,
  ...over,
});
const plan = (data: Uint8Array, registry: { domain: number; sharesOutstanding: bigint } | null, p: PoolState | null) =>
  planPreResolve({ programId: WRAPPER, stakeProgramId: STAKE, cranker: CRANKER, market: MARKET, marketData: data, registry, pool: p, poolAddress: POOL });

describe("readFeeLegs", () => {
  it("reads the real stuck market as all-zero, and picks up written legs", () => {
    const z = readFeeLegs(base());
    expect([z.lpOwed, z.stakeOwed, z.protocolOwed]).toEqual([0n, 0n, 0n]);
    const l = readFeeLegs(withLegs(685_197n, 228_402n, 285_499n));
    expect([l.lpOwed, l.stakeOwed, l.protocolOwed]).toEqual([685_197n, 228_402n, 285_499n]);
  });
});

describe("planPreResolve", () => {
  it("NEGATIVE CONTROL: nothing owed → no cranks, no blockers (the common reclaim case)", () => {
    const r = plan(base(), null, null);
    expect(r.cranks).toEqual([]);
    expect(r.blockers).toEqual([]);
  });

  it("owed LP + staker legs with a funded vault and real stakers → [78, 87, stake 12] before Resolve", () => {
    const r = plan(withLegs(685_197n, 228_402n), { domain: 0, sharesOutstanding: 5_000n }, pool());
    expect(r.blockers).toEqual([]);
    expect(r.cranks.map((ix) => `${ix.programId.equals(WRAPPER) ? "w" : "s"}:${ix.data[0]}`)).toEqual([
      `w:${IX_TAG.LpVaultCrankFees}`,
      `w:${IX_TAG.WithdrawInsuranceReserveToStake}`,
      "s:12",
    ]);
    expect(IX_TAG.LpVaultCrankFees).toBe(78);
    expect(IX_TAG.WithdrawInsuranceReserveToStake).toBe(87);
    // stake 12 accounts: caller(s), pool(w), vault, clock, trailing slab (stake e62aa4a :2761)
    const s12 = r.cranks[2];
    expect(s12.keys.map((k) => [k.isSigner, k.isWritable])).toEqual([[true, false], [false, true], [false, false], [false, false], [false, false]]);
    expect(s12.keys[3].pubkey.equals(SYSVAR_CLOCK_PUBKEY)).toBe(true);
    expect(s12.keys[4].pubkey.equals(MARKET)).toBe(true);
    // cranker signs the wrapper cranks (permissionless; the reclaiming wallet pays)
    expect(r.cranks[0].keys[0].pubkey.equals(CRANKER) && r.cranks[0].keys[0].isSigner).toBe(true);
  });

  it("owed LP leg but no Earn vault / no depositors → blocked (would be burned)", () => {
    expect(plan(withLegs(1n, 0n), null, null).blockers[0]).toMatch(/LP fees.*no Earn vault/);
    expect(plan(withLegs(1n, 0n), { domain: 0, sharesOutstanding: 0n }, null).blockers[0]).toMatch(/no depositors/);
  });

  it("owed staker leg with only dead shares / unbound pool → blocked", () => {
    expect(plan(withLegs(0n, 5n), null, pool({ totalLpSupply: STAKE_MINIMUM_LIQUIDITY })).blockers[0]).toMatch(/no stakers/);
    expect(plan(withLegs(0n, 5n), null, pool({ slab: Keypair.generate().publicKey })).blockers[0]).toMatch(/not bound/);
    expect(plan(withLegs(0n, 5n), null, null).blockers[0]).toMatch(/no initialised stake pool/);
  });

  it("protocol leg is a warning, not a blocker", () => {
    const r = plan(withLegs(0n, 0n, 10n), null, null);
    expect(r.blockers).toEqual([]);
    expect(r.warnings.join(" ")).toMatch(/protocol fees/);
  });
});

describe("pure deciders mirror the keeper (incl. K-1 dead-share ratio)", () => {
  it("K-1: 1,000 dead of 50,000 total (2%) is refused; 100k+ total is allowed", () => {
    expect(decideStakeLeg(5n, MARKET, WRAPPER, pool({ totalLpSupply: 50_000n })).action).toBe("stuck");
    expect(decideStakeLeg(5n, MARKET, WRAPPER, pool({ totalLpSupply: 100_000n })).action).toBe("push");
    expect(decideStakeLeg(0n, MARKET, WRAPPER, null).action).toBe("none");
    expect(decideStakeLeg(5n, MARKET, WRAPPER, pool({ poolMode: 1 })).action).toBe("stuck");
  });
  it("LP leg", () => {
    expect(decideLpLeg(0n, null)).toEqual({ action: "none" });
    expect(decideLpLeg(9n, { domain: 1, sharesOutstanding: 1n })).toEqual({ action: "crank", domain: 1 });
  });
});
