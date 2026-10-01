// @vitest-environment node
/**
 * Final wrapper (3245e861): CloseResolved reaches 204k CU and 101 SettleVaultLpResolved 285k.
 *  - every exit tx asks for the SUM of its steps' budgets (>= 300k per CloseResolved-class step,
 *    >= 400k... per 101 is covered by 320k + the 20k base; a lone 101 tx gets 340k >= 300k) and
 *    batches never exceed the 1.2M cap (three 101s used to share one fixed 600k tx);
 *  - the resolved-exit pre-send simulation carries the cap (a bare simulation gets the 200k default);
 *  - the own-portfolio cleanup (CloseResolved + ClosePortfolio) keeps 600k.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { CLEANUP_CU } from "@/lib/limits/own-portfolio-cleanup";
import { EXIT_STEP_CU, EXIT_TX_CU_CAP, batchExitSteps, exitStepsCu, type ExitStep } from "@/lib/limits/resolved-exit";
import { runResolvedExit } from "@/lib/limits/resolved-exit-run";

const settle = (i: number): ExitStep => ({ kind: "settle-vault-lp", topup: 0, portfolio: `v${i}` });
const close = (i: number): ExitStep => ({ kind: "close-resolved", portfolio: `t${i}` });

describe("resolved CU budgets", () => {
  it("per-step budgets cover the measured costs", () => {
    expect(EXIT_STEP_CU["settle-vault-lp"]).toBeGreaterThanOrEqual(285_000);
    expect(EXIT_STEP_CU["close-resolved"]).toBeGreaterThanOrEqual(204_000);
    // 5544302a, measured on real BPF after a price move: 101 425,253; CloseResolved 301,288.
    expect(EXIT_STEP_CU["settle-vault-lp"]).toBeGreaterThanOrEqual(425_253);
    expect(EXIT_STEP_CU["close-resolved"]).toBeGreaterThanOrEqual(301_288);
    expect(EXIT_STEP_CU["claim-topup"]).toBeGreaterThanOrEqual(301_288);
    expect(exitStepsCu([settle(0)])).toBeGreaterThanOrEqual(300_000);
    expect(exitStepsCu([close(0)])).toBeGreaterThanOrEqual(204_000);
    expect(CLEANUP_CU).toBeGreaterThanOrEqual(400_000);
  });
  it("batches respect the cap: 101s are never packed past 1.2M", () => {
    const b = batchExitSteps([settle(0), settle(1), settle(2), settle(3), close(0), close(1), close(2), close(3)]);
    for (const tx of b) expect(exitStepsCu(tx)).toBeLessThanOrEqual(EXIT_TX_CU_CAP);
    for (const tx of b) expect(tx.reduce((a, s) => a + EXIT_STEP_CU[s.kind], 20_000)).toBeLessThanOrEqual(EXIT_TX_CU_CAP);
    expect(b.flat()).toHaveLength(8);
  });
  it("the runner sends each tx with its steps' summed budget", async () => {
    const sent: number[] = [];
    let round = 0;
    await runResolvedExit({
      plan: async () => (round++ === 0 ? { phase: "sweep", steps: [settle(0), settle(1), settle(2)], blockers: [] } : { phase: "ready", blockers: [] }),
      ixsFor: () => [],
      simulate: async () => null,
      send: async (_ixs, cu) => { sent.push(cu); return "s"; },
    });
    // 3 x 101 no longer fit one 1.2M tx at the 5544302a budget (520k each): 2 + 1.
    expect(sent).toEqual([2 * EXIT_STEP_CU["settle-vault-lp"] + 20_000, EXIT_STEP_CU["settle-vault-lp"] + 20_000]);
  });
  it("the exit simulation runs at the cap", () => {
    const src = readFileSync(resolve(process.cwd(), "hooks/useResolvedExit.ts"), "utf8");
    expect(src).toContain("sim.simulate([...computeBudgetPrefix(EXIT_TX_CU), ...ixs])");
    expect(src).toContain("export const EXIT_TX_CU = EXIT_TX_CU_CAP;");
  });
});
