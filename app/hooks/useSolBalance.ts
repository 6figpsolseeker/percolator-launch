"use client";

import { useEffect, useState } from "react";
import type { Connection, PublicKey } from "@solana/web3.js";
import { isMockMode } from "@/lib/mock-mode";
import { pollWhenVisible } from "@/lib/pollWhenVisible";

/** How often the wallet's SOL is re-read while the page is visible. */
export const SOL_BALANCE_POLL_MS = 10_000;

/**
 * The wallet's SOL balance (null until read, or with no wallet), kept current while mounted.
 *
 * Read once on connect, then again every SOL_BALANCE_POLL_MS while the tab is visible and the
 * moment it becomes visible again (pollWhenVisible). The create wizard's launch gate read it only
 * once, so a SOL airdrop from the faucet modal or from faucet.solana.com in another tab left it at
 * "Need ~N SOL" until a reload. Only the first read clears the value on failure, so a transient
 * RPC error on a poll can't flicker the gate. Mock mode (?mock=1) reports a funded 8.5 SOL.
 */
export function useSolBalance(publicKey: PublicKey | null | undefined, connection: Connection | null | undefined): number | null {
  const [solBalance, setSolBalance] = useState<number | null>(null);
  useEffect(() => {
    if (isMockMode()) { setSolBalance(8.5); return; }
    if (!publicKey || !connection) { setSolBalance(null); return; }
    let cancelled = false;
    const read = (first: boolean) =>
      connection.getBalance(publicKey).then((lamports) => {
        if (!cancelled) setSolBalance(lamports / 1_000_000_000);
      }).catch(() => { if (!cancelled && first) setSolBalance(null); });
    void read(true);
    const stop = pollWhenVisible(() => void read(false), SOL_BALANCE_POLL_MS);
    return () => { cancelled = true; stop(); };
  }, [publicKey, connection]);
  return solBalance;
}
