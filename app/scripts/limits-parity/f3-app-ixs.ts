/**
 * Emits the APP's owner-signed exit instructions (lib/limits/rebalance-ixs.ts) as JSON, for
 * the #519 LiteSVM F-3 scenario to execute verbatim (tests/limits_app_f3.rs in the sim
 * worktree). argv: programId market owner portfolio portfolioId positionEpoch reduceQ
 */
import { PublicKey } from "@solana/web3.js";
import { buildRebalanceCloseIxs } from "../../lib/limits/rebalance-ixs";

const [programId, market, owner, portfolio, pid, pep, reduceQ] = process.argv.slice(2);
const ixs = buildRebalanceCloseIxs({
  programId: new PublicKey(programId),
  market: new PublicKey(market),
  owner: new PublicKey(owner),
  portfolio: new PublicKey(portfolio),
  portfolioId: BigInt(pid),
  positionEpoch: BigInt(pep),
  reduceQ: BigInt(reduceQ),
  pythCrankAccount: null,
});
process.stdout.write(
  JSON.stringify(
    ixs.map((ix) => ({
      programId: ix.programId.toBase58(),
      keys: ix.keys.map((k) => ({ pubkey: k.pubkey.toBase58(), isSigner: k.isSigner, isWritable: k.isWritable })),
      dataHex: Buffer.from(ix.data).toString("hex"),
    })),
  ),
);
