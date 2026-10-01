// @vitest-environment node
/**
 * F-3 / R1: the ADL reduce-only state (engine 35ddd692 v16.rs:15883) and the owner-signed
 * unilateral exit (wrapper tag 44 RebalanceReduce, deployed 6377376a).
 *   - offsets + ADL_ONE: rustc offset_of! on the deployed tree (rust-nav-offsets.json);
 *   - real bytes: every captured v18 market reads A = ADL_ONE exactly; a v17 slab is refused;
 *   - tag 44 bytes: equal the DEPLOYED wrapper's own encoder and round-trip its decode arm
 *     (rust-tag44-vectors.json, scripts/limits-parity/nav-offsets/tag44.rs).
 */
import { describe, it, expect, vi } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { Keypair } from "@solana/web3.js";
import { encodeRebalanceReduce } from "@percolatorct/sdk";
import * as C from "@/lib/limits/constants";
import { decodeMarketEngineView } from "@/lib/limits/decode";
import {
  buildRebalanceReduceIx,
  closeRouteFor,
  encodeRebalanceReduceData,
  isAdlReduceOnly,
  rebalanceReduceQ,
} from "@/lib/limits/adl-reduce-only";
import { buildRebalanceCloseIxs } from "@/lib/limits/rebalance-ixs";
import { isReduceOnlyLock21, isWrapperLock21 } from "@/lib/limits/reduce-only-fallback";
import { decodeMarketHealth, healthBadges } from "@/lib/market-health";
import { explainMarketTxError, MSG_ADL_REDUCE_ONLY_CLOSE, MSG_ADL_REDUCE_ONLY_OPEN } from "@/lib/market-error";
import { resolveDevnetProgramIds } from "@/lib/program-ids";

const FX = join(__dirname, "..", "..", "fixtures");
const nav = JSON.parse(readFileSync(join(FX, "limits", "rust-nav-offsets.json"), "utf8")) as Record<string, number | string>;
const tag44 = JSON.parse(readFileSync(join(FX, "limits", "rust-tag44-vectors.json"), "utf8")) as {
  pid: string;
  pep: string;
  asset: number;
  q: string;
  hex: string;
}[];
const pengu = () =>
  new Uint8Array(Buffer.from(readFileSync(join(FX, "v18-liveness", "pengu-market-v18-healthy.b64"), "utf8").trim(), "base64"));
const withA = (d: Uint8Array, aLong: bigint, aShort: bigint) => {
  const out = d.slice();
  const v = new DataView(out.buffer);
  const e = C.assetEngineOff(0);
  for (const [off, val] of [[C.A_A_LONG, aLong], [C.A_A_SHORT, aShort]] as const) {
    v.setBigUint64(e + off, val & 0xffff_ffff_ffff_ffffn, true);
    v.setBigUint64(e + off + 8, val >> 64n, true);
  }
  return out;
};
const { wrapper: W } = resolveDevnetProgramIds();

describe("ADL factors: offsets + ADL_ONE from rustc", () => {
  it("a_long @49, a_short @65, ADL_ONE = 1e15", () => {
    expect(C.A_A_LONG).toBe(nav["asset.a_long"]);
    expect(C.A_A_SHORT).toBe(nav["asset.a_short"]);
    expect(C.ADL_ONE.toString()).toBe(nav["adl_one"]);
  });
});

describe("real market bytes", () => {
  it("every captured v18 market reads A = ADL_ONE on both sides (not reduce-only)", () => {
    const files = readdirSync(FX).filter((f) => f.endsWith(".market.json"));
    let v18 = 0;
    for (const f of files) {
      const d = new Uint8Array(Buffer.from(JSON.parse(readFileSync(join(FX, f), "utf8")).dataBase64, "base64"));
      const e = decodeMarketEngineView(d);
      if (!e) continue; // non-v18 (v17 slab) => refused
      v18++;
      expect([e.aLong, e.aShort], f).toEqual([C.ADL_ONE, C.ADL_ONE]);
      expect(isAdlReduceOnly(e), f).toBe(false);
    }
    expect(v18).toBeGreaterThanOrEqual(8);
  });
  it("a v17 slab (version 17) is refused, never read as A = 0 (false reduce-only)", () => {
    const d = new Uint8Array(Buffer.from(JSON.parse(readFileSync(join(FX, "BPgSUbDs.market.json"), "utf8")).dataBase64, "base64"));
    expect(decodeMarketEngineView(d)).toBeNull();
    expect(isAdlReduceOnly(decodeMarketEngineView(d))).toBe(false);
  });
  it("Sieve's F-3 state (a_short = 0.8617·ADL_ONE) => reduce-only; health lock reason + badge", () => {
    const d = withA(pengu(), C.ADL_ONE, (C.ADL_ONE * 8617n) / 10_000n);
    expect(isAdlReduceOnly(decodeMarketEngineView(d))).toBe(true);
    const h = decodeMarketHealth(d, 505580400n, 1_000_000n);
    expect(h.lockReasons).toContain("adl-reduce-only");
    expect(healthBadges(h).map((b) => b.id)).toContain("adl-reduce-only");
    // control: the untouched market has neither
    const h0 = decodeMarketHealth(pengu(), 505580400n, 1_000_000n);
    expect(h0.lockReasons).not.toContain("adl-reduce-only");
  });
  it("either side alone triggers it", () => {
    expect(isAdlReduceOnly({ aLong: C.ADL_ONE - 1n, aShort: C.ADL_ONE })).toBe(true);
    expect(isAdlReduceOnly({ aLong: C.ADL_ONE, aShort: C.ADL_ONE })).toBe(false);
  });
});

describe("tag 44 RebalanceReduce bytes == the deployed wrapper's encoder", () => {
  it(`${tag44.length} vectors, and the SDK encoder agrees`, () => {
    expect(tag44.length).toBeGreaterThan(60);
    for (const v of tag44) {
      const mine = Buffer.from(encodeRebalanceReduceData(BigInt(v.pid), BigInt(v.pep), v.asset, BigInt(v.q))).toString("hex");
      expect(mine).toBe(v.hex);
      const sdk = Buffer.from(encodeRebalanceReduce({ portfolioId: v.pid, positionEpoch: v.pep, assetIndex: v.asset, reduceQ: v.q })).toString("hex");
      expect(sdk).toBe(v.hex);
    }
  });
  it("refuses reduce_q = 0 (the handler rejects it) and out-of-range fields", () => {
    expect(() => encodeRebalanceReduceData(1n, 0n, 0, 0n)).toThrow();
    expect(() => encodeRebalanceReduceData(1n << 64n, 0n, 0, 1n)).toThrow();
    expect(() => encodeRebalanceReduceData(1n, 0n, 70_000, 1n)).toThrow();
  });
  it("accounts: [owner (signer), market (w), portfolio (w)] (with_one_portfolio_view, owner_must_sign)", () => {
    const [owner, market, portfolio, prog] = [0, 1, 2, 3].map(() => Keypair.generate().publicKey);
    const ix = buildRebalanceReduceIx({ programId: prog, owner, market, portfolio, portfolioId: 5n, positionEpoch: 2n, reduceQ: 10n });
    expect(ix.programId.equals(prog)).toBe(true);
    expect(ix.keys.map((k) => [k.pubkey.toBase58(), k.isSigner, k.isWritable])).toEqual([
      [owner.toBase58(), true, true],
      [market.toBase58(), false, true],
      [portfolio.toBase58(), false, true],
    ]);
    // the full close tx: refresh crank of the SAME portfolio first, then tag 44 (the #519 harness order)
    const ixs = buildRebalanceCloseIxs({ programId: prog, market, owner, portfolio, reduceQ: 10n, pythCrankAccount: null, portfolioId: 5n, positionEpoch: 2n });
    expect(ixs.length).toBe(2);
    expect(ixs[0].data[0]).toBe(5); // PermissionlessCrank
    expect(ixs[0].keys[2].pubkey.equals(portfolio)).toBe(true);
    expect(ixs[1].data[0]).toBe(44);
  });
});

describe("close routing", () => {
  it("reduce-only => tag 44; else the matcher", () => {
    expect(closeRouteFor(true)).toBe("rebalance-reduce");
    expect(closeRouteFor(false)).toBe("matcher");
  });
  it("reduce_q: 100% = the whole leg, partial = floor(|pos|·p/100)", () => {
    expect(rebalanceReduceQ(-16_511_677_058n, 100)).toBe(16_511_677_058n);
    expect(rebalanceReduceQ(1_000n, 25)).toBe(250n);
  });
  it("fallback: only a WRAPPER Custom(21) plus a FRESH reduce-only read", async () => {
    const reduceOnly = withA(pengu(), C.ADL_ONE, C.ADL_ONE / 2n);
    const conn = (d: Uint8Array) => ({ getAccountInfo: vi.fn(async () => ({ data: Buffer.from(d) })) });
    const wrapper21 = `Program ${W} failed: custom program error: 0x15`;
    const matcher21 = `Program ${resolveDevnetProgramIds().matcher} failed: custom program error: 0x15`;
    const pk = Keypair.generate().publicKey;
    const wPk = new (await import("@solana/web3.js")).PublicKey(W);
    expect(await isReduceOnlyLock21(wrapper21, conn(reduceOnly) as never, pk, wPk)).toBe(true);
    expect(await isReduceOnlyLock21('{"InstructionError":[3,{"Custom":21}]}', conn(reduceOnly) as never, pk, wPk)).toBe(true);
    expect(await isReduceOnlyLock21(wrapper21, conn(pengu()) as never, pk, wPk)).toBe(false);
    expect(await isReduceOnlyLock21(matcher21, conn(reduceOnly) as never, pk, wPk)).toBe(false);
    expect(await isReduceOnlyLock21(`Program ${W} failed: custom program error: 0x13`, conn(reduceOnly) as never, pk, wPk)).toBe(false);
    expect(isWrapperLock21(wrapper21, W)).toBe(true);
  });
});

describe("21 copy", () => {
  it("in the reduce-only state: opens paused, closes still work", () => {
    const d = withA(pengu(), C.ADL_ONE, C.ADL_ONE / 2n);
    const h = decodeMarketHealth(d, 505580400n, 1_000_000n);
    const row = { ...h, lpCapital: "1000000", openProfitAtoms: "0", realizableProfitAtoms: "0", badges: healthBadges(h) };
    const raw = `Program ${W} failed: custom program error: 0x15`;
    expect(explainMarketTxError(raw, "open", row as never)).toBe(MSG_ADL_REDUCE_ONLY_OPEN);
    expect(explainMarketTxError(raw, "close", row as never)).toBe(MSG_ADL_REDUCE_ONLY_CLOSE);
    expect(MSG_ADL_REDUCE_ONLY_CLOSE).toMatch(/Closing still works/);
  });
});
