// @vitest-environment node
/**
 * UX WP-3 (audit §3.3 "On submit"): past ~30 s the wait loop keeps trying (the ticket says
 * "We'll keep trying" and offers Stop) instead of surfacing "try again"; Stop ends it with
 * nothing sent and no prompt, and the resolver treats that as quiet.
 */
import { describe, expect, it, vi } from "vitest";
import { Keypair, Transaction, TransactionInstruction } from "@solana/web3.js";
import bs58 from "bs58";

vi.mock("@/lib/config", () => ({
  getConfig: () => ({ network: "devnet", rpcUrl: "https://api.devnet.solana.com" }),
  getNetwork: () => "devnet",
}));

import { sendTxWaiting, WaitStoppedError } from "@/lib/tx";
import { resolveUserMessage } from "@/lib/limits/user-message";
import { resolveDevnetProgramIds } from "@/lib/program-ids";
import { WRAPPER_ERR } from "@/lib/wrapper-errors";

const WRAPPER = resolveDevnetProgramIds().wrapper;
const SIG = bs58.encode(new Uint8Array(64).fill(7));
const stale = { InstructionError: [0, { Custom: WRAPPER_ERR.EngineStale }] };

function conn(verdict: (n: number) => unknown) {
  const events: string[] = [];
  let n = 0;
  const c = {
    rpcEndpoint: "https://percolator-playground.vercel.app/api/rpc",
    getRecentPrioritizationFees: vi.fn().mockResolvedValue([]),
    getBalance: vi.fn().mockResolvedValue(1_000_000_000),
    getLatestBlockhash: vi.fn().mockResolvedValue({ blockhash: "11111111111111111111111111111111", lastValidBlockHeight: 10_000_000 }),
    getBlockHeight: vi.fn().mockResolvedValue(1),
    simulateTransaction: vi.fn(async () => {
      events.push("simulate");
      const err = verdict(n++);
      return { value: { err, logs: err ? [`Program ${WRAPPER} failed: custom program error: 0x13`] : [], unitsConsumed: 50_000 } };
    }),
    sendRawTransaction: vi.fn(async () => { events.push("broadcast"); return SIG; }),
    getSignatureStatuses: vi.fn().mockResolvedValue({ value: [{ confirmationStatus: "confirmed", err: null }] }),
  };
  return { c: c as never, events };
}
const wallet = (events: string[]) => {
  const kp = Keypair.generate();
  return { publicKey: kp.publicKey, signTransaction: vi.fn(async (tx: Transaction) => { events.push("wallet-prompt"); tx.partialSign(kp); return tx; }) };
};
const ix = () => new TransactionInstruction({ programId: Keypair.generate().publicKey, keys: [], data: Buffer.from([1]) });

describe("keepWaiting: past the schedule the loop keeps re-simulating, then lands with ONE prompt", () => {
  it("7 stale rounds on a 2-step schedule: no throw, onWaitingLong once, then green -> 1 prompt", async () => {
    const { c, events } = conn((n) => (n < 7 ? stale : null));
    const w = wallet(events);
    const long = vi.fn();
    const sig = await sendTxWaiting({
      connection: c, wallet: w, instructions: [ix()], computeUnitsFromSim: { cap: 400_000 },
      waitDelaysMs: [1, 1], keepWaiting: true, longWaitMs: 3, onWaitingLong: long,
    });
    expect(sig).toBe(SIG);
    expect(events.filter((e) => e === "simulate")).toHaveLength(8);
    expect(w.signTransaction).toHaveBeenCalledTimes(1);
    expect(long).toHaveBeenCalledTimes(1);
  });

  it("CONTROL: without keepWaiting the same market surfaces after the schedule", async () => {
    const { c, events } = conn((n) => (n < 7 ? stale : null));
    const w = wallet(events);
    await expect(
      sendTxWaiting({ connection: c, wallet: w, instructions: [ix()], computeUnitsFromSim: { cap: 400_000 }, waitDelaysMs: [1, 1] }),
    ).rejects.toMatchObject({ name: "SimulationRefusal" });
    expect(events.filter((e) => e === "simulate")).toHaveLength(3);
    expect(w.signTransaction).not.toHaveBeenCalled();
  });

  it("Stop (abort) mid-wait: WaitStoppedError, no prompt, nothing broadcast; the resolver is quiet", async () => {
    const { c, events } = conn(() => stale);
    const w = wallet(events);
    const ac = new AbortController();
    const p = sendTxWaiting({
      connection: c, wallet: w, instructions: [ix()], computeUnitsFromSim: { cap: 400_000 },
      waitDelaysMs: [5_000], keepWaiting: true, abortSignal: ac.signal,
      onWaiting: (x) => { if (x) setTimeout(() => ac.abort(), 5); },
    });
    const err = await p.catch((e: unknown) => e);
    expect(err).toBeInstanceOf(WaitStoppedError);
    expect(events).not.toContain("wallet-prompt");
    expect(events).not.toContain("broadcast");
    const um = resolveUserMessage(err, { surface: "trade" });
    expect(um.quiet).toBe(true);
    expect(um.body).not.toMatch(/try again/i);
  });
});
