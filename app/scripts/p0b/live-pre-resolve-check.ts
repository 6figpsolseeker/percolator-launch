/** Read-only: run the app's pre-resolve gate on live devnet markets; simulate planned cranks (sigVerify=false). */
import { DEVNET_PROGRAM_IDS } from "../../lib/program-ids";
import { Connection, PublicKey } from "@solana/web3.js";
import { readAndPlanPreResolve } from "../../lib/pre-resolve";
import { connectionSelfHealDeps, computeBudgetPrefix } from "../../lib/self-heal";
const conn = new Connection(process.env.DEVNET_RPC ?? "https://api.devnet.solana.com", "confirmed");
const W = new PublicKey(DEVNET_PROGRAM_IDS.wrapper);
const S = new PublicKey(DEVNET_PROGRAM_IDS.stake);
const PAYER = new PublicKey("FbTbDeGWQpjrEqJdqoBHX3sTWHoAmU2xywD7wyxH6WC7");
const M: Record<string, string> = {
  TEXTIT: "DnFhDdWzcWkBDxN9JJcmFmtiqqKo56w9JwQEtRKNdjcG", Murphy: "7h3wNxjzPo6pTfWQ7uiTjDSsprGEeMNh696efmYrpAX2",
  JTO: "EzsAsNwuwrXqJdE1JHJhqBzsWE8YVZg4645pKjCFrbWz", SOL: "AzagguvrWmRgcBpsKuqomW7Yb1YUUd6UzcrkiRsqdhr",
  SOLCAT: "7mgX3bkzEivRrCffCJ7XzqfAp3gpjm63RNinwDhr7b41", ANSEM: "5bVTTMRceF9qEERjPWvqxtrDighE846QkVXSJm4uC8Tk",
};
(async () => {
  for (const [sym, a] of Object.entries(M)) {
    const market = new PublicKey(a);
    const info = await conn.getAccountInfo(market, "confirmed");
    if (!info) { console.log(sym, "missing"); continue; }
    const p = await readAndPlanPreResolve(conn, { programId: W, stakeProgramId: S, cranker: PAYER, market, marketData: new Uint8Array(info.data) });
    let sim = "-";
    if (p.cranks.length) sim = JSON.stringify((await connectionSelfHealDeps(conn, market, PAYER).simulate([...computeBudgetPrefix(400_000), ...p.cranks])).err);
    console.log(`${sym.padEnd(7)} lp=${p.legs.lpOwed} stake=${p.legs.stakeOwed} proto=${p.legs.protocolOwed} creator=${p.legs.creatorClaimable} cranks=[${p.cranks.map((c) => c.data[0]).join(",")}] crankSim=${sim} safe=${p.blockers.length === 0}`);
    for (const b of p.blockers) console.log("   BLOCK:", b.slice(0, 140));
    await new Promise((r) => setTimeout(r, 500));
  }
})();
