"use client";

/**
 * "Improve pricing" (lib/fix-pricing.ts): shown only to the market's LP owner while the LP's v1
 * matcher context still has skew on. One approval sends matcher tag 5 SetParams with skew 0.
 */
import { useCallback, useEffect, useState } from "react";
import { PublicKey } from "@solana/web3.js";
import { useConnectionCompat, useWalletCompat } from "@/hooks/useWalletCompat";
import { useSlabState } from "@/components/providers/SlabProvider";
import { resolveLpTradeAccounts } from "@/hooks/useTrade";
import { decodeMatcherCtx, type MatcherCtxView } from "@/lib/limits/decode";
import { buildFixPricingIx, fixPricingEligible } from "@/lib/fix-pricing";
import { sendTx } from "@/lib/tx";

/** PortfolioProvenance.owner (immutable; the owner SetMatcherConfig derived the delegate for). */
const PORTFOLIO_PROVENANCE_OWNER_OFF = 80;

interface LpView {
  lpPortfolio: PublicKey;
  lpOwner: PublicKey;
  matcherProg: PublicKey;
  matcherCtx: PublicKey;
  ctx: MatcherCtxView;
}

export function useFixPricing(slabAddress: string) {
  const { connection } = useConnectionCompat();
  const wallet = useWalletCompat();
  const { programId } = useSlabState();
  const [lp, setLp] = useState<LpView | null>(null);
  const [sending, setSending] = useState(false);
  const [done, setDone] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const [nonce, setNonce] = useState(0);

  const walletKey = wallet.publicKey?.toBase58() ?? null;
  const programKey = programId?.toBase58() ?? null;

  useEffect(() => {
    setLp(null);
    if (!walletKey || !programKey) return;
    let alive = true;
    (async () => {
      try {
        const market = new PublicKey(slabAddress);
        const r = await resolveLpTradeAccounts(connection, new PublicKey(programKey), market);
        const [pf, cx] = await connection.getMultipleAccountsInfo([r.accountB, r.matcherCtx], "confirmed");
        if (!alive || !pf || !cx) return;
        const ctx = decodeMatcherCtx(new Uint8Array(cx.data));
        if (!ctx) return;
        const lpOwner = new PublicKey(new Uint8Array(pf.data).subarray(PORTFOLIO_PROVENANCE_OWNER_OFF, PORTFOLIO_PROVENANCE_OWNER_OFF + 32));
        setLp({ lpPortfolio: r.accountB, lpOwner, matcherProg: r.matcherProg, matcherCtx: r.matcherCtx, ctx });
      } catch {
        /* not resolvable (no LP yet, RPC hiccup): nothing to offer */
      }
    })();
    return () => {
      alive = false;
    };
  }, [connection, slabAddress, walletKey, programKey, nonce]);

  const eligible = !done && fixPricingEligible(lp?.ctx ?? null, wallet.publicKey ?? null, lp?.lpOwner ?? null);

  const fix = useCallback(async () => {
    if (!lp || !programId || !wallet.publicKey) return;
    setSending(true);
    setError(null);
    try {
      const ix = buildFixPricingIx({
        wrapperProgramId: programId,
        matcherProgramId: lp.matcherProg,
        market: new PublicKey(slabAddress),
        lpPortfolio: lp.lpPortfolio,
        lpOwner: lp.lpOwner,
        matcherCtx: lp.matcherCtx,
        ctx: lp.ctx,
      });
      await sendTx({ connection, wallet, instructions: [ix], computeUnits: 60_000 });
      setDone(true);
      setNonce((n) => n + 1);
    } catch (e) {
      setError(e);
    } finally {
      setSending(false);
    }
  }, [lp, programId, wallet, connection, slabAddress]);

  return { eligible, done, sending, error, fix, ctx: lp?.ctx ?? null };
}
