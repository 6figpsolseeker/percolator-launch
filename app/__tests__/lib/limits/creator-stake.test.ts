// @vitest-environment node
/** UX WP-9 AC1 (audit §3.10): the creator-stake state, the program's 97 rule, reason precedence. */
import { describe, expect, it } from "vitest";
import { clampStakeWithdraw, creatorStakeState, stakeReasonFromRefusal } from "@/lib/limits/creator-stake";
import { juniorWithdrawableAtoms } from "@/lib/limits/vault-tranche";
import { SimulationRefusal } from "@/lib/tx";
import { WRAPPER_ERR } from "@/lib/wrapper-errors";
import { isJuniorWithdrawRefusal } from "@/hooks/useJuniorTranche";

const C = 1_000_000_000n;
const base = { vaultValue: C + 300_000_000n, seniorClaimEff: C, backingCover: C, floorBps: 2_000, lpFlat: true, drawOutstandingAtoms: 0n, impaired: false };

describe("creatorStakeState", () => {
  it("withdrawable = junior above the floor (the same rule as juniorWithdrawableAtoms), no reason", () => {
    const s = creatorStakeState(base);
    expect(s).toMatchObject({ stakeValue: 300_000_000n, protects: C, mustKeep: 200_000_000n, floorPct: "20%", withdrawable: 100_000_000n, reason: null });
    expect(s.withdrawable).toBe(juniorWithdrawableAtoms(base.vaultValue, C, C, 2_000));
  });
  it("reason precedence: draw pending > LP open > backing short > at floor; withdrawable 0 with each", () => {
    expect(creatorStakeState({ ...base, drawOutstandingAtoms: 1n, lpFlat: false, backingCover: 0n })).toMatchObject({ reason: "draw-pending", withdrawable: 0n });
    expect(creatorStakeState({ ...base, lpFlat: false, backingCover: 0n })).toMatchObject({ reason: "lp-open", withdrawable: 0n });
    expect(creatorStakeState({ ...base, backingCover: C - 1n })).toMatchObject({ reason: "backing-short", withdrawable: 0n });
    expect(creatorStakeState({ ...base, vaultValue: C + 150_000_000n })).toMatchObject({ reason: "at-floor", withdrawable: 0n });
  });
  it("unknown value: no withdrawable, no reason; 12.5% floors keep a decimal", () => {
    expect(creatorStakeState({ ...base, vaultValue: null })).toMatchObject({ stakeValue: null, withdrawable: null, reason: null });
    expect(creatorStakeState({ ...base, floorBps: 1_250 }).floorPct).toBe("12.5%");
  });
  it("a 75 refusal maps to the state's reason, else the floor", () => {
    expect(stakeReasonFromRefusal(creatorStakeState({ ...base, drawOutstandingAtoms: 3n }))).toBe("draw-pending");
    expect(stakeReasonFromRefusal(creatorStakeState(base))).toBe("at-floor");
  });
  it("clamp", () => {
    expect(clampStakeWithdraw(5n, 3n)).toBe(3n);
    expect(clampStakeWithdraw(2n, 3n)).toBe(2n);
    expect(clampStakeWithdraw(2n, null)).toBe(0n);
    expect(clampStakeWithdraw(-1n, 3n)).toBe(0n);
  });
  it("isJuniorWithdrawRefusal: only a pre-sign 75 refusal", () => {
    expect(isJuniorWithdrawRefusal(new SimulationRefusal({ InstructionError: [1, { Custom: WRAPPER_ERR.VaultLpJuniorWithdrawRefused }] }))).toBe(true);
    expect(isJuniorWithdrawRefusal(new SimulationRefusal({ InstructionError: [1, { Custom: 21 }] }))).toBe(false);
    expect(isJuniorWithdrawRefusal(new Error("custom program error: 0x4b"))).toBe(false);
  });
});
