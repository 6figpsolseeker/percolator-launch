/**
 * E2E B10 bridge: emits the APP's plain owner exit AND its ordered B10 candidates
 * (lib/limits/adl-exit-plan.ts adlExitCandidates over lib/limits/rebalance-ixs.ts) as JSON for
 * the #519 LiteSVM scenario `b10_app_exits_after_one_side_drained`, which applies the app's
 * selection rule (chooseAdlExit): plain first; on a wrapper 18/22 AT the 44, the first
 * candidate that simulates clean (and, without a 44, leaves the leg flat).
 * argv: programId market owner portfolio portfolioId positionEpoch reduceQ modeLong modeShort
 */
import { PublicKey, type TransactionInstruction } from "@solana/web3.js";
import { buildRebalanceCloseIxs } from "../../lib/limits/rebalance-ixs";
import { adlExitCandidates, resetPendingSides } from "../../lib/limits/adl-exit-plan";

const [programId, market, owner, portfolio, pid, pep, reduceQ, modeLong, modeShort] = process.argv.slice(2);
const prog = new PublicKey(programId);
const mkt = new PublicKey(market);
const plain = buildRebalanceCloseIxs({
  programId: prog,
  market: mkt,
  owner: new PublicKey(owner),
  portfolio: new PublicKey(portfolio),
  portfolioId: BigInt(pid),
  positionEpoch: BigInt(pep),
  reduceQ: BigInt(reduceQ),
  pythCrankAccount: null,
});
const [crank, tag44] = plain;
if (!crank || !tag44) throw new Error("plain exit must be [crank, 44]");
const cands = adlExitCandidates({ programId: prog, market: mkt, assetIndex: 0, crank, tag44, finalizeSides: resetPendingSides(Number(modeLong), Number(modeShort)) });
const j = (ixs: TransactionInstruction[]) =>
  ixs.map((ix) => ({
    programId: ix.programId.toBase58(),
    keys: ix.keys.map((k) => ({ pubkey: k.pubkey.toBase58(), isSigner: k.isSigner, isWritable: k.isWritable })),
    dataHex: Buffer.from(ix.data).toString("hex"),
  }));
process.stdout.write(JSON.stringify({ plain: j(plain), candidates: cands.map((c) => ({ route: c.route, needsFlatAfter: c.needsFlatAfter, ixs: j(c.instructions) })) }));
