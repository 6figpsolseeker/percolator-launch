/**
 * Matcher tag 5 `Configure` with OWNER-PROOF auth (percolator-match
 * feat/p2-matcher-v2 `vamm.rs::process_configure` / `encode_configure`).
 * Fixes the P0b open item "ConfigureBackingFeeCap (matcher tag 4) can't be
 * sent": tag 4 needs the wrapper's delegate PDA as signer; tag 5 lets the LP
 * OWNER sign and proves the delegate by re-deriving it:
 *   create_program_address(["matcher", market, lp_portfolio, owner, matcher_prog,
 *                            matcher_ctx, [bump]], wrapper) == ctx.lp_pda
 * Wire: [5, 1, wrapper(32), market(32), lp_portfolio(32), bump, op, ...payload]
 *   op 0 SetBackingFeeCap: payload = cap u16 LE (0..=10_000).
 * Accounts: [0] lp_owner (signer), [1] matcher_ctx (writable).
 *
 * Flag NEXT_PUBLIC_MATCHER_TAG5=1: only once the matcher program is upgraded to
 * v2 — the deployed v1 matcher (12bd671) has no tag 5 and rejects it.
 */
import { PublicKey, TransactionInstruction } from "@solana/web3.js";
import { deriveMatcherDelegate } from "@percolatorct/sdk";

export const MATCHER_CONFIGURE_TAG = 5;
export const CONFIGURE_AUTH_OWNER_PROOF = 1;
export const CONFIGURE_OP_BACKING_FEE_CAP = 0;
export const BACKING_FEE_CAP_BPS_MAX = 10_000;

export function matcherTag5Enabled(): boolean {
  const v = process.env.NEXT_PUBLIC_MATCHER_TAG5;
  return v === "1" || v === "true";
}

export function encodeConfigureBackingFeeCapOwnerProof(
  wrapperProgramId: PublicKey,
  market: PublicKey,
  lpPortfolio: PublicKey,
  bump: number,
  capBps: number,
): Uint8Array {
  if (!Number.isInteger(capBps) || capBps < 0 || capBps > BACKING_FEE_CAP_BPS_MAX) {
    throw new Error(`backing fee cap must be 0..${BACKING_FEE_CAP_BPS_MAX} bps`);
  }
  if (!Number.isInteger(bump) || bump < 0 || bump > 255) throw new Error("bump must be a u8");
  const out = new Uint8Array(2 + 32 * 3 + 1 + 1 + 2);
  out[0] = MATCHER_CONFIGURE_TAG;
  out[1] = CONFIGURE_AUTH_OWNER_PROOF;
  out.set(wrapperProgramId.toBytes(), 2);
  out.set(market.toBytes(), 34);
  out.set(lpPortfolio.toBytes(), 66);
  out[98] = bump;
  out[99] = CONFIGURE_OP_BACKING_FEE_CAP;
  out[100] = capBps & 0xff;
  out[101] = capBps >> 8;
  return out;
}

/** The full instruction; the bump is the canonical delegate bump the wrapper's tag 83 used. */
export function buildConfigureBackingFeeCapIx(p: {
  wrapperProgramId: PublicKey;
  matcherProgramId: PublicKey;
  market: PublicKey;
  lpPortfolio: PublicKey;
  lpOwner: PublicKey;
  matcherCtx: PublicKey;
  capBps: number;
}): TransactionInstruction {
  const [, bump] = deriveMatcherDelegate(p.wrapperProgramId, p.market, p.lpPortfolio, p.lpOwner, p.matcherProgramId, p.matcherCtx);
  return new TransactionInstruction({
    programId: p.matcherProgramId,
    keys: [
      { pubkey: p.lpOwner, isSigner: true, isWritable: false },
      { pubkey: p.matcherCtx, isSigner: false, isWritable: true },
    ],
    data: Buffer.from(encodeConfigureBackingFeeCapOwnerProof(p.wrapperProgramId, p.market, p.lpPortfolio, bump, p.capBps)),
  });
}
