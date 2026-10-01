/** Read-only: decode v18 market health (LP capital, payout haircut, lock reasons) on devnet. */
import { DEVNET_PROGRAM_IDS } from "../../lib/program-ids";
import { Connection, PublicKey } from "@solana/web3.js";
import { decodeMarketHealth, healthBadges, MARKET_HEALTH_SLICE_LEN } from "../../lib/market-health";
import { scanEnabledMarketLpCapitals } from "../../lib/lp-portfolio";

const RPC = process.env.DEVNET_RPC ?? "https://api.devnet.solana.com";
const PROGRAM = new PublicKey(DEVNET_PROGRAM_IDS.wrapper);
const MARKETS: Record<string, string> = {
  SOL: "AzagguvrWmRgcBpsKuqomW7Yb1YUUd6UzcrkiRsqdhr", PENGU: "ENdXK8k6iiWCAx4Z9XfoKLg9oXsEbPL4hEtmEmUqozDZ",
  PAID: "BPLPf1XT7HE9qKwAbf4cSqcDrV6VHJDS3FPeQ3GL7JPY", CATE: "CjdnH8fTmxNMsuUevBt9VjSi87E3ESTcuWuoSrjUjvXE",
  COLLECT: "3t67LQPdgiSqGvXsYff3Pzv2uHtM1zZ7f29HsnEzb6vJ", Murphy: "7h3wNxjzPo6pTfWQ7uiTjDSsprGEeMNh696efmYrpAX2",
  TEXTIT: "DnFhDdWzcWkBDxN9JJcmFmtiqqKo56w9JwQEtRKNdjcG", ANSEM: "5bVTTMRceF9qEERjPWvqxtrDighE846QkVXSJm4uC8Tk",
};
async function main() {
  const conn = new Connection(RPC, "confirmed");
  const lp = await scanEnabledMarketLpCapitals(conn, PROGRAM);
  const keys = Object.values(MARKETS).map((a) => new PublicKey(a));
  const res = await conn.getMultipleAccountsInfoAndContext(keys, { dataSlice: { offset: 0, length: MARKET_HEALTH_SLICE_LEN } });
  Object.keys(MARKETS).forEach((sym, i) => {
    const info = res.value[i];
    if (!info) return console.log(sym, "missing");
    const h = decodeMarketHealth(new Uint8Array(info.data), BigInt(res.context.slot), lp.get(keys[i].toBase58()) ?? null);
    console.log(`${sym.padEnd(8)} lp=${h.lpCapital} haircut=${h.payoutHaircutBps}bps domains=${h.domains.map((d) => `${d.side}:${d.hasClaims ? d.payoutRateBps : "-"}`).join(",")} locks=[${h.lockReasons}] badges=[${healthBadges(h).map((b) => b.label).join(" | ")}]`);
  });
}
main().catch((e) => { console.error(e); process.exit(1); });
