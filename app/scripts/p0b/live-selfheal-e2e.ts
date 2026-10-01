/**
 * Read-only end-to-end: run the app's own planSelfHeal against LIVE devnet with
 * the exact crank instruction useTrade prepends (PermissionlessCrank tag 5 on a
 * positioned portfolio). sigVerify=false simulations only; nothing is signed.
 *   npx tsx scripts/p0b/live-selfheal-e2e.ts
 */
import { DEVNET_PROGRAM_IDS } from "../../lib/program-ids";
import { Connection, PublicKey } from "@solana/web3.js";
import { ACCOUNTS_PERMISSIONLESS_CRANK_BASE, buildAccountMetas, buildIx, encodePermissionlessCrank } from "@percolatorct/sdk";
import { defaultCrankObservations } from "../../lib/v18-wire";
import { planSelfHeal, connectionSelfHealDeps, describeRepair, buildLivenessRepairIx, computeBudgetPrefix } from "../../lib/self-heal";

const RPC = process.env.DEVNET_RPC ?? "https://api.devnet.solana.com";
const PROGRAM = new PublicKey(DEVNET_PROGRAM_IDS.wrapper);
const PAYER = new PublicKey("FbTbDeGWQpjrEqJdqoBHX3sTWHoAmU2xywD7wyxH6WC7");
const CASES = [
  { sym: "PAID-lp", market: "BPLPf1XT7HE9qKwAbf4cSqcDrV6VHJDS3FPeQ3GL7JPY", portfolio: "AZXj9a8gxzFuRYvdUxFERvvkzLMkVXPQtDn9hpFsGqp7" },
  { sym: "PAID-22hR", market: "BPLPf1XT7HE9qKwAbf4cSqcDrV6VHJDS3FPeQ3GL7JPY", portfolio: "22hRxRE653dGdWifTpjA43Yipct5xBkksmFD4HDAYTEh" },
  { sym: "PAID-3i2W", market: "BPLPf1XT7HE9qKwAbf4cSqcDrV6VHJDS3FPeQ3GL7JPY", portfolio: "3i2WWX7Z91ZVbn3ZxRr8QYa2UvKE6ZapwbEC9d5QWUZZ" },
  { sym: "PAID-4tVr", market: "BPLPf1XT7HE9qKwAbf4cSqcDrV6VHJDS3FPeQ3GL7JPY", portfolio: "4tVr9mrUc7npEJH4UhbvwPtqZ9ypN9cTFMmmxSZpJS7Q" },
  { sym: "PAID-9L8g", market: "BPLPf1XT7HE9qKwAbf4cSqcDrV6VHJDS3FPeQ3GL7JPY", portfolio: "9L8gLAxbrsTc97gmXJxwwcFiZ9MWfxQefyT1vP6hpoef" },
];
async function main() {
  const conn = new Connection(RPC, "confirmed");
  for (const c of CASES) {
    const market = new PublicKey(c.market);
    const crank = buildIx({
      programId: PROGRAM,
      keys: buildAccountMetas(ACCOUNTS_PERMISSIONLESS_CRANK_BASE, [PAYER, market, new PublicKey(c.portfolio)]),
      data: encodePermissionlessCrank({ nowSlot: 0n, observations: defaultCrankObservations(0) }),
    });
    const deps = connectionSelfHealDeps(conn, market, PAYER);
    const plain = await deps.simulate([...computeBudgetPrefix(400_000), crank]);
    console.log(`${c.sym}: user crank alone → err=${JSON.stringify(plain.err)}`);
    const r = await planSelfHeal({ programId: PROGRAM, market, instructions: [crank], computeUnits: 400_000 }, deps);
    console.log(`${c.sym}: planSelfHeal → outcome=${r.outcome} repairs=[${r.repairs.map(describeRepair).join(", ")}] ixs=${r.instructions.length} cu=${r.computeUnits}`);
    const healed = await deps.simulate([...computeBudgetPrefix(r.computeUnits), ...r.instructions]);
    console.log(`${c.sym}: healed tx → err=${JSON.stringify(healed.err)}`);
  }
  // Live NEGATIVE CONTROL: a repair the engine must refuse (SOL d0 is immortal, not lapsed).
  const sol = new PublicKey("AzagguvrWmRgcBpsKuqomW7Yb1YUUd6UzcrkiRsqdhr");
  const neg = await connectionSelfHealDeps(conn, sol, PAYER).simulate([
    ...computeBudgetPrefix(200_000), buildLivenessRepairIx(PROGRAM, sol, { kind: "expire", domain: 0 }),
  ]);
  console.log(`CONTROL SOL ExpireBackingBucket(d0) (not lapsed) → err=${JSON.stringify(neg.err)}`);
  const neg2 = await connectionSelfHealDeps(conn, sol, PAYER).simulate([
    ...computeBudgetPrefix(200_000), buildLivenessRepairIx(PROGRAM, sol, { kind: "expire", domain: 9999 }),
  ]);
  console.log(`CONTROL SOL ExpireBackingBucket(d9999) (out of range) → err=${JSON.stringify(neg2.err)}`);
}
main().catch((e) => { console.error(e); process.exit(1); });
