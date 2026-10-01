// @vitest-environment node
/**
 * P3 FINAL 39b138c8 (d119eebd senior draw + D-P3-30 recall cap): the client interface.
 * 87/88, the writable vault LP on 75/77, the 88 recall-then-redeem repair, the draw logs and
 * "Earn absorbed". The same code runs on real BPF in scripts/limits-parity/p3-sim
 * (p3_senior_draw.limits-app.patch: limits_app_senior_draw_absorbed_logs_and_88_recall_then_redeem).
 */
import { describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { Keypair, PublicKey, TransactionInstruction } from "@solana/web3.js";
import * as C from "@/lib/limits/constants";
import { decodeVaultLpState } from "@/lib/limits/decode";
import { withBoundVaultLpTail } from "@/lib/limits/p3-ix";
import { buildEarnExecuteIxs } from "@/lib/limits/earn-ixs";
import { earnAbsorbed } from "@/lib/limits/vault-tranche";
import { drawNoticeText, parseP3DrawLogs, readTxDrawSummary, summarizeDrawEvents } from "@/lib/limits/p3-draw-logs";
import {
  drawRepairFailure,
  find77,
  planSeniorDrawRepair,
  recallIxFor77,
  redeemRepairVariants,
  with77FromOtherPot,
  withRecallBefore77,
} from "@/lib/limits/senior-draw-repair";
import { P3_ERROR_COPY_BY_NAME } from "@/lib/limits/copy";
import { earnErrorMessage } from "@/lib/earnErrors";
import { resolveDevnetProgramIds } from "@/lib/program-ids";

const k = () => Keypair.generate().publicKey;
const PROG = k();

describe("87 / 88 are in the one constants module with copy", () => {
  it("ordinals and copy", () => {
    expect(C.P3_ERR.VaultLpSeniorDrawRequired).toBe(87);
    expect(C.P3_ERR.VaultLpRedeemNeedsRecall).toBe(88);
    expect(P3_ERROR_COPY_BY_NAME.VaultLpSeniorDrawRequired).toMatch(/Nothing moved/);
    // UX WP-10 (§5.1): plain effect ("in use by open trades").
    expect(P3_ERROR_COPY_BY_NAME.VaultLpRedeemNeedsRecall).toMatch(/in use by open trades/);
    const e = (n: number) => new Error(`{"InstructionError":[3,{"Custom":${n}}]}\nProgram ${resolveDevnetProgramIds().wrapper} failed: custom program error: 0x${n.toString(16)}`);
    // UX WP-1: the Earn panel shows the ONE resolver's line (lib/limits/user-message.ts).
    expect(earnErrorMessage(e(88), "claim", { p3Bound: true })).toMatch(/^Part of this vault's money is in use by open trades right now\./);
    expect(earnErrorMessage(e(87), "deposit")).toBe("The vault is booking a recent market move. Try again in a moment.");
  });
});

describe("89 VaultLpPausedForSeniorDraw (4b1a5d30): one calm, specific message", () => {
  it("is in the constants module and maps everywhere the app shows wrapper errors", () => {
    expect(C.P3_ERR.VaultLpPausedForSeniorDraw).toBe(89);
    const copy = P3_ERROR_COPY_BY_NAME.VaultLpPausedForSeniorDraw;
    expect(copy).toMatch(/^Paused while Earn covers a loss\./);
    expect(copy).toMatch(/nothing moved/);
    const e = new Error(`{"InstructionError":[2,{"Custom":89}]}\nProgram ${resolveDevnetProgramIds().wrapper} failed: custom program error: 0x59`);
    // the Earn panel's line (the resolver) keeps the same calm opening
    expect(earnErrorMessage(e, "claim", { p3Bound: true })).toMatch(/^Paused while Earn covers a loss\./);
  });
});

describe("75 / 77 pass the vault LP WRITABLE (d119eebd); 78's tail is state only", () => {
  const base = (n: number) => Array.from({ length: n }, () => ({ pubkey: k(), isSigner: false, isWritable: true }));
  it("75 and 77", () => {
    for (const [tag, n] of [[75, 11], [77, 13]] as const) {
      const out = withBoundVaultLpTail(tag, base(n), k(), k());
      expect(out[n].isWritable).toBe(true); // vault_lp_state
      expect(out[n + 1].isWritable).toBe(true); // vault LP
    }
    expect(withBoundVaultLpTail(78, base(6), k())).toHaveLength(7);
  });
});

describe("security (221cf006): a bound-vault 77 ALWAYS carries BOTH pot ledgers writable", () => {
  // A read-only sibling ledger skips the cross-pot top-up and Live returns 88 (wrong fix).
  it("the Earn claim's 77 and every repair variant built from it", () => {
    const ledger = k();
    const siblingLedger = k();
    const plan = { ok: true as const, tail: { vaultLpState: k(), lpPortfolio: k() }, prependHarvest: true };
    const ixs = buildEarnExecuteIxs({
      programId: PROG, redeemer: k(), market: k(), registry: k(), redemption: k(), lpMint: k(), escrow: k(),
      vaultToken: k(), vaultAuthority: k(), ledger, redeemerDest: k(), siblingLedger, domain: 0, plan,
    });
    const at = find77(ixs, PROG);
    const check = (ix: TransactionInstruction) => {
      expect(ix.keys[8].pubkey.equals(ledger) && ix.keys[8].isWritable).toBe(true);
      expect(ix.keys[11].pubkey.equals(siblingLedger) && ix.keys[11].isWritable).toBe(true);
      expect(ix.keys[14].isWritable).toBe(true); // vault LP (d119eebd)
    };
    check(ixs[at]);
    for (const v of redeemRepairVariants(ixs, at, k(), [5n])) check(v.ixs[find77(v.ixs, PROG)]);
    // the 78 in front and any 98 recall carry both ledgers writable too
    for (const ix of withRecallBefore77(ixs, at, k(), 5n)) {
      if (ix.data[0] === 98 || ix.data[0] === 78) {
        const w = ix.keys.filter((m) => m.pubkey.equals(ledger) || m.pubkey.equals(siblingLedger));
        expect(w).toHaveLength(2);
        expect(w.every((m) => m.isWritable)).toBe(true);
      }
    }
  });
});

describe("VaultLpStateV18 senior-draw fields -> Earn absorbed", () => {
  it("decodes drawn/outstanding at +224/+240 and derives absorbed/restored", () => {
    const acct = new Uint8Array(C.VAULT_LP_STATE_ACCOUNT_LEN);
    acct[C.HEADER_KIND_OFF] = C.KIND_VAULT_LP_STATE;
    acct[C.VS.version] = C.VAULT_LP_STATE_VERSION;
    const dv = new DataView(acct.buffer);
    dv.setUint16(C.VS.juniorFloorBps, 1_000, true);
    dv.setBigUint64(C.VS.seniorDrawnAtoms, 1_635_213n, true);
    dv.setBigUint64(C.VS.seniorDrawOutstandingAtoms, 635_213n, true);
    const s = decodeVaultLpState(acct)!;
    expect(s.seniorDrawnAtoms).toBe(1_635_213n);
    expect(s.seniorDrawOutstandingAtoms).toBe(635_213n);
    expect(earnAbsorbed(s)).toEqual({ outstanding: 635_213n, drawn: 1_635_213n, restored: 1_000_000n });
    expect(earnAbsorbed({ seniorDrawnAtoms: 0n, seniorDrawOutstandingAtoms: 0n })).toBeNull();
  });
});

describe("draw logs (the program's sol_log lines)", () => {
  const logs = [
    "Program Perco1ator111111111111111111111111111111111 invoke [1]",
    "Program log: p3_senior_draw deficit=1635213 moved=1635213 unfunded=0 even=1471692 odd=163521",
    "Program log: p3_senior_draw_booked moved=1635213 junior_cover=0 senior_loss=1635213 C=8364787 outstanding=1635213",
    "Program log: p3_residual_relabel domain=0 atoms=6000000",
    "Program log: p3_senior_draw_restored to_seniors=1635213 C=10001000 outstanding=0",
    "Program log: p3_senior_draw deficit=5 moved=0 unfunded=5",
    "Program log: unrelated p3_senior_draw_booked moved=1",
  ];
  it("parses every event kind and ignores other lines", () => {
    const ev = parseP3DrawLogs(logs);
    expect(ev.map((e) => e.kind)).toEqual(["draw", "booked", "relabel", "restored", "draw"]);
    expect(ev[0]).toMatchObject({ deficit: 1_635_213n, moved: 1_635_213n, even: 1_471_692n, odd: 163_521n });
    expect(ev[4]).toMatchObject({ moved: 0n, unfunded: 5n, even: null, odd: null });
    expect(summarizeDrawEvents(ev)).toEqual({ earnAbsorbed: 1_635_213n, earnRestored: 1_635_213n });
    expect(summarizeDrawEvents(parseP3DrawLogs(["Program log: other"]))).toBeNull();
    expect(drawNoticeText({ earnAbsorbed: 5n, earnRestored: 0n }, (a) => `${a} USDC`)).toMatch(/^Earn absorbed 5 USDC: .*pro rata/);
  });
  it("readTxDrawSummary is best effort", async () => {
    const ok = { getTransaction: vi.fn(async () => ({ meta: { logMessages: logs } })) };
    expect(await readTxDrawSummary(ok as never, "sig")).toEqual({ earnAbsorbed: 1_635_213n, earnRestored: 1_635_213n });
    const bad = { getTransaction: vi.fn(async () => { throw new Error("rpc"); }) };
    expect(await readTxDrawSummary(bad as never, "sig")).toBeNull();
  });
});

describe("88 repair: 98 recall inserted before the 77, simulation-verified", () => {
  // A bound 77 as buildEarnExecuteIxs + tail emit it (15 accounts), domain 0.
  const keys = Array.from({ length: 15 }, () => ({ pubkey: k(), isSigner: false, isWritable: true }));
  const ix77 = new TransactionInstruction({ programId: PROG, keys, data: Buffer.from([77, 0, 0]) });
  const harvest = new TransactionInstruction({ programId: PROG, keys: [], data: Buffer.from([78, 0, 0]) });
  const cranker = k();

  it("recallIxFor77 maps the 77's accounts onto 98's list", () => {
    const r = recallIxFor77(ix77, cranker, 1_635_213n);
    expect(r.data[0]).toBe(98);
    expect(r.keys.map((m) => m.pubkey.toBase58())).toEqual([
      cranker, keys[1].pubkey, keys[2].pubkey, keys[13].pubkey, keys[14].pubkey, keys[8].pubkey, keys[11].pubkey,
    ].map((p) => p.toBase58()).concat([r.keys[7].pubkey.toBase58()]));
    expect(withRecallBefore77([harvest, ix77], 1, cranker, 5n).map((i) => i.data[0])).toEqual([78, 98, 77]);
    expect(find77([harvest, ix77], PROG)).toBe(1);
  });

  it("other-pot variant flips only the 77's domain; variant order is other-pot, recall, other-pot + recall", () => {
    const moved = with77FromOtherPot([harvest, ix77], 1);
    expect(Array.from(moved[1].data)).toEqual([77, 1, 0]);
    expect(moved[1].keys).toBe(ix77.keys);
    const v = redeemRepairVariants([harvest, ix77], 1, cranker, [10n, 5n]);
    expect(v.map((x) => x.kind)).toEqual(["other-pot", "recall", "recall", "other-pot-recall", "other-pot-recall"]);
    // the recall follows the 77's pot: target domain 1 on the other-pot + recall variant
    const r = v[3].ixs[1];
    expect(r.data[0]).toBe(98);
    expect(Buffer.from(r.data).readUInt16LE(17)).toBe(1);
    expect(Buffer.from(v[1].ixs[1].data).readUInt16LE(17)).toBe(0);
  });

  it("drawRepairFailure: WRAPPER 87 / 88, and 25 only on a bound-vault 77 (39b138c8 ordering)", () => {
    const list = [harvest, ix77];
    expect(drawRepairFailure({ InstructionError: [1, { Custom: 88 }] }, list, PROG)).toEqual({ code: "needs-recall", index: 1 });
    expect(drawRepairFailure({ InstructionError: [1, { Custom: 87 }] }, list, PROG)).toEqual({ code: "draw-required", index: 1 });
    expect(drawRepairFailure({ InstructionError: [1, { Custom: 88 }] }, list, k())).toBeNull();
    expect(drawRepairFailure({ InstructionError: [1, { Custom: 21 }] }, list, PROG)).toBeNull();
    // 25 EngineCounterUnderflow: a bound 77 (15 accounts) -> try the recall; anything else -> no.
    expect(drawRepairFailure({ InstructionError: [1, { Custom: 25 }] }, list, PROG)).toEqual({ code: "needs-recall", index: 1 });
    expect(drawRepairFailure({ InstructionError: [0, { Custom: 25 }] }, list, PROG)).toBeNull(); // the 78
    const unbound77 = new TransactionInstruction({ programId: PROG, keys: keys.slice(0, 13), data: Buffer.from([77, 0, 0]) });
    expect(drawRepairFailure({ InstructionError: [0, { Custom: 25 }] }, [unbound77], PROG)).toBeNull();
  });

  it("planSeniorDrawRepair: ok tx untouched; 88 keeps the first candidate that simulates clean", async () => {
    const market = new Uint8Array(
      Buffer.from(readFileSync(join(process.cwd(), "__tests__/fixtures/v18-liveness/pengu-market-v18-healthy.b64"), "utf8").trim(), "base64"),
    );
    const vs = new Uint8Array(C.VAULT_LP_STATE_ACCOUNT_LEN);
    vs[C.HEADER_KIND_OFF] = C.KIND_VAULT_LP_STATE;
    vs[C.VS.version] = C.VAULT_LP_STATE_VERSION;
    new DataView(vs.buffer).setUint16(C.VS.juniorFloorBps, 1_000, true);
    // A senior claim far above the pair's physical backing: the estimate is positive.
    new DataView(vs.buffer).setBigUint64(C.VS.seniorClaimAtoms, 1n << 62n, true);
    const reads = new Map<string, Uint8Array>([[keys[13].pubkey.toBase58(), vs]]);
    const mk = k();
    const read = vi.fn(async (pk: PublicKey) => (pk.equals(mk) ? market : reads.get(pk.toBase58()) ?? null));
    const tried: bigint[] = [];
    const simulate = vi.fn(async (ixs: TransactionInstruction[]) => {
      const r = ixs.find((i) => i.data[0] === 98);
      if (!r) return { err: { InstructionError: [ixs.length - 1, { Custom: 88 }] } };
      tried.push(Buffer.from(r.data).readBigUInt64LE(1));
      // The first (largest) candidate is refused 76 by the program's cap; the next lands.
      return { err: tried.length === 1 ? { InstructionError: [3, { Custom: 76 }] } : null };
    });
    const p = { programId: PROG, market: mk, cranker, instructions: [harvest, ix77], computeUnits: 200_000 };
    const r = await planSeniorDrawRepair(p, { read, simulate });
    expect(r.outcome).toBe("recalled");
    expect(tried.length).toBe(2); // the other-pot variant (no 98) failed 88 first
    expect(tried[1] < tried[0]).toBe(true);
    expect(r.recallAtoms).toBe(tried[1]);
    expect(r.instructions.map((i) => i.data[0])).toEqual([78, 98, 77]);
    expect(r.computeUnits).toBeGreaterThan(200_000);
    // Every candidate refused -> unchanged, the user sees 88's copy.
    const never = vi.fn(async (ixs: TransactionInstruction[]) =>
      ({ err: ixs.some((i) => i.data[0] === 98) ? { InstructionError: [3, { Custom: 76 }] } : { InstructionError: [ixs.length - 1, { Custom: 88 }] } }));
    expect((await planSeniorDrawRepair(p, { read, simulate: never })).outcome).toBe("repair-did-not-help");
    // 39b138c8: the plain 77 fails 25 (ledger underflow before the 88 check): same repair.
    const via25 = vi.fn(async (ixs: TransactionInstruction[]) =>
      ({ err: ixs.some((i) => i.data[0] === 98) ? null : { InstructionError: [ixs.length - 1, { Custom: 25 }] } }));
    const r25 = await planSeniorDrawRepair(p, { read, simulate: via25 });
    expect(r25.outcome).toBe("recalled");
    expect(r25.instructions.map((i) => i.data[0])).toEqual([78, 98, 77]);
    // ...and a 25 the recall does NOT fix leaves the tx unchanged (the user sees the real error).
    const stuck25 = vi.fn(async (ixs: TransactionInstruction[]) => ({ err: { InstructionError: [ixs.length - 1, { Custom: 25 }] } }));
    expect((await planSeniorDrawRepair(p, { read, simulate: stuck25 })).outcome).toBe("repair-did-not-help");
    // Nothing to repair.
    expect((await planSeniorDrawRepair(p, { read, simulate: vi.fn(async () => ({ err: null })) })).outcome).toBe("user-tx-ok");
    // No readable state -> not repairable.
    expect((await planSeniorDrawRepair(p, { read: vi.fn(async () => null), simulate })).outcome).toBe("not-repairable");
  });
});
