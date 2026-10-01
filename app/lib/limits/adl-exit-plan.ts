/**
 * E2E B10 (MEDIUM): in the F-3 ADL reduce-only state, once one side has fully exited by tag 44
 * the OTHER side's positions are ADL'd to zero effective OI and that side is `ResetPending`.
 * The app's [PermissionlessCrank(own portfolio), RebalanceReduce (44)] then fails AT the 44:
 *   - Custom(18) EngineInvalidLeg — the crank in the same tx already settled the leg to zero, so
 *     the 44 finds no leg and the WHOLE tx (the crank's settlement too) reverts
 *     (#519 LiteSVM trace on the deployed v18.2 wrapper);
 *   - Custom(22) EngineNonProgress — seen live with the keeper running (the leg exists but the
 *     44 has no capacity until FinalizeResetSide (45) runs).
 * Either way the holder could neither exit nor withdraw until someone cranked + sent 45.
 *
 * Fix, in the user's OWN transaction (the P0b self-heal pattern): when the plain tx simulates
 * to a WRAPPER 18/22 at the 44, try, in order,
 *   1. [crank, 45 for each ResetPending side, 44]           (the 22 case)
 *   2. [crank, 45 ...]    — accepted only if the simulated post-state shows the leg FLAT
 *                           (settles, and reopens the drained side in the same tx)
 *   3. [crank]            — same flat check (the side cannot be finalized yet)
 * and send the first that simulates clean (and, for 2/3, closes the position). 45 is
 * permissionless and the engine refuses it unless the side really is finalizable, so an early
 * one is a clean revert that just disqualifies that candidate. Pure; deps are injected.
 */
import type { PublicKey, TransactionInstruction } from "@solana/web3.js";
import { buildLivenessRepairIx, parseCustomInstructionError } from "@/lib/self-heal";

export const ENGINE_INVALID_LEG = 18;
export const ENGINE_NON_PROGRESS = 22;
/** SideModeV16 ResetPending (engine 35ddd692; see lib/self-heal.ts). */
export const SIDE_MODE_RESET_PENDING = 2;

export type AdlExitRoute = "tag44" | "finalize+tag44" | "crank-settles" | "crank-settles+finalize";

export interface AdlExitCandidate {
  route: AdlExitRoute;
  instructions: TransactionInstruction[];
  /** No tag 44 in it: accept only if the simulated post-state shows the leg flat. */
  needsFlatAfter: boolean;
}

/** The sides FinalizeResetSide may apply to (read from the market before the tx). */
export function resetPendingSides(modeLong: number, modeShort: number): (0 | 1)[] {
  const out: (0 | 1)[] = [];
  if (modeLong === SIDE_MODE_RESET_PENDING) out.push(0);
  if (modeShort === SIDE_MODE_RESET_PENDING) out.push(1);
  return out;
}

export function adlExitCandidates(p: {
  programId: PublicKey;
  market: PublicKey;
  assetIndex: number;
  crank: TransactionInstruction;
  tag44: TransactionInstruction;
  finalizeSides: readonly (0 | 1)[];
}): AdlExitCandidate[] {
  const fin = p.finalizeSides.map((side) => buildLivenessRepairIx(p.programId, p.market, { kind: "finalize", assetIndex: p.assetIndex, side }));
  // Prefer the variants that ALSO finalize: the last holder's exit then reopens the drained side
  // in the same tx (else fresh opens stay blocked 21 until someone sends 45). A finalize the
  // engine refuses (side not drained yet) disqualifies only that candidate.
  const out: AdlExitCandidate[] = [];
  if (fin.length > 0) out.push({ route: "finalize+tag44", instructions: [p.crank, ...fin, p.tag44], needsFlatAfter: false });
  if (fin.length > 0) out.push({ route: "crank-settles+finalize", instructions: [p.crank, ...fin], needsFlatAfter: true });
  out.push({ route: "crank-settles", instructions: [p.crank], needsFlatAfter: true });
  return out;
}

export interface AdlExitDeps {
  /** Simulate `ixs` (the deps add the compute-budget prefix and account for it in the index). */
  simulate(ixs: TransactionInstruction[]): Promise<{ err: unknown; failingIx: TransactionInstruction | null; portfolioAfter: Uint8Array | null }>;
  isFlat(portfolioData: Uint8Array): boolean;
}

export type AdlExitChoice = { route: AdlExitRoute; instructions: TransactionInstruction[] };

/**
 * Plain route first; on the B10 trap, the first candidate that simulates clean (and, if it has
 * no 44, leaves the leg flat). Returns null when the plain tx fails for another reason (the
 * caller sends it and surfaces that error) or when no candidate works.
 */
export async function chooseAdlExit(p: {
  programId: PublicKey;
  plain: TransactionInstruction[];
  tag44: TransactionInstruction;
  candidates: AdlExitCandidate[];
  deps: AdlExitDeps;
}): Promise<{ choice: AdlExitChoice | null; trapped: boolean }> {
  const first = await p.deps.simulate(p.plain);
  if (!first.err) return { choice: { route: "tag44", instructions: p.plain }, trapped: false };
  const c = parseCustomInstructionError(first.err);
  const trapped =
    !!c && (c.code === ENGINE_INVALID_LEG || c.code === ENGINE_NON_PROGRESS) && first.failingIx === p.tag44 && p.tag44.programId.equals(p.programId);
  if (!trapped) return { choice: null, trapped: false };
  for (const cand of p.candidates) {
    const r = await p.deps.simulate(cand.instructions);
    if (r.err) continue;
    if (cand.needsFlatAfter && !(r.portfolioAfter && p.deps.isFlat(r.portfolioAfter))) continue;
    return { choice: { route: cand.route, instructions: cand.instructions }, trapped: true };
  }
  return { choice: null, trapped: true };
}
