/** Read-only A/B: the useTrade add/close tx for an EXISTING position, with vs without the
 *  taker-portfolio PermissionlessCrank prefix that useTrade prepends when legs are active. */
import { Connection, Keypair, PublicKey } from "@solana/web3.js";
import fs from "node:fs";
import { ACCOUNTS_PERMISSIONLESS_CRANK_BASE, buildAccountMetas, buildIx, encodePermissionlessCrank, parseWrapperConfigV17, V17_HEADER_LEN } from "@percolatorct/sdk";
import { DEVNET_PROGRAM_IDS } from "../../lib/program-ids";
import { resolveV17TradeAccounts } from "../../hooks/useTrade";
import { buildTradeIxs } from "../../lib/trade-ix";
import { fetchAssetMarketId, fetchPortfolioIdentity, defaultCrankObservations } from "../../lib/v18-wire";
import { simulateForGate } from "../../lib/tx";
import { computeLimitPriceE6 } from "../../lib/slippage";
const conn = new Connection(process.env.DEVNET_RPC!, "confirmed");
const PROGRAM = new PublicKey(DEVNET_PROGRAM_IDS.wrapper);
const kp = Keypair.fromSecretKey(Uint8Array.from(JSON.parse(fs.readFileSync(process.argv[2], "utf8"))));
const MK: Record<string, string> = { PERC: "9EPm8nB8Fs7WcEZgE1WGFPTGc6rAzD6GhFJyMm4dEFHn", SI: "8WC8vALsDJhNCUVRmqZBDSg5xgFAhDrgy7zWqF512pDx", TRENDS: "Fz5JfUcbEdt5DNSNwZpBn2dZ7NpN8MnvJMiYjnqMacMh" };
(async () => {
  const ROUNDS = Number(process.env.ROUNDS ?? 1); const tally: Record<string, number> = {};
  for (let round = 0; round < ROUNDS; round++) for (const [n, s] of Object.entries(MK)) {
    const market = new PublicKey(s);
    const wc = parseWrapperConfigV17(new Uint8Array((await conn.getAccountInfo(market))!.data), V17_HEADER_LEN);
    const markE6 = BigInt(wc.markEwmaE6);
    let r;
    try { r = await resolveV17TradeAccounts(conn, PROGRAM, market, kp.publicKey); } catch (e) { console.log(n, "resolve:", (e as Error).message); continue; }
    const [takerId, lpId, marketId] = await Promise.all([fetchPortfolioIdentity(conn, r.accountA), fetchPortfolioIdentity(conn, r.accountB), fetchAssetMarketId(conn, market, 0)]);
    const crank = buildIx({ programId: PROGRAM, keys: buildAccountMetas(ACCOUNTS_PERMISSIONLESS_CRANK_BASE, [kp.publicKey, market, r.accountA]), data: encodePermissionlessCrank({ nowSlot: 0n, observations: defaultCrankObservations(0) }) });
    for (const size of [1_000_000_000n, -1_000_000_000n]) {
      const t = buildTradeIxs({ programId: PROGRAM, signer: kp.publicKey, market, ...r, takerId, lpId, marketId, legs: [size], size, limitPriceE6: computeLimitPriceE6({ markE6, size }), marketTradeFeeBps: wc.tradeFeeBps });
      const a = await simulateForGate(conn, kp.publicKey, t);
      const b = await simulateForGate(conn, kp.publicKey, [crank, ...t]);
      const c = await simulateForGate(conn, kp.publicKey, [crank]);
      const k = (x: unknown) => (x ? JSON.stringify(x).replace(/\D+/g, ' ').trim() : 'ok'); for (const [lbl, v] of [['alone', a.err], ['crank+', b.err]] as const) { const key = `${n} ${size > 0n ? 'long' : 'short'} ${lbl} ${k(v)}`; tally[key] = (tally[key] ?? 0) + 1; }
      if (ROUNDS === 1) console.log(`${n} size=${size}: trade alone err=${JSON.stringify(a.err)} | crank+trade err=${JSON.stringify(b.err)} | crank alone err=${JSON.stringify(c.err)}`);
    }
  }
  console.log(JSON.stringify(tally, null, 1));
})().catch((e) => { console.error(e); process.exit(1); });
