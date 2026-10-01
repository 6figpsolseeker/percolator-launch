// @vitest-environment node
/**
 * Wrapper 5544302a: on a Resolved market at terminal-flat, a bound vault's 77 refuses 84 until 78
 * has absorbed the stray pot backing (the vault LP's recycled claim payout), which the app does not
 * decode. The payout answers the pre-sign 84 by rebuilding the same tx with 78 in front
 * (sendWithHarvestOn84); still one wallet prompt, because sendTx simulates before signing.
 * On real BPF: p3_vault_lp limits_app_p3_resolved_77_after_vault_lp_win_needs_78_first (5544302a).
 */
import { describe, expect, it, vi } from "vitest";
import { Keypair, TransactionInstruction } from "@solana/web3.js";
import { sendWithHarvestOn84, withForcedHarvest, type EarnTxPlan } from "@/lib/limits/earn-ixs";
import { SimulationRefusal } from "@/lib/tx";
import { WRAPPER_ERR } from "@/lib/wrapper-errors";
import { resolveDevnetProgramIds } from "@/lib/program-ids";
import { isHarvestPendingRefusal } from "@/hooks/useInsuranceLP";

const ix = (tag: number) => new TransactionInstruction({ programId: Keypair.generate().publicKey, keys: [], data: Buffer.from([tag]) });
const refusal = (code: number, program: string | null) =>
  new SimulationRefusal({ InstructionError: [2, { Custom: code }] }, program ? [`Program ${program} failed: custom program error: 0x${code.toString(16)}`] : []);

describe("sendWithHarvestOn84", () => {
  it("a pre-sign 84 rebuilds the payout with 78 in front and sends it once more", async () => {
    const sent: number[][] = [];
    const build = vi.fn(async (force: boolean) => (force ? [ix(78), ix(77)] : [ix(77)]));
    const send = vi.fn(async (ixs: TransactionInstruction[]) => {
      sent.push(ixs.map((x) => x.data[0]!));
      if (ixs.length === 1) throw refusal(WRAPPER_ERR.VaultLpHarvestPending, resolveDevnetProgramIds().wrapper);
      return "sig";
    });
    expect(await sendWithHarvestOn84({ build, send, isHarvestPendingRefusal })).toBe("sig");
    expect(sent).toEqual([[77], [78, 77]]);
    expect(build.mock.calls.map((c) => c[0])).toEqual([false, true]);
  });
  it("any other refusal is not retried; a first success is not retried", async () => {
    const other = sendWithHarvestOn84({ build: async () => [ix(77)], send: async () => { throw refusal(WRAPPER_ERR.EngineLockActive, resolveDevnetProgramIds().wrapper); }, isHarvestPendingRefusal });
    await expect(other).rejects.toBeInstanceOf(SimulationRefusal);
    const send = vi.fn(async () => "ok");
    expect(await sendWithHarvestOn84({ build: async () => [ix(77)], send, isHarvestPendingRefusal })).toBe("ok");
    expect(send).toHaveBeenCalledTimes(1);
  });
  it("only the WRAPPER's 84 counts (a CPI callee's 84 is not a harvest refusal)", () => {
    expect(isHarvestPendingRefusal(refusal(84, resolveDevnetProgramIds().wrapper))).toBe(true);
    expect(isHarvestPendingRefusal(refusal(84, Keypair.generate().publicKey.toBase58()))).toBe(false);
    expect(isHarvestPendingRefusal(refusal(21, resolveDevnetProgramIds().wrapper))).toBe(false);
    expect(isHarvestPendingRefusal(new Error("custom program error: 0x54"))).toBe(false);
  });
  it("withForcedHarvest only forces 78 on a bound plan with its tail", () => {
    const tail = { vaultLpState: Keypair.generate().publicKey, lpPortfolio: Keypair.generate().publicKey };
    const bound: EarnTxPlan = { ok: true, tail, prependHarvest: false };
    expect(withForcedHarvest(bound, true)).toEqual({ ok: true, tail, prependHarvest: true });
    expect(withForcedHarvest(bound, false)).toBe(bound);
    const unbound: EarnTxPlan = { ok: true, tail: null, prependHarvest: false };
    expect(withForcedHarvest(unbound, true)).toBe(unbound);
  });
  it("the hook uses it on both payout paths", async () => {
    const { readFileSync } = await import("node:fs");
    const src = readFileSync(`${process.cwd()}/hooks/useInsuranceLP.ts`, "utf8");
    expect(src.match(/sendWithHarvestOn84\(\{/g)).toHaveLength(2);
    expect(src).toContain("withForcedHarvest(earnTxPlan(TAG_EXECUTE_REDEMPTION");
  });
});
