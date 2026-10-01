// @vitest-environment node
/**
 * P3 account lists (read from the handler bodies at feat/p3-vault-owned-lp@424fe7e4; executed
 * end to end on real BPF by scripts/limits-parity/p3-sim) and the Earn tx plan.
 */
import { describe, it, expect } from "vitest";
import { Keypair, PublicKey, SystemProgram } from "@solana/web3.js";
import * as ix from "@/lib/limits/p3-ix";
import * as C from "@/lib/limits/constants";
import { buildEarnDepositIxs, buildEarnExecuteIxs, earnTxPlan, ledgerPrincipalAtoms, rebalanceLadder, sendWithRebalanceOn25, unboundPotShortfall, type EarnP3Context } from "@/lib/limits/earn-ixs";

const k = () => Keypair.generate().publicKey;
const PROG = k();
const MARKET = k();
const m: ix.VaultLpMarket = {
  programId: PROG,
  market: MARKET,
  registry: ix.deriveLpVaultRegistryPda(PROG, MARKET),
  vaultLpState: ix.deriveVaultLpState(PROG, MARKET),
  lpPortfolio: k(),
  ledger: k(),
  siblingLedger: k(),
};
const flags = (i: { keys: { isSigner: boolean; isWritable: boolean }[] }) => i.keys.map((x) => `${x.isSigner ? "s" : "-"}${x.isWritable ? "w" : "-"}`).join(" ");
const keys = (i: { keys: { pubkey: PublicKey }[] }) => i.keys.map((x) => x.pubkey.toBase58());

describe("P3 PDAs", () => {
  it("vault-LP state = [\"vault_lp\", market], registry = [\"lp_vault\", market], nft registry = [\"nft_registry\", market]", () => {
    const enc = new TextEncoder();
    expect(ix.deriveVaultLpState(PROG, MARKET).equals(PublicKey.findProgramAddressSync([enc.encode("vault_lp"), MARKET.toBytes()], PROG)[0])).toBe(true);
    expect(ix.deriveLpVaultRegistryPda(PROG, MARKET).equals(PublicKey.findProgramAddressSync([enc.encode("lp_vault"), MARKET.toBytes()], PROG)[0])).toBe(true);
    expect(ix.deriveNftRegistryPda(PROG, MARKET).equals(PublicKey.findProgramAddressSync([enc.encode("nft_registry"), MARKET.toBytes()], PROG)[0])).toBe(true);
  });
});

describe("P3 builders: account order + signer/writable exactly as the handlers read them", () => {
  it("94 InitVaultLp auto-pin (07a1d0eb handle_init_vault_lp): marketauth + [8] matcher, [9] ctx (w), [10] delegate", () => {
    const auth = k(), mp = k(), ctxk = k();
    const i = ix.buildInitVaultLpIx(m, auth, 2_000, { matcherProgram: mp, matcherCtx: ctxk });
    const del = ix.deriveVaultLpMatcherDelegate(PROG, MARKET, m.lpPortfolio, m.registry, mp, ctxk);
    expect(keys(i)).toEqual([auth, MARKET, m.registry, m.vaultLpState, m.lpPortfolio, SystemProgram.programId, m.ledger, m.siblingLedger, mp, ctxk, del].map((x) => x.toBase58()));
    expect(flags(i)).toBe("sw -w -w -w -w -- -w -w -- -w --");
  });
  it("96 DepositJuniorTranche (handle_deposit_junior_tranche :26282)", () => {
    const o = k(), src = k(), vt = k();
    const i = ix.buildDepositJuniorTrancheIx(m, o, src, vt, 5n);
    expect(keys(i).slice(0, 6)).toEqual([o, MARKET, m.vaultLpState, m.lpPortfolio, src, vt].map((x) => x.toBase58()));
    expect(flags(i)).toBe("s- -w -w -w -w -w --");
  });
  it("97 WithdrawJuniorTranche (handle_withdraw_junior_tranche :26357)", () => {
    const o = k(), dst = k(), vt = k(), va = k();
    const i = ix.buildWithdrawJuniorTrancheIx(m, o, dst, vt, va, 1n);
    expect(keys(i).slice(0, 10)).toEqual([o, MARKET, m.registry, m.vaultLpState, m.lpPortfolio, m.ledger, m.siblingLedger, dst, vt, va].map((x) => x.toBase58()));
    expect(i.keys).toHaveLength(11);
  });
  it("101 VaultLpSettleResolved (handle_vault_lp_settle_resolved :26694)", () => {
    const c = k(), jd = k(), vt = k(), va = k();
    const i = ix.buildVaultLpSettleResolvedIx(m, c, jd, vt, va, 0);
    expect(keys(i).slice(0, 10)).toEqual([c, MARKET, m.registry, m.vaultLpState, m.lpPortfolio, m.ledger, m.siblingLedger, jd, vt, va].map((x) => x.toBase58()));
    expect(i.keys[11].pubkey.equals(SystemProgram.programId)).toBe(true);
    expect(flags(i)).toBe("sw -w -- -w -w -w -- -w -w -- -- --");
  });
  it("30 / 46 permissionless: owner UNSIGNED at [0], owner ATA [3], NftRegistry proof at [7] and nothing after (no NFT trio)", () => {
    const owner = k(), pf = k(), ata = k(), vt = k(), va = k();
    for (const tag of [C.TAG_CLOSE_RESOLVED, C.TAG_CLAIM_RESOLVED_PAYOUT_TOPUP] as const) {
      const i = ix.buildPermissionlessResolvedIx({ tag, programId: PROG, owner, market: MARKET, portfolio: pf, ownerAta: ata, vaultToken: vt, vaultAuthority: va });
      expect(i.keys).toHaveLength(8);
      expect(i.keys[0]).toEqual({ pubkey: owner, isSigner: false, isWritable: false });
      expect(keys(i).slice(1, 6)).toEqual([MARKET, pf, ata, vt, va].map((x) => x.toBase58()));
      expect(i.keys[7].pubkey.equals(ix.deriveNftRegistryPda(PROG, MARKET))).toBe(true);
      expect(i.data[0]).toBe(tag);
    }
  });
  it("8 ClosePortfolio F-4 form: [closer (s,w), market (w), portfolio (w), owner (w)] + v18 identity", () => {
    const closer = k(), pf = k(), owner = k();
    const i = ix.buildResolvedClosePortfolioIx({ programId: PROG, closer, market: MARKET, portfolio: pf, owner, portfolioId: 7n, matcherSequence: 9n, positionEpoch: 2n });
    expect(keys(i)).toEqual([closer, MARKET, pf, owner].map((x) => x.toBase58()));
    expect(flags(i)).toBe("sw -w -w -w");
    expect(Buffer.from(i.data).toString("hex")).toBe(Buffer.from(ix.encodeClosePortfolio(7n, 9n, 2n)).toString("hex"));
  });
  it("78 LpVaultCrankFees: base 6 + bound tail [6] only (need_lp = false)", () => {
    const c = k();
    const unbound = ix.buildLpVaultCrankFeesIx({ programId: PROG, cranker: c, market: MARKET, registry: m.registry, ledger: m.ledger, siblingLedger: m.siblingLedger, domain: 0, bound: null });
    expect(unbound.keys).toHaveLength(6);
    const bound = ix.buildLpVaultCrankFeesIx({ programId: PROG, cranker: c, market: MARKET, registry: m.registry, ledger: m.ledger, siblingLedger: m.siblingLedger, domain: 0, bound: { vaultLpState: m.vaultLpState } });
    expect(bound.keys).toHaveLength(7);
    expect(bound.keys[C.BOUND_TAIL_INDEX[78]]).toEqual({ pubkey: m.vaultLpState, isSigner: false, isWritable: true });
    expect(flags(bound)).toBe("sw -w -w -w -w -- -w");
  });
  it("withBoundVaultLpTail refuses a base list that would put the tail at the wrong index, and a 75/77 tail without the LP", () => {
    const base = Array.from({ length: 10 }, () => ({ pubkey: k(), isSigner: false, isWritable: false }));
    expect(() => ix.withBoundVaultLpTail(75, base, m.vaultLpState, m.lpPortfolio)).toThrow(/\[11\]/);
    const eleven = [...base, { pubkey: k(), isSigner: false, isWritable: true }];
    expect(() => ix.withBoundVaultLpTail(75, eleven, m.vaultLpState)).toThrow(/vault LP portfolio/);
    const t = ix.withBoundVaultLpTail(75, eleven, m.vaultLpState, m.lpPortfolio);
    expect(t[11]).toEqual({ pubkey: m.vaultLpState, isSigner: false, isWritable: true });
    // d119eebd senior draw: the vault LP is WRITABLE on 75/77 (the instruction runs the draw).
    expect(t[12]).toEqual({ pubkey: m.lpPortfolio, isSigner: false, isWritable: true });
  });
});

const ctx = (o: Partial<EarnP3Context> = {}): EarnP3Context => ({
  bound: true,
  vaultLpState: m.vaultLpState,
  lpPortfolio: m.lpPortfolio,
  harvestable: 0n,
  registryShares: 1_000n,
  mode: C.MARKET_MODE_LIVE,
  ...o,
});

describe("earnTxPlan (P3-K1 / P3-L1 / bound flag / resolved harvest lock)", () => {
  it("unbound or unreadable registry => legacy shape (no tail)", () => {
    for (const bound of [false, null] as const) {
      expect(earnTxPlan(75, ctx({ bound }))).toEqual({ ok: true, tail: null, prependHarvest: false });
      expect(earnTxPlan(77, ctx({ bound }))).toEqual({ ok: true, tail: null, prependHarvest: false });
    }
  });
  it("registry flag 2+ => refused before signing", () => {
    expect(earnTxPlan(75, ctx({ bound: "invalid" }))).toEqual({ ok: false, reason: "registry-invalid" });
  });
  it("bound but the vault-LP state is unreadable => refused (never priced off backing alone)", () => {
    expect(earnTxPlan(77, ctx({ lpPortfolio: null }))).toEqual({ ok: false, reason: "vault-lp-unreadable" });
  });
  it("76 never takes a tail", () => {
    expect(earnTxPlan(76, ctx())).toEqual({ ok: true, tail: null, prependHarvest: false });
  });
  it("77 bound: tail always; 78 prepended iff fees are harvestable (K1)", () => {
    expect(earnTxPlan(77, ctx())).toMatchObject({ ok: true, prependHarvest: false });
    expect(earnTxPlan(77, ctx({ harvestable: 1n }))).toMatchObject({ ok: true, prependHarvest: true });
  });
  it("77 bound in RESOLVED mode with fees pending => 78 prepended (07a1d0eb: 78 runs once terminal-flat)", () => {
    expect(earnTxPlan(77, ctx({ harvestable: 5n, mode: C.MARKET_MODE_RESOLVED }))).toMatchObject({ ok: true, prependHarvest: true });
    expect(earnTxPlan(77, ctx({ harvestable: 0n, mode: C.MARKET_MODE_RESOLVED }))).toMatchObject({ ok: true, prependHarvest: false });
  });
  it("75 bound: 78 prepended only at GENESIS with fees pending (L1)", () => {
    expect(earnTxPlan(75, ctx({ harvestable: 9n, registryShares: 0n }))).toMatchObject({ ok: true, prependHarvest: true });
    expect(earnTxPlan(75, ctx({ harvestable: 9n, registryShares: 5n }))).toMatchObject({ ok: true, prependHarvest: false });
    expect(earnTxPlan(75, ctx({ harvestable: 0n, registryShares: 0n }))).toMatchObject({ ok: true, prependHarvest: false });
  });
});

describe("Earn assembly (shared by useInsuranceLP and the sim bridge)", () => {
  const u = k();
  const common = { programId: PROG, market: MARKET, registry: m.registry, lpMint: k(), vaultToken: k(), ledger: m.ledger, siblingLedger: m.siblingLedger, domain: 0 };
  it("deposit: [78, 75] with the tail at [11]/[12] when bound + genesis + fees", () => {
    const plan = earnTxPlan(75, ctx({ harvestable: 3n, registryShares: 0n }));
    if (!plan.ok) throw new Error("plan");
    const ixs = buildEarnDepositIxs({ ...common, depositor: u, depositorLpAta: k(), sourceToken: k(), amount: 10n, plan });
    expect(ixs.map((i) => i.data[0])).toEqual([C.TAG_LP_VAULT_CRANK_FEES, C.TAG_DEPOSIT_TO_LP_VAULT]);
    expect(ixs[1].keys).toHaveLength(13);
    expect(ixs[1].keys[11].pubkey.equals(m.vaultLpState)).toBe(true);
    expect(ixs[1].keys[12].pubkey.equals(m.lpPortfolio)).toBe(true);
  });
  it("execute: 13 base accounts ([12] = the redeemer as rent dest) + tail [13]/[14]; 78 first when fees pend", () => {
    const plan = earnTxPlan(77, ctx({ harvestable: 3n }));
    if (!plan.ok) throw new Error("plan");
    const ixs = buildEarnExecuteIxs({ ...common, redeemer: u, redemption: k(), escrow: k(), vaultAuthority: k(), redeemerDest: k(), plan });
    expect(ixs.map((i) => i.data[0])).toEqual([C.TAG_LP_VAULT_CRANK_FEES, C.TAG_EXECUTE_REDEMPTION]);
    const e = ixs[1];
    expect(e.keys).toHaveLength(15);
    expect(e.keys[12]).toEqual({ pubkey: u, isSigner: false, isWritable: true });
    expect(e.keys[13].pubkey.equals(m.vaultLpState)).toBe(true);
    expect(e.keys[14].pubkey.equals(m.lpPortfolio)).toBe(true);
  });
  it("unbound: byte-identical legacy instructions (11 / 13 accounts, no 78)", () => {
    const plan = earnTxPlan(77, ctx({ bound: false }));
    if (!plan.ok) throw new Error("plan");
    const ixs = buildEarnExecuteIxs({ ...common, redeemer: u, redemption: k(), escrow: k(), vaultAuthority: k(), redeemerDest: k(), plan });
    expect(ixs).toHaveLength(1);
    expect(ixs[0].keys).toHaveLength(13);
  });

  // Devnet SI 2026-10-01: a 77 priced on both pots (1,600,024,005 + 1,000,000,000) but drawn from
  // pot 0 refused Custom 25 pre-sign. 91 moving 999,998,998 first passed; 999,998,997 still refused.
  it("unbound 77 larger than its own pot: 91 moves exactly the shortfall from the sibling first", () => {
    expect(unboundPotShortfall({ shares: 2_599_991_798n, totalShares: 2_599_992_799n, own: 1_600_024_005n, sibling: 1_000_000_000n })).toBe(999_998_998n);
    const plan = earnTxPlan(77, ctx({ bound: false }));
    if (!plan.ok) throw new Error("plan");
    const ixs = buildEarnExecuteIxs({ ...common, redeemer: u, redemption: k(), escrow: k(), vaultAuthority: k(), redeemerDest: k(), plan, rebalanceAtoms: 999_998_998n });
    expect(ixs.map((i) => i.data[0])).toEqual([91, C.TAG_EXECUTE_REDEMPTION]);
    const r = ixs[0];
    expect(keys(r)).toEqual([u, MARKET, m.registry, m.siblingLedger, m.ledger, SystemProgram.programId].map((x) => x.toBase58()));
    expect(flags(r)).toBe("sw -w -- -w -w --");
    // [91, from u16 LE, to u16 LE, amount u128 LE]: sibling (1) -> own (0).
    expect([...r.data.slice(0, 5)]).toEqual([91, 1, 0, 0, 0]);
    expect(new DataView(r.data.buffer, r.data.byteOffset + 5, 8).getBigUint64(0, true)).toBe(999_998_998n);
    expect(ixs[1].keys).toHaveLength(13);
  });
  it("shortfall: 0 when the own pot covers the claim; capped at what the sibling holds", () => {
    expect(unboundPotShortfall({ shares: 100n, totalShares: 1000n, own: 900n, sibling: 100n })).toBe(0n);
    expect(unboundPotShortfall({ shares: 1000n, totalShares: 1000n, own: 0n, sibling: 50n })).toBe(50n);
    expect(unboundPotShortfall({ shares: 1n, totalShares: 0n, own: 0n, sibling: 50n })).toBe(0n);
  });
  it("ledgerPrincipalAtoms reads total_principal (u128 at 80); 0 for a missing or short account", () => {
    const d = new Uint8Array(240);
    new DataView(d.buffer).setBigUint64(80, 1_600_024_005n, true);
    new DataView(d.buffer).setBigUint64(88, 1n, true);
    expect(ledgerPrincipalAtoms(d)).toBe(1_600_024_005n + (1n << 64n));
    expect(ledgerPrincipalAtoms(null)).toBe(0n);
    expect(ledgerPrincipalAtoms(new Uint8Array(90))).toBe(0n);
  });
  describe("sendWithRebalanceOn25: a 91 only after the bare 77 refused 25", () => {
    const refusal25 = new Error("25"), refusal21 = new Error("21"), walletNo = new Error("user rejected");
    const run = (o: { fail?: (atoms: bigint) => Error | null; read?: () => Promise<bigint[]> }) => {
      const sent: bigint[] = [];
      let reads = 0;
      const p = sendWithRebalanceOn25({
        send: async (atoms) => { sent.push(atoms); const e = o.fail?.(atoms); if (e) throw e; return "sig"; },
        readAmounts: async () => { reads++; return o.read ? o.read() : [902_581_528n, 926_011_522n, 899_978_196n]; },
        isPotShortfallRefusal: (e) => e === refusal25,
        isPreSignRefusal: (e) => e === refusal25 || e === refusal21,
      });
      return { p, sent, reads: () => reads };
    };
    it("passes alone: no read, no 91", async () => {
      const r = run({});
      await expect(r.p).resolves.toBe("sig");
      expect(r.sent).toEqual([0n]);
      expect(r.reads()).toBe(0);
    });
    it("25 alone: the first amount that passes the pre-sign check is sent", async () => {
      const r = run({ fail: (a) => (a === 0n ? refusal25 : null) });
      await expect(r.p).resolves.toBe("sig");
      expect(r.sent).toEqual([0n, 902_581_528n]);
    });
    it("walks down the ladder past refusals (the 91 refused 21, or the 77 still 25)", async () => {
      const r = run({ fail: (a) => (a === 0n || a === 902_581_528n ? refusal25 : a === 926_011_522n ? refusal21 : null) });
      await expect(r.p).resolves.toBe("sig");
      expect(r.sent).toEqual([0n, 902_581_528n, 926_011_522n, 899_978_196n]);
    });
    it("a non-refusal (wallet declined) stops the ladder", async () => {
      const r = run({ fail: (a) => (a === 0n ? refusal25 : walletNo) });
      await expect(r.p).rejects.toBe(walletNo);
      expect(r.sent).toEqual([0n, 902_581_528n]);
    });
    it("any other first refusal: thrown, no read", async () => {
      const r = run({ fail: () => refusal21 });
      await expect(r.p).rejects.toBe(refusal21);
      expect(r.reads()).toBe(0);
    });
    it("25 with a failed read, no amounts, or none passing: the original 25", async () => {
      const a = run({ fail: () => refusal25, read: () => Promise.reject(new Error("rpc")) });
      await expect(a.p).rejects.toBe(refusal25);
      expect(a.sent).toEqual([0n]);
      const b = run({ fail: () => refusal25, read: async () => [] });
      await expect(b.p).rejects.toBe(refusal25);
      const c = run({ fail: (x) => (x === 0n ? refusal25 : refusal21) });
      await expect(c.p).rejects.toBe(refusal25);
      expect(c.sent).toHaveLength(4);
    });
  });
  // Devnet SI 2026-10-01 11:20Z: need 899,978,196 on pots 1,703,354,433 + 1,000,000,000; the real
  // boundary was 900,001,994, so the bare estimate refused 25 and the first rung must clear it.
  it("rebalanceLadder: need + 0.1% / + 1% of the payout, then need; capped at the sibling", () => {
    const l = rebalanceLadder(899_978_196n, 1_703_354_433n, 1_000_000_000n);
    expect(l).toEqual([902_581_528n, 926_011_522n, 899_978_196n]);
    expect(l[0]).toBeGreaterThanOrEqual(900_001_994n);
    expect(rebalanceLadder(990_000_000n, 1_600_000_000n, 1_000_000_000n)).toEqual([992_590_000n, 1_000_000_000n, 990_000_000n]);
    expect(rebalanceLadder(0n, 1n, 1n)).toEqual([]);
  });
  it("a bound vault never takes a 91 (the program tops its pot up inside the 77)", () => {
    const plan = earnTxPlan(77, ctx({}));
    if (!plan.ok) throw new Error("plan");
    expect(() => buildEarnExecuteIxs({ ...common, redeemer: u, redemption: k(), escrow: k(), vaultAuthority: k(), redeemerDest: k(), plan, rebalanceAtoms: 1n })).toThrow();
  });
});
