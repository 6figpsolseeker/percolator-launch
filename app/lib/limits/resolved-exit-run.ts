/**
 * Driver for the resolved-market sweep: plan -> simulate -> send, re-reading between rounds.
 * Deps are injected so the loop is testable without RPC (same pattern as closeSlabUntilClosed).
 * A batch that fails simulation is split into single steps; a step that still fails is
 * reported (never retried in the same round). A round that sends nothing ends the run.
 */
import type { TransactionInstruction } from "@solana/web3.js";
import { batchExitSteps, exitStepsCu, type ExitBlocker, type ExitStep, type ResolvedExitPlan } from "./resolved-exit";

export const MAX_EXIT_ROUNDS = 4;

export interface ResolvedExitDeps {
  plan(): Promise<ResolvedExitPlan>;
  ixsFor(step: ExitStep): TransactionInstruction[];
  /** null = the simulation passed. */
  simulate(ixs: TransactionInstruction[]): Promise<unknown | null>;
  /** `computeUnits`: the summed step budgets of this tx (exitStepsCu). */
  send(ixs: TransactionInstruction[], computeUnits: number): Promise<string>;
}

export interface ResolvedExitRun {
  final: ResolvedExitPlan;
  signatures: string[];
  refused: { step: ExitStep; err: unknown }[];
  blockers: ExitBlocker[];
  rounds: number;
}

export async function runResolvedExit(deps: ResolvedExitDeps, maxRounds = MAX_EXIT_ROUNDS, perTx = 3): Promise<ResolvedExitRun> {
  const signatures: string[] = [];
  const refused: { step: ExitStep; err: unknown }[] = [];
  let plan = await deps.plan();
  let rounds = 0;
  while (rounds < maxRounds && (plan.phase === "sweep" || plan.phase === "owner-window") && plan.steps.length > 0) {
    rounds += 1;
    let sentThisRound = 0;
    for (const batch of batchExitSteps(plan.steps, perTx)) {
      const ixs = batch.flatMap((s) => deps.ixsFor(s));
      const err = await deps.simulate(ixs);
      if (err === null) {
        signatures.push(await deps.send(ixs, exitStepsCu(batch)));
        sentThisRound += batch.length;
        continue;
      }
      for (const s of batch) {
        const one = deps.ixsFor(s);
        const e = batch.length === 1 ? err : await deps.simulate(one);
        if (e === null) {
          signatures.push(await deps.send(one, exitStepsCu([s])));
          sentThisRound += 1;
        } else {
          refused.push({ step: s, err: e });
        }
      }
    }
    plan = await deps.plan();
    if (sentThisRound === 0) break;
  }
  const blockers = plan.phase === "not-resolved" ? [] : plan.blockers;
  return { final: plan, signatures, refused, blockers, rounds };
}
