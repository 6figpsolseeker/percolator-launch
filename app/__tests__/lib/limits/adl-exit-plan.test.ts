// @vitest-environment node
/**
 * E2E B10: the tag-44 exit when the other side has fully exited (18 / 22 at the 44). The
 * candidates run on real BPF in the #519 harness (`b10_app_exits_after_one_side_drained`,
 * scripts/limits-parity/f3-app-b10.ts); here the SELECTION RULE is pinned with injected deps.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { Keypair, PublicKey, TransactionInstruction } from "@solana/web3.js";
import { adlExitCandidates, chooseAdlExit, resetPendingSides, SIDE_MODE_RESET_PENDING, type AdlExitDeps } from "@/lib/limits/adl-exit-plan";
import { FINALIZE_RESET_SIDE_TAG } from "@/lib/self-heal";

const PROG = Keypair.generate().publicKey;
const MARKET = Keypair.generate().publicKey;
const ix = (tag: number, program = PROG) => new TransactionInstruction({ programId: program, keys: [], data: Buffer.from([tag]) });
const crank = ix(5);
const tag44 = ix(44);
const plain = [crank, tag44];
const ie = (index: number, code: number) => ({ InstructionError: [index, { Custom: code }] });
const tags = (ixs: TransactionInstruction[]) => ixs.map((i) => i.data[0]);

describe("resetPendingSides / adlExitCandidates", () => {
  it("only ResetPending sides are finalized", () => {
    expect(resetPendingSides(0, SIDE_MODE_RESET_PENDING)).toEqual([1]);
    expect(resetPendingSides(SIDE_MODE_RESET_PENDING, SIDE_MODE_RESET_PENDING)).toEqual([0, 1]);
    expect(resetPendingSides(1, 0)).toEqual([]);
  });
  it("order: [crank,45,44], [crank,45] (flat), [crank] (flat); 45 = FinalizeResetSide(asset, side) on the market", () => {
    const c = adlExitCandidates({ programId: PROG, market: MARKET, assetIndex: 0, crank, tag44, finalizeSides: [1] });
    expect(c.map((x) => x.route)).toEqual(["finalize+tag44", "crank-settles+finalize", "crank-settles"]);
    expect(tags(c[0].instructions)).toEqual([5, FINALIZE_RESET_SIDE_TAG, 44]);
    expect(c.map((x) => x.needsFlatAfter)).toEqual([false, true, true]);
    const fin = c[0].instructions[1];
    expect(Buffer.from(fin.data).toString("hex")).toBe("2d000001");
    expect(fin.keys).toEqual([{ pubkey: MARKET, isSigner: false, isWritable: true }]);
  });
  it("no ResetPending side => only the crank-settles candidate", () => {
    expect(adlExitCandidates({ programId: PROG, market: MARKET, assetIndex: 0, crank, tag44, finalizeSides: [] }).map((x) => x.route)).toEqual(["crank-settles"]);
  });
});

function deps(script: (ixs: TransactionInstruction[]) => { err: unknown; failingIx?: TransactionInstruction | null; flat?: boolean }): AdlExitDeps & { calls: number[][] } {
  const calls: number[][] = [];
  return {
    calls,
    simulate: async (ixs) => {
      calls.push(tags(ixs));
      const r = script(ixs);
      return { err: r.err, failingIx: r.failingIx ?? null, portfolioAfter: r.flat === undefined ? null : Uint8Array.of(r.flat ? 0 : 1) };
    },
    isFlat: (d) => d[0] === 0,
  };
}
const cands = adlExitCandidates({ programId: PROG, market: MARKET, assetIndex: 0, crank, tag44, finalizeSides: [1] });

describe("chooseAdlExit", () => {
  it("plain sims clean => plain tag 44, no further simulation", async () => {
    const d = deps(() => ({ err: null }));
    expect(await chooseAdlExit({ programId: PROG, plain, tag44, candidates: cands, deps: d })).toEqual({ choice: { route: "tag44", instructions: plain }, trapped: false });
    expect(d.calls).toHaveLength(1);
  });
  it("22 at the 44 (keeper cranked first) => [crank, 45, 44]", async () => {
    const d = deps((ixs) => (ixs.length === 2 && ixs[1] === tag44 ? { err: ie(3, 22), failingIx: tag44 } : { err: null }));
    const r = await chooseAdlExit({ programId: PROG, plain, tag44, candidates: cands, deps: d });
    expect(r.choice?.route).toBe("finalize+tag44");
  });
  it("18 at the 44 (the crank settled the leg) => crank-settles(+finalize) only if the post-state is flat", async () => {
    const d = deps((ixs) => {
      if (ixs.includes(tag44)) return { err: ie(3, 18), failingIx: tag44 };
      if (ixs.length === 2) return { err: ie(3, 19) }; // finalize refused: the side is not drained yet
      return { err: null, flat: true };
    });
    const r = await chooseAdlExit({ programId: PROG, plain, tag44, candidates: cands, deps: d });
    expect(r.choice?.route).toBe("crank-settles");
    expect(tags(r.choice!.instructions)).toEqual([5]);
  });
  it("a candidate without 44 that leaves the leg OPEN is never chosen (it would not close anything)", async () => {
    const d = deps((ixs) => (ixs.includes(tag44) ? { err: ie(3, 18), failingIx: tag44 } : { err: null, flat: false }));
    expect(await chooseAdlExit({ programId: PROG, plain, tag44, candidates: cands, deps: d })).toEqual({ choice: null, trapped: true });
  });
  it("any OTHER failure (a different code, the crank failing, another program) => not trapped, no search", async () => {
    for (const r of [{ err: ie(3, 21), failingIx: tag44 }, { err: ie(2, 18), failingIx: crank }, { err: ie(3, 18), failingIx: ix(44, Keypair.generate().publicKey) }]) {
      const d = deps(() => r);
      expect(await chooseAdlExit({ programId: PROG, plain, tag44, candidates: cands, deps: d })).toEqual({ choice: null, trapped: false });
      expect(d.calls).toHaveLength(1);
    }
  });
});

describe("closeViaRebalanceReduce wiring", () => {
  it("only searches when a side is ResetPending (steady state: no extra simulation), and refuses to send when trapped", () => {
    const src = readFileSync(join(process.cwd(), "lib/limits/rebalance-close.ts"), "utf8");
    expect(src).toContain("if (sides.length > 0 && tag44 && crank)");
    expect(src).toContain("throw new Error(COPY.adlExitTrapped)");
    expect(new PublicKey(PROG).equals(PROG)).toBe(true);
  });
});
