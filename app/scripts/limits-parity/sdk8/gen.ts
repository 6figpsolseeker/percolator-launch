// @ts-nocheck -- imports sdk8-pricing.ts, the SDK source copied in at regeneration time (see README.md)
import { writeFileSync } from "node:fs";
import { vaultLpEquityLagBoundsP3, boundVaultSeniorValueP3, boundVaultDepositQuoteP3, vaultLpSeniorPricingClaimP3 } from "./sdk8-pricing";
let s = 0x9e3779b9;
const rnd = () => { s ^= s << 13; s >>>= 0; s ^= s >>> 17; s ^= s << 5; s >>>= 0; return s; };
const pick = <T,>(a: T[]) => a[rnd() % a.length];
const big = (max: bigint) => BigInt(rnd()) * BigInt(rnd()) % (max + 1n);
const bounds: unknown[] = [], redeem: unknown[] = [], deposit: unknown[] = [], claim: unknown[] = [];
for (let i = 0; i < 400; i++) {
  const n = pick([0, 1, 1, 2, 3]);
  const legs = Array.from({ length: n }, () => {
    const eff = 1n + big(5_000_000n);
    const tgt = pick([eff, 1n + big(5_000_000n), eff + 1n, eff > 1n ? eff - 1n : eff]);
    const q = pick([1n, big(2_000_000_000n), 3n]);
    return { basisPosQ: pick([q, -q]), effectivePriceE6: eff, rawOracleTargetPriceE6: tgt };
  });
  const a = { legs, certifiedEquity: big(3_000_000_000n) - 1_000_000_000n, capital: big(2_000_000_000n), pnl: big(2_000_000_000n) - 1_000_000_000n, feeCredits: big(100_000n) - 50_000n };
  const r = vaultLpEquityLagBoundsP3(a);
  bounds.push({ ...a, legs: a.legs.map((l) => ({ basisPosQ: String(l.basisPosQ), eff: String(l.effectivePriceE6), tgt: String(l.rawOracleTargetPriceE6) })), certifiedEquity: String(a.certifiedEquity), capital: String(a.capital), pnl: String(a.pnl), feeCredits: String(a.feeCredits), worse: String(r.worse), better: String(r.better) });
}
for (let i = 0; i < 400; i++) {
  const c = big(10_000_000_000n), nav = pick([c, big(12_000_000_000n), c + big(1_000_000n)]), lpValue = big(2_000_000_000n), worse = big(3_000_000_000n) - 1_500_000_000n;
  redeem.push({ c: String(c), nav: String(nav), lpValue: String(lpValue), worse: String(worse), senior: String(boundVaultSeniorValueP3({ nav, seniorClaim: c, lpValue, resolved: false, physicalIdleBacking: 0n, lpEquityWorse: worse })) });
  const out = pick([0n, big(1_000_000_000n)]), better = big(3_000_000_000n) - 1_000_000_000n;
  const q = boundVaultDepositQuoteP3({ amount: 1_000_000n, totalShares: 1_000_000_000n, seniorClaim: c, harvestable: 0n, seniorFeeShareBps: 10_000, nav, lpValue: 10n ** 13n, seniorDrawOutstandingAtoms: out, lpEquityBetter: better });
  if (q.ok) deposit.push({ cEff: String(c), nav: String(nav), outstanding: String(out), better: String(better), claim: String(q.cEff), shares: String(q.shares) });
  const d = big(2_000_000_000n), sur = big(1_000_000_000n);
  claim.push({ c: String(c), undrawn: String(d), surplus: String(sur), out: String(vaultLpSeniorPricingClaimP3(c, d, sur)) });
}
writeFileSync(process.argv[2], JSON.stringify({ sdk: "@percolatorct/sdk 8.0.0 52b7412 (src/solana/p3-vault-lp.ts, verbatim)", bounds, redeem, deposit, claim }, null, 1));
console.log(bounds.length, redeem.length, deposit.length, claim.length);
