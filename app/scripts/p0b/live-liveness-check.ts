/**
 * Read-only: decode liveness state of devnet markets and, when repairs are
 * planned, simulate the repair instructions (sigVerify=false). Signs nothing.
 *   npx tsx scripts/p0b/live-liveness-check.ts
 */
import { DEVNET_PROGRAM_IDS } from "../../lib/program-ids";
import { Connection, PublicKey } from "@solana/web3.js";
import { decodeMarketLiveness, planLivenessRepairs, describeRepair, buildLivenessRepairIx, connectionSelfHealDeps, computeBudgetPrefix } from "../../lib/self-heal";

const RPC = process.env.DEVNET_RPC ?? "https://api.devnet.solana.com";
const PROGRAM = new PublicKey(DEVNET_PROGRAM_IDS.wrapper);
// any existing devnet system account works as a sim fee payer with sigVerify=false
const PAYER = new PublicKey(process.env.SIM_PAYER ?? "FbTbDeGWQpjrEqJdqoBHX3sTWHoAmU2xywD7wyxH6WC7");
const MARKETS: Record<string, string> = {
  SOL: "AzagguvrWmRgcBpsKuqomW7Yb1YUUd6UzcrkiRsqdhr", PAID: "BPLPf1XT7HE9qKwAbf4cSqcDrV6VHJDS3FPeQ3GL7JPY",
  CATE: "CjdnH8fTmxNMsuUevBt9VjSi87E3ESTcuWuoSrjUjvXE", COLLECT: "3t67LQPdgiSqGvXsYff3Pzv2uHtM1zZ7f29HsnEzb6vJ",
  Murphy: "7h3wNxjzPo6pTfWQ7uiTjDSsprGEeMNh696efmYrpAX2", TEXTIT: "DnFhDdWzcWkBDxN9JJcmFmtiqqKo56w9JwQEtRKNdjcG",
  ANSEM: "5bVTTMRceF9qEERjPWvqxtrDighE846QkVXSJm4uC8Tk", PENGU: "ENdXK8k6iiWCAx4Z9XfoKLg9oXsEbPL4hEtmEmUqozDZ",
};
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
async function main() {
  const conn = new Connection(RPC, "confirmed");
  for (const [sym, addr] of Object.entries(MARKETS)) {
    const market = new PublicKey(addr);
    const res = await conn.getAccountInfoAndContext(market, "confirmed");
    if (!res.value) { console.log(sym, "missing"); continue; }
    const s = decodeMarketLiveness(new Uint8Array(res.value.data), BigInt(res.context.slot));
    const repairs = planLivenessRepairs(s);
    const b = s.buckets.slice(0, 2).map((x) => `d${x.domain}:st${x.status}/exp${x.expirySlot}`).join(" ");
    const sd = s.sides.slice(0, 2).map((x) => `${x.side ? "S" : "L"}:mode${x.mode}/pos${x.storedPos}`).join(" ");
    console.log(`${sym.padEnd(8)} slot=${res.context.slot} mode=${s.mode} ${b} ${sd} → ${repairs.map(describeRepair).join(", ") || "none"}`);
    if (repairs.length) {
      const deps = connectionSelfHealDeps(conn, market, PAYER);
      const ixs = repairs.map((r) => buildLivenessRepairIx(PROGRAM, market, r));
      const sim = await deps.simulate([...computeBudgetPrefix(200_000), ...ixs]);
      console.log(`         repair-only simulation err=${JSON.stringify(sim.err)}`);
    }
    await sleep(400);
  }
}
main().catch((e) => { console.error(e); process.exit(1); });
