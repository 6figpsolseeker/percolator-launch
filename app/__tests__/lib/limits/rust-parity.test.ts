// @vitest-environment node
/**
 * Rust parity: every vector in fixtures/limits/rust-parity-vectors.json was
 * emitted by the REAL Rust function (scripts/limits-parity/main.rs):
 *   - P1 `risk_limits_v17` extracted verbatim from feat/p1-safety-release@99165722 (F-7: no taker-close exemption in lp_fill_gate);
 *   - P2 `percolator_match::v2` from feat/p2-matcher-v2@4a0f696 (crate path dep);
 *   - P3 `vault_lp_v18.rs` from feat/p3-vault-owned-lp@424fe7e4 (byte-identical to 0be66041/8dffb534).
 * The TS ports must agree on every one.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  effectiveExecBandBps,
  effectiveLpExposureKBps,
  execPriceWithinBand,
  flooredLpReducingRoomQ,
  lpExposureCapQ,
  lpFillHeadroomQ,
  lpFloorHalts,
  sideOiGrowthAllowed,
  positionChangeReduceOnly,
  flooredLpMoveAllowed,
  lpFillGate,
  exposureWithinCapFast,
} from "@/lib/limits/risk-limits";
import { requestedFeeBps, requestedFeePermitted } from "@/lib/limits/fee-channel";
import { adaptiveFeeBps, cpImpactBps, quoteAdaptive, skewNetBps } from "@/lib/limits/matcher-quote";
import {
  juniorWithdrawAllowed,
  leverageGateOk,
  seniorAtomsForRedemption,
  seniorSharesForDeposit,
  skewFundingRateE9,
  stepImrBps,
  trancheSplit,
  conservativeEquity,
  vaultLpExposureAllowed,
} from "@/lib/limits/vault-tranche";
import type { V2BlockView } from "@/lib/limits/decode";

type V = Record<string, unknown> & { f: string };
const vectors: V[] = JSON.parse(
  readFileSync(join(__dirname, "..", "..", "fixtures", "limits", "rust-parity-vectors.json"), "utf8"),
);
const B = (x: unknown): bigint => BigInt(x as string);
const N = (x: unknown): number => Number(x);
const opt = (x: bigint | null): string | null => (x === null ? null : x.toString());

const v2 = (v: V): V2BlockView => ({
  flags: 0,
  feeLoBps: N(v.lo),
  feeHiBps: N(v.hi),
  feeColdBps: N(v.cold),
  volAMilli: N(v.a),
  volBDen: N(v.bden),
  volAlphaBps: 1000,
  volWarmupLeft: N(v.warm),
  volMoveCap10bps: 100,
  volRefSlots: 25,
  thinRebateMultBps: 0,
  skewCapBps: 0,
  rebateCapBps: 0,
  maxMarkAgeSlots: 0,
  observedStaleSlots: 0,
  boundAssetPlus1: 0,
  skewRefInventory: 0n,
  volVarE4: B(v.var),
  volLastPriceE6: 0n,
  volLastSlot: 0n,
});

/** One evaluator per Rust fn; returns the TS result in the JSON's `out` shape. */
export const EVAL: Record<string, (v: V) => unknown> = {
  lp_exposure_cap_q: (v) => lpExposureCapQ(B(v.eq), N(v.k), B(v.price)).toString(),
  lp_fill_headroom_q: (v) => lpFillHeadroomQ(B(v.before), N(v.sign) as 1 | -1, B(v.cap)).toString(),
  floored_lp_reducing_room_q: (v) => flooredLpReducingRoomQ(B(v.before), N(v.sign) as 1 | -1).toString(),
  exec_price_within_band: (v) => execPriceWithinBand(B(v.exec), B(v.ref), N(v.band)),
  effective_exec_band_bps: (v) => effectiveExecBandBps(N(v.stored)),
  effective_lp_exposure_k_bps: (v) => effectiveLpExposureKBps(N(v.stored), B(v.imr)),
  lp_floor_halts: (v) => lpFloorHalts(B(v.eq), B(v.floor), v.ri as boolean),
  side_oi_growth_allowed: (v) => sideOiGrowthAllowed(B(v.before), B(v.after), B(v.cap)),
  adaptive_fee_bps: (v) => adaptiveFeeBps(v2(v)).toString(),
  cp_impact_bps: (v) => opt(cpImpactBps(B(v.n), B(v.d), N(v.k))),
  skew_net_bps: (v) =>
    opt(skewNetBps(B(v.inv), B(v.fill), v.sells as boolean, N(v.sm), N(v.rm), N(v.sc), N(v.rc), B(v.ref))),
  quote_adaptive: (v) => {
    const q = quoteAdaptive({
      oracleE6: B(v.oracle),
      fill: B(v.fill),
      takerBuys: v.buys as boolean,
      invPre: B(v.inv),
      baseSpreadBps: N(v.base),
      maxTotalBps: N(v.maxt),
      feeBps: B(v.fee),
      impactKBps: N(v.k),
      depthE6: B(v.depth),
      sMultBps: N(v.sm),
      rMultBps: N(v.rm),
      skewCapBps: N(v.sc),
      rebateCapBps: N(v.rc),
      refInv: B(v.ref),
    });
    return q === null ? null : [q.fill.toString(), q.priceE6.toString(), q.totalBps.toString()];
  },
  tranche_split: (v) => {
    const s = trancheSplit(B(v.v), B(v.c));
    return [s.senior.toString(), s.junior.toString()];
  },
  senior_shares_for_deposit: (v) => opt(seniorSharesForDeposit(B(v.amt), B(v.s), B(v.sv))),
  senior_atoms_for_redemption: (v) => opt(seniorAtomsForRedemption(B(v.sh), B(v.s), B(v.sv))),
  junior_withdraw_allowed: (v) => juniorWithdrawAllowed(B(v.v), B(v.c), B(v.bc), B(v.amt), N(v.fb)),
  skew_funding_rate_e9: (v) => skewFundingRateE9(B(v.lp), B(v.oi), B(v.sl), B(v.mx)).toString(),
  step_imr_bps: (v) => stepImrBps(B(v.la), B(v.cap), B(v.base), N(v.mi)).toString(),
  leverage_gate_ok: (v) => leverageGateOk(B(v.e), B(v.n), B(v.imr)),
  position_change_reduce_only: (v) => positionChangeReduceOnly(B(v.b), B(v.a)),
  floored_lp_move_allowed: (v) => flooredLpMoveAllowed(B(v.b), B(v.a)),
  lp_fill_gate: (v) => lpFillGate(B(v.cb), B(v.ca), B(v.lb), B(v.la), B(v.cap), v.fl as boolean),
  requested_fee_permitted: (v) => requestedFeePermitted(B(v.req), B(v.base), B(v.signed), N(v.pm), B(v.mm)),
  requested_fee_bps: (v) => Number(requestedFeeBps(B(v.o), B(v.ex))),
  conservative_equity: (v) => opt(conservativeEquity(B(v.c), B(v.p), B(v.fc))),
  vault_lp_exposure_allowed: (v) => vaultLpExposureAllowed(B(v.lb), B(v.la), B(v.eq), N(v.lev), B(v.pr)),
  exposure_within_cap_fast: (v) => exposureWithinCapFast(B(v.a), B(v.eq), N(v.k), B(v.pr)),
};

describe("limits: TS ports agree with the Rust functions on every emitted vector", () => {
  it("fixture covers every ported function", () => {
    const seen = new Set(vectors.map((v) => v.f));
    for (const f of Object.keys(EVAL)) expect(seen.has(f), f).toBe(true);
    expect(vectors.length).toBeGreaterThan(10_000);
  });

  for (const f of Object.keys(EVAL)) {
    it(`parity: ${f}`, () => {
      const rows = vectors.filter((v) => v.f === f);
      const bad: string[] = [];
      for (const v of rows) {
        const got = EVAL[f](v);
        if (JSON.stringify(got) !== JSON.stringify(v.out)) bad.push(`${JSON.stringify(v)} => ${JSON.stringify(got)}`);
      }
      expect(bad.slice(0, 3)).toEqual([]);
      expect(rows.length).toBeGreaterThan(0);
    });
  }
});
