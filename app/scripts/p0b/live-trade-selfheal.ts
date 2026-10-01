/**
 * Read-only live check: an OPEN on a market with a ResetPending side, built
 * exactly like useTrade (TradeCpi, v18 identity CAS), from an EXISTING trader
 * portfolio (signer = its owner; sigVerify=false simulation — nothing signed).
 * Runs the app's planSelfHeal and reports each simulation.
 *   npx tsx scripts/p0b/live-trade-selfheal.ts <SYMBOL>
 */
import { DEVNET_PROGRAM_IDS } from "../../lib/program-ids";
import { Connection, PublicKey } from "@solana/web3.js";
import {
  ACCOUNTS_TRADE_CPI, buildAccountMetas, buildIx, decodePortfolioMatcherControl, deriveMatcherDelegate,
  encodeTradeCpi, parsePortfolioV17, V17_PORTFOLIO_IDENTITY_TRAILER_LEN,
} from "@percolatorct/sdk";
import { fetchPortfolioIdentity, fetchAssetMarketId } from "../../lib/v18-wire";
import { isLpPortfolio } from "../../lib/lpPortfolio";
import { planSelfHeal, connectionSelfHealDeps, describeRepair, computeBudgetPrefix } from "../../lib/self-heal";

const RPC = process.env.DEVNET_RPC ?? "https://api.devnet.solana.com";
const PROGRAM = new PublicKey(DEVNET_PROGRAM_IDS.wrapper);
const MAGIC = Buffer.from([0x00, 0x36, 0x31, 0x56, 0x43, 0x52, 0x45, 0x50]);
const MARKETS: Record<string, { slab: string; feeBps: bigint }> = {
  COLLECT: { slab: "3t67LQPdgiSqGvXsYff3Pzv2uHtM1zZ7f29HsnEzb6vJ", feeBps: 5n },
  Murphy: { slab: "7h3wNxjzPo6pTfWQ7uiTjDSsprGEeMNh696efmYrpAX2", feeBps: 10n },
  TEXTIT: { slab: "DnFhDdWzcWkBDxN9JJcmFmtiqqKo56w9JwQEtRKNdjcG", feeBps: 5n },
};
function matcherCfg(data: Buffer) {
  const off = data.length - 104 - V17_PORTFOLIO_IDENTITY_TRAILER_LEN;
  if (off < 0) return null;
  const dv = new DataView(data.buffer, data.byteOffset, data.byteLength);
  if (!decodePortfolioMatcherControl(dv.getBigUint64(off + 96, true)).enabled) return null;
  return { prog: new PublicKey(data.subarray(off, off + 32)), ctx: new PublicKey(data.subarray(off + 32, off + 64)) };
}
async function main() {
  const sym = process.argv[2] ?? "COLLECT";
  const { slab, feeBps } = MARKETS[sym];
  const market = new PublicKey(slab);
  const conn = new Connection(RPC, "confirmed");
  const pfs = await conn.getProgramAccounts(PROGRAM, {
    filters: [
      { memcmp: { offset: 0, bytes: MAGIC.toString("base64"), encoding: "base64" } },
      { memcmp: { offset: 16, bytes: market.toBase58() } },
    ],
  });
  const lp = pfs.find((p) => p.account.data.length > 1000 && matcherCfg(Buffer.from(p.account.data)));
  if (!lp) throw new Error("no LP");
  const lpData = Buffer.from(lp.account.data);
  const cfg = matcherCfg(lpData)!;
  const lpOwner = new PublicKey(lpData.subarray(80, 112));
  const [delegate] = deriveMatcherDelegate(PROGRAM, market, lp.pubkey, lpOwner, cfg.prog, cfg.ctx);
  const takers = pfs
    .filter((p) => p.account.data.length > 1000 && !isLpPortfolio(p.account.data))
    .flatMap((p) => { try { return [{ pk: p.pubkey, pf: parsePortfolioV17(new Uint8Array(p.account.data)) }]; } catch { return []; } })
    .filter((t) => t.pf.capital > 0n && t.pf.owner.equals(new PublicKey(Buffer.from(pfs.find((x) => x.pubkey.equals(t.pk))!.account.data).subarray(80, 112))))
    .sort((a, b) => (a.pf.capital > b.pf.capital ? -1 : 1));
  if (!takers.length) throw new Error("no funded taker");
  const taker = takers[0];
  console.log(`${sym}: LP ${lp.pubkey.toBase58()} taker ${taker.pk.toBase58()} owner ${taker.pf.owner.toBase58()} capital ${taker.pf.capital}`);
  const [tId, lId, marketId] = await Promise.all([
    fetchPortfolioIdentity(conn, taker.pk), fetchPortfolioIdentity(conn, lp.pubkey), fetchAssetMarketId(conn, market, 0),
  ]);
  const deps = connectionSelfHealDeps(conn, market, taker.pf.owner);
  for (const [label, size] of [["short", -1_000n], ["long", 1_000n]] as const) {
    const ix = buildIx({
      programId: PROGRAM,
      keys: buildAccountMetas(ACCOUNTS_TRADE_CPI, [taker.pf.owner, market, taker.pk, lp.pubkey, cfg.prog, cfg.ctx, delegate]),
      data: encodeTradeCpi({
        accountAPortfolioId: tId.portfolioId, accountAPositionEpoch: tId.positionEpoch,
        accountBPortfolioId: lId.portfolioId, accountBPositionEpoch: lId.positionEpoch,
        accountBMatcherSequence: lId.matcherSequence, assetIndex: 0, marketId,
        sizeQ: size.toString(), feeBps, limitPrice: "0", backingFeeCapBps: 0,
      }),
    });
    const plain = await deps.simulate([...computeBudgetPrefix(600_000), ix]);
    const r = await planSelfHeal({ programId: PROGRAM, market, instructions: [ix], computeUnits: 600_000 }, deps);
    const healed = await deps.simulate([...computeBudgetPrefix(r.computeUnits), ...r.instructions]);
    console.log(`  open ${label}: alone err=${JSON.stringify(plain.err)} | planSelfHeal=${r.outcome} [${r.repairs.map(describeRepair).join(", ")}] | sent-tx err=${JSON.stringify(healed.err)}`);
  }
}
main().catch((e) => { console.error(e); process.exit(1); });
