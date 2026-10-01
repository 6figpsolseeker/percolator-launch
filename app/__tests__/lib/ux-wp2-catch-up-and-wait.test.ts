// @vitest-environment node
/**
 * UX WP-2 (ux-audit-2026-09-30.md §7): stale-market auto catch-up (SH-2) + the wait loop
 * (principle 3). BPF half: scripts/limits-parity/p3-sim p3_senior_draw
 * `limits_app_catch_up_cranks_then_trade` (the app's k cranks + trade land in ONE tx on the
 * relaunch 4b1a5d30 bytes; one crank = 17,010 CU).
 */
import { describe, expect, it, vi, afterEach } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { Keypair, PublicKey, Transaction, TransactionInstruction } from "@solana/web3.js";
import bs58 from "bs58";
import { V17_ASSET_ORACLE_WRAPPER_LEN, V17_MARKET_GROUP_LEN, V17_MARKET_GROUP_OFF } from "@percolatorct/sdk";

vi.mock("@/lib/config", () => ({
  getConfig: () => ({ network: "devnet", rpcUrl: "https://api.devnet.solana.com" }),
  getNetwork: () => "devnet",
}));

import { CATCH_UP_CRANK_CU, CATCH_UP_TOTAL_CU, planCatchUp, planSelfHeal } from "@/lib/self-heal";
import { sendTxWaiting, SimulationRefusal } from "@/lib/tx";
import { V17_ENGINE_CONFIG_OFF } from "@/lib/v17-engine-config";
import { resolveDevnetProgramIds } from "@/lib/program-ids";
import { WRAPPER_ERR } from "@/lib/wrapper-errors";

const FX = JSON.parse(readFileSync(join(process.cwd(), "__tests__/fixtures/CdN8r7FB.freshness.market.json"), "utf8")) as { dataBase64: string };
const WRAPPER = resolveDevnetProgramIds().wrapper;

/** A live market image with asset-0 slot_last, max_accrual_dt and header current_slot set. */
function market(slotLast: bigint, dt: bigint, header = 0n): Uint8Array {
  const d = new Uint8Array(Buffer.from(FX.dataBase64, "base64"));
  const dv = new DataView(d.buffer, d.byteOffset, d.byteLength);
  dv.setBigUint64(V17_MARKET_GROUP_OFF + V17_MARKET_GROUP_LEN + V17_ASSET_ORACLE_WRAPPER_LEN + 41, slotLast, true);
  dv.setBigUint64(V17_ENGINE_CONFIG_OFF + 118, dt, true);
  dv.setBigUint64(V17_MARKET_GROUP_OFF + 613, header, true);
  return d;
}

describe("SH-2 planCatchUp: k = ceil(lag / dt) cranks, capped by the CU budget", () => {
  it("lag within the cap", () => {
    expect(planCatchUp(market(1_000n, 500n), 1_000n, 200_000)).toMatchObject({ k: 0, beyondCap: false }); // current
    expect(planCatchUp(market(1_000n, 500n), 1_300n, 200_000)).toMatchObject({ k: 1, lagSlots: 300n });
    expect(planCatchUp(market(1_000n, 500n), 3_600n, 200_000)).toMatchObject({ k: 6, lagSlots: 2_600n });
    // the header slot counts as "now" when newer than the read slot
    expect(planCatchUp(market(1_000n, 500n, 2_000n), 1_500n, 200_000).lagSlots).toBe(1_000n);
  });
  it("beyond the cap: nothing prepended, SH-3 (the keeper catches up)", () => {
    const kMax = Math.floor((CATCH_UP_TOTAL_CU - 200_000) / CATCH_UP_CRANK_CU);
    expect(planCatchUp(market(0n + 1n, 1n), BigInt(kMax) + 1n, 200_000)).toMatchObject({ k: kMax, beyondCap: false });
    expect(planCatchUp(market(1n, 1n), BigInt(kMax) + 2n, 200_000)).toMatchObject({ k: 0, beyondCap: true });
  });
});

describe("SH-2 planSelfHeal: a simulated 19/21 on a lagging clock gets k cranks in the user's tx", () => {
  const programId = new PublicKey(WRAPPER);
  const marketPk = Keypair.generate().publicKey;
  const lp = Keypair.generate().publicKey;
  const cranker = Keypair.generate().publicKey;
  const userIx = new TransactionInstruction({ programId, keys: [], data: Buffer.from([10]) });
  const lock = { InstructionError: [2, { Custom: WRAPPER_ERR.EngineLockActive }] };

  it("prepends the cranks, re-simulates, keeps them when the 19/21 clears", async () => {
    const data = market(1_000n, 500n);
    const simulate = vi.fn(async (ixs: TransactionInstruction[]) => ({ err: ixs.length > 3 ? null : lock }));
    const r = await planSelfHeal(
      { programId, market: marketPk, instructions: [userIx], computeUnits: 200_000, catchUp: { cranker, portfolio: lp } },
      { readMarket: async () => ({ data, slot: 2_200n }), simulate },
    );
    expect(r.outcome).toBe("repaired");
    expect(r.catchUpCranks).toBe(3);
    expect(r.instructions).toHaveLength(4);
    for (const ix of r.instructions.slice(0, 3)) {
      expect(ix.data[0]).toBe(5); // PermissionlessCrank
      expect(ix.keys.map((k) => k.pubkey.toBase58())).toEqual([cranker, marketPk, lp].map((p) => p.toBase58()));
    }
    expect(r.instructions[3]).toBe(userIx);
    expect(r.computeUnits).toBe(200_000 + 3 * CATCH_UP_CRANK_CU);
  });
  it("no catch-up without opt-in; the user's green tx is untouched; a lag the cranks can't fix is reported", async () => {
    const data = market(1_000n, 500n);
    const green = vi.fn(async () => ({ err: null }));
    expect((await planSelfHeal({ programId, market: marketPk, instructions: [userIx], computeUnits: 200_000 }, { readMarket: async () => ({ data, slot: 2_200n }), simulate: green })).outcome).toBe("no-repair-needed");
    expect((await planSelfHeal({ programId, market: marketPk, instructions: [userIx], computeUnits: 200_000, catchUp: { cranker, portfolio: lp } }, { readMarket: async () => ({ data, slot: 2_200n }), simulate: green })).outcome).toBe("user-tx-ok");
    const stuck = vi.fn(async () => ({ err: lock }));
    expect((await planSelfHeal({ programId, market: marketPk, instructions: [userIx], computeUnits: 200_000, catchUp: { cranker, portfolio: lp } }, { readMarket: async () => ({ data, slot: 2_200n }), simulate: stuck })).outcome).toBe("repair-did-not-help");
    const far = await planSelfHeal({ programId, market: marketPk, instructions: [userIx], computeUnits: 200_000, catchUp: { cranker, portfolio: lp } }, { readMarket: async () => ({ data: market(1n, 1n), slot: 10_000n }), simulate: stuck });
    expect(far.catchUpBeyondCap).toBe(true);
  });
});

describe("principle 3: the wait loop re-simulates before any prompt", () => {
  afterEach(() => vi.restoreAllMocks());
  const SIG = bs58.encode(new Uint8Array(64).fill(7));
  function conn(verdicts: unknown[]) {
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
        const err = verdicts[Math.min(n++, verdicts.length - 1)];
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
  const stale = { InstructionError: [0, { Custom: WRAPPER_ERR.EngineStale }] };

  it("19 twice, then green: waits (no prompt), then exactly ONE prompt", async () => {
    const { c, events } = conn([stale, stale, null]);
    const w = wallet(events);
    const waiting: boolean[] = [];
    const sig = await sendTxWaiting({ connection: c, wallet: w, instructions: [ix()], computeUnitsFromSim: { cap: 400_000 }, onWaiting: (x) => waiting.push(x), waitDelaysMs: [0, 0, 0] });
    expect(sig).toBe(SIG);
    expect(w.signTransaction).toHaveBeenCalledTimes(1);
    expect(events.filter((e) => e === "wallet-prompt")).toHaveLength(1);
    expect(events.indexOf("wallet-prompt")).toBeGreaterThan(events.lastIndexOf("simulate") - 1);
    expect(waiting).toEqual([true, true, false]);
  });
  it("a non-waitable refusal surfaces at once; exhaustion surfaces after the last wait; never a prompt", async () => {
    const band = { InstructionError: [0, { Custom: WRAPPER_ERR.ExecPriceOutsideOracleBand }] };
    const a = conn([band]);
    const wa = wallet(a.events);
    await expect(sendTxWaiting({ connection: a.c, wallet: wa, instructions: [ix()], computeUnitsFromSim: { cap: 400_000 }, waitDelaysMs: [0, 0] })).rejects.toBeInstanceOf(SimulationRefusal);
    expect(a.events.filter((e) => e === "simulate")).toHaveLength(1);
    const b = conn([stale]);
    const wb = wallet(b.events);
    await expect(sendTxWaiting({ connection: b.c, wallet: wb, instructions: [ix()], computeUnitsFromSim: { cap: 400_000 }, waitDelaysMs: [0, 0] })).rejects.toBeInstanceOf(SimulationRefusal);
    expect(b.events.filter((e) => e === "simulate")).toHaveLength(3);
    expect(wa.signTransaction).not.toHaveBeenCalled();
    expect(wb.signTransaction).not.toHaveBeenCalled();
  });
});

describe("AC3: no 'maintainer' or 're-seed' anywhere in components/**", () => {
  const files: string[] = [];
  const walk = (d: string) => {
    for (const f of readdirSync(d)) {
      const p = join(d, f);
      if (statSync(p).isDirectory()) walk(p);
      else if (/\.(tsx?|jsx?)$/.test(f)) files.push(p);
    }
  };
  walk(join(process.cwd(), "components"));
  it("scanned the tree", () => expect(files.length).toBeGreaterThan(100));
  it("none", () => {
    const hits = files.filter((f) => /maintainer|re-seed|reseed/i.test(readFileSync(f, "utf8")));
    expect(hits).toEqual([]);
  });
  it("the trade path opts in to the catch-up", () => {
    expect(readFileSync(join(process.cwd(), "hooks/useTrade.ts"), "utf8")).toMatch(/catchUp: \{\s*portfolio: accountB/);
  });
});
