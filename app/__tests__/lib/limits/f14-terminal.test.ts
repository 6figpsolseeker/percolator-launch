// @vitest-environment node
/**
 * Next P3 FINAL (WIP 31efd250, F-14): 101 moves no SPL; after terminal-flat 78 harvests fees AND
 * absorbs the claim-free residual; seniors redeem (77 refuses 84 until 78 ran); the junior exits
 * last via 102 (Resolved: physical - C). Fixture regeneration waits for the FINAL sha; the 102
 * bytes are pinned to SDK 8's Rust-verified vector meanwhile.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { Keypair } from "@solana/web3.js";
import * as C from "@/lib/limits/constants";
import { decodeResolvedMarket, decodeTerminalBacking } from "@/lib/limits/decode";
import { planResolvedExit } from "@/lib/limits/resolved-exit";
import { earnTxPlan } from "@/lib/limits/earn-ixs";
import { buildVaultLpReleaseSurplusIx, encodeVaultLpReleaseSurplus } from "@/lib/limits/p3-ix";
import { juniorResolvedSurplusAtoms } from "@/lib/limits/vault-tranche";

const k = () => Keypair.generate().publicKey;
function market(o: { vault: bigint; cTot?: bigint; insurance?: bigint; earnings?: bigint; fresh?: bigint; buckets?: [bigint, bigint]; mode?: number; count?: bigint }): Uint8Array {
  const d = new Uint8Array(C.assetEngineOff(1) + 1301);
  const v = new DataView(d.buffer);
  v.setBigUint64(0, C.WRAPPER_MAGIC, true);
  v.setUint16(8, C.WRAPPER_VERSION_V18, true);
  d[10] = C.KIND_MARKET_ACCOUNT;
  const g = C.MARKET_GROUP_OFF;
  const put = (off: number, x: bigint) => { v.setBigUint64(off, x & ((1n << 64n) - 1n), true); v.setBigUint64(off + 8, x >> 64n, true); };
  d[g + C.H_MODE] = o.mode ?? 1;
  put(g + C.H_VAULT, o.vault);
  put(g + C.H_C_TOT, o.cTot ?? 0n);
  put(g + C.H_INSURANCE, o.insurance ?? 0n);
  put(g + C.H_BACKING_PROVIDER_EARNINGS_TOTAL, o.earnings ?? 0n);
  put(g + C.H_SOURCE_FRESH_BACKING_TOTAL_NUM, (o.fresh ?? 0n) * C.BOUND_SCALE);
  v.setBigUint64(g + C.H_MATERIALIZED_PORTFOLIO_COUNT, o.count ?? 0n, true);
  const [bl, bs] = o.buckets ?? [0n, 0n];
  put(C.assetEngineOff(0) + C.SLOT_BACKING_LONG + C.BUCKET_FRESH_UNLIENED_BACKING_NUM, bl * C.BOUND_SCALE + 7n); // +7: floored away
  put(C.assetEngineOff(0) + C.SLOT_BACKING_SHORT + C.BUCKET_FRESH_UNLIENED_BACKING_NUM, bs * C.BOUND_SCALE);
  return d;
}

describe("decodeTerminalBacking (wrapper vault_terminal_residual_atoms / vault_physical_idle_backing_atoms)", () => {
  it("residual = vault - (c_tot + insurance + provider earnings + fresh/BOUND), saturating; physical = both pots floored", () => {
    const d = market({ vault: 1_000n, cTot: 0n, insurance: 100n, earnings: 50n, fresh: 700n, buckets: [400n, 300n] });
    expect(decodeTerminalBacking(d, 0)).toEqual({ residual: 150n, physical: 700n });
    expect(decodeTerminalBacking(d, 1)).toEqual({ residual: 150n, physical: 700n }); // own + sibling = same pair
    expect(decodeTerminalBacking(market({ vault: 10n, insurance: 100n }), 0)!.residual).toBe(0n);
  });
});

describe("resolved sweep: 78 when fees OR residual are pending at terminal-flat", () => {
  const m = decodeResolvedMarket(market({ vault: 1n }))!;
  const base = { market: m, nowSlot: 1n, portfolios: [], boundVault: true, harvestableAtoms: 0n };
  it("residual only => harvest step", () => {
    expect(planResolvedExit({ ...base, terminalResidualAtoms: 5n })).toEqual({ phase: "sweep", steps: [{ kind: "harvest" }], blockers: [] });
  });
  it("neither => ready (a 78 with nothing to do fails NoFeesToCrank)", () => {
    expect(planResolvedExit({ ...base, terminalResidualAtoms: 0n })).toEqual({ phase: "ready", blockers: [] });
  });
});

describe("senior redemption bundles 78 on a residual at terminal-flat", () => {
  const ctx = { bound: true as const, vaultLpState: k(), lpPortfolio: k(), harvestable: 0n, registryShares: 5n, mode: C.MARKET_MODE_RESOLVED };
  it("terminal-flat + residual => 78 first; not terminal-flat => no", () => {
    expect(earnTxPlan(77, { ...ctx, terminalFlat: true, terminalResidual: 3n })).toMatchObject({ ok: true, prependHarvest: true });
    expect(earnTxPlan(77, { ...ctx, terminalFlat: false, terminalResidual: 3n })).toMatchObject({ ok: true, prependHarvest: false });
    expect(earnTxPlan(77, { ...ctx, terminalFlat: true, terminalResidual: 0n })).toMatchObject({ ok: true, prependHarvest: false });
  });
});

describe("junior terminal exit (102)", () => {
  const sdk = JSON.parse(readFileSync(join(__dirname, "../../fixtures/limits/sdk-p3-parity.json"), "utf8")) as { vectors: Record<string, { hex: string; rust: { ok: boolean } }> };
  it("data = SDK 8's Rust-decoded vector [102, amount u128, source_domain u16]", () => {
    expect(sdk.vectors.releaseSurplus.rust.ok).toBe(true);
    expect(Buffer.from(encodeVaultLpReleaseSurplus(99n, 48_879)).toString("hex")).toBe(sdk.vectors.releaseSurplus.hex);
  });
  it("accounts: live 7, resolved + [7] dest (w) [8] vault token (w) [9] vault authority [10] token program", () => {
    const m = { programId: k(), market: k(), registry: k(), vaultLpState: k(), lpPortfolio: k(), ledger: k(), siblingLedger: k() };
    const o = k();
    expect(buildVaultLpReleaseSurplusIx(m, o, 1n, 0, null).keys).toHaveLength(7);
    const dest = k(), vt = k(), va = k();
    const r = buildVaultLpReleaseSurplusIx(m, o, 1n, 0, { destToken: dest, vaultToken: vt, vaultAuthority: va });
    expect(r.keys).toHaveLength(11);
    expect(r.keys[0]).toEqual({ pubkey: o, isSigner: true, isWritable: false });
    expect(r.keys[7]).toEqual({ pubkey: dest, isSigner: false, isWritable: true });
    expect(r.keys[8]).toEqual({ pubkey: vt, isSigner: false, isWritable: true });
    expect(r.keys[9]).toEqual({ pubkey: va, isSigner: false, isWritable: false });
  });
  it("surplus = physical - C, never negative (seniors first)", () => {
    expect(juniorResolvedSurplusAtoms(700n, 500n)).toBe(200n);
    expect(juniorResolvedSurplusAtoms(400n, 500n)).toBe(0n);
  });
});
