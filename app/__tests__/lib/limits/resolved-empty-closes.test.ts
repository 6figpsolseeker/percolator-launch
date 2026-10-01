// @vitest-environment node
/**
 * On a Resolved bound market the junior's 102 and a senior's 77 are refused 21 while any EMPTY
 * portfolio is still materialized. The app prepends the permissionless tag-8 closes (keeper
 * f43272d sends the same [closer, market, portfolio, owner] each cycle) so nobody waits on it.
 * Real-BPF proof: scripts/limits-parity/p3-sim (limits_app_p3_empty_closes_prepended_before_77_and_102
 * and ..._before_102: alone -> Custom(21); closes + 77 / 102 in one tx -> paid).
 */
import { describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { PublicKey, TransactionInstruction } from "@solana/web3.js";
import { emptyCloseSteps, MAX_PREPENDED_EMPTY_CLOSES } from "@/lib/limits/resolved-exit-load";
import { sendWithTopup } from "@/lib/limits/resolved-topup";
import type { ResolvedExitPlan } from "@/lib/limits/resolved-exit";

const close = (k: string, isVaultLp = false) => ({ kind: "close-empty" as const, portfolio: k, isVaultLp });

describe("emptyCloseSteps", () => {
  it("only the plan's close-empty steps, vault LP included, capped", () => {
    const plan: ResolvedExitPlan = {
      phase: "sweep",
      steps: [close("V", true), { kind: "close-resolved", portfolio: "T" }, close("A"), close("B"), close("C"), close("D")],
      blockers: [],
    };
    expect(emptyCloseSteps(plan, MAX_PREPENDED_EMPTY_CLOSES).map((s) => s.portfolio)).toEqual(["V", "A", "B", "C"]);
    expect(emptyCloseSteps(plan, 1)).toEqual([close("V", true)]);
  });
  it("owners' window: empties still close (F-4 permits it); ready / not-resolved: nothing", () => {
    expect(emptyCloseSteps({ phase: "owner-window", untilSlot: 9n, steps: [close("E")], blockers: [] }, 4)).toEqual([close("E")]);
    expect(emptyCloseSteps({ phase: "ready", blockers: [] }, 4)).toEqual([]);
    expect(emptyCloseSteps({ phase: "not-resolved" }, 4)).toEqual([]);
  });
});

describe("prefix + payout composition with the 84 -> 78 retry", () => {
  const ix = (n: number) => new TransactionInstruction({ programId: PublicKey.default, keys: [], data: Buffer.from([n]) });
  class Refusal extends Error {
    constructor(public code: number) {
      super(`refused ${code}`);
    }
  }
  it("both refused pre-sign: the BUNDLED refusal is reported (84 reaches the retry, not the bare 21)", async () => {
    const send = vi.fn(async (ixs: TransactionInstruction[], bundled: boolean) => {
      throw new Refusal(bundled ? 84 : 21);
    });
    await expect(sendWithTopup({ topup: [ix(8)], base: [ix(77)], send, isPreSignRefusal: (e) => e instanceof Refusal })).rejects.toMatchObject({ code: 84 });
    expect(send).toHaveBeenCalledTimes(2);
  });
  it("NEGATIVE CONTROL: the base alone landing still wins over a refused bundle", async () => {
    const send = vi.fn(async (ixs: TransactionInstruction[], bundled: boolean) => {
      if (bundled) throw new Refusal(8);
      return ixs.map((i) => i.data[0]);
    });
    expect(await sendWithTopup({ topup: [ix(8)], base: [ix(77)], send, isPreSignRefusal: (e) => e instanceof Refusal })).toEqual([77]);
  });
});

describe("wiring", () => {
  const src = (f: string) => readFileSync(join(__dirname, "..", "..", "..", f), "utf8");
  it("the senior 77 path and the junior 102 path prepend the closes", () => {
    const lp = src("hooks/useInsuranceLP.ts");
    expect(lp).toMatch(/readEmptyCloseIxs\(/);
    expect(lp).toMatch(/const topup = \[\.\.\.emptyCloses, \.\.\.viewerTopup\]/);
    const jr = src("hooks/useJuniorTranche.ts");
    expect(jr).toMatch(/readEmptyCloseIxs\(/);
    expect(jr).toMatch(/sendWithTopup\(\{\s*topup: closes,\s*base: ixs/);
  });
});
