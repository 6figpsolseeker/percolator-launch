/** Read-only: run the app's LP resolution against devnet for each market, and list every
 *  matcher-enabled portfolio with its owner, ctx, and the market's asset_admin / vault LP. */
import { Connection, PublicKey } from "@solana/web3.js";
import { parsePortfolioV17, decodeAssetVaultLpP3, parseAssetOracleProfileV17, V17_PORTFOLIO_IDENTITY_TRAILER_LEN, decodePortfolioMatcherControl } from "@percolatorct/sdk";
import { DEVNET_PROGRAM_IDS } from "../../lib/program-ids";
import { resolveLpTradeAccounts } from "../../hooks/useTrade";

const RPC = process.env.DEVNET_RPC!;
const PROGRAM = new PublicKey(DEVNET_PROGRAM_IDS.wrapper);
const MAGIC = Buffer.from([0x00, 0x36, 0x31, 0x56, 0x43, 0x52, 0x45, 0x50]);
const MARKETS = (process.argv.slice(2).length ? process.argv.slice(2) : [
  "9EPm8nB8Fs7WcEZgE1WGFPTGc6rAzD6GhFJyMm4dEFHn", "8WC8vALsDJhNCUVRmqZBDSg5xgFAhDrgy7zWqF512pDx", "Fz5JfUcbEdt5DNSNwZpBn2dZ7NpN8MnvJMiYjnqMacMh"]);
async function main() {
  const conn = new Connection(RPC, "confirmed");
  console.log("wrapper", PROGRAM.toBase58());
  for (const m of MARKETS) {
    const market = new PublicKey(m);
    const info = await conn.getAccountInfo(market);
    const md = new Uint8Array(info!.data);
    let admin = "?"; let vlp = "?";
    try { admin = parseAssetOracleProfileV17(md, 1350).assetAdmin.toBase58(); } catch (e) { admin = "err " + (e as Error).message; }
    try { const r = decodeAssetVaultLpP3(md, 0); vlp = `bound=${r.bound} portfolio=${r.vaultLpPortfolio?.toBase58() ?? "none"}`; } catch (e) { vlp = "err " + (e as Error).message; }
    console.log(`\n=== market ${m}  len=${md.length}\n  asset0 asset_admin=${admin}\n  vaultLp: ${vlp}`);
    const pfs = await conn.getProgramAccounts(PROGRAM, { filters: [
      { memcmp: { offset: 0, bytes: MAGIC.toString("base64"), encoding: "base64" } },
      { memcmp: { offset: 16, bytes: m } }] });
    console.log(`  portfolios on market: ${pfs.length} (RPC order shown)`);
    for (const { pubkey, account } of pfs) {
      const d = Buffer.from(account.data);
      const off = d.length - 104 - V17_PORTFOLIO_IDENTITY_TRAILER_LEN;
      if (off < 0) continue;
      const en = decodePortfolioMatcherControl(new DataView(d.buffer, d.byteOffset, d.byteLength).getBigUint64(off + 96, true)).enabled;
      if (!en) continue;
      let owner = "?", cap = "?";
      try { const p = parsePortfolioV17(new Uint8Array(d)); owner = p.owner.toBase58(); cap = p.capital.toString(); } catch {}
      console.log(`  ENABLED pf=${pubkey.toBase58()} owner=${owner} capital=${cap} prog=${new PublicKey(d.subarray(off, off + 32)).toBase58()} ctx=${new PublicKey(d.subarray(off + 32, off + 64)).toBase58()}`);
    }
    try {
      const r = await resolveLpTradeAccounts(conn, PROGRAM, market);
      const own = parsePortfolioV17(new Uint8Array((await conn.getAccountInfo(r.accountB))!.data)).owner.toBase58();
      console.log(`  APP PICKS accountB=${r.accountB.toBase58()} owner=${own} ctx=${r.matcherCtx.toBase58()}`);
    } catch (e) { console.log(`  APP resolve error: ${(e as Error).message}`); }
  }
}
main().catch((e) => { console.error(e); process.exit(1); });
