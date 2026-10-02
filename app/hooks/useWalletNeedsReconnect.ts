"use client";

import { useEffect, useState } from "react";

/**
 * How long the "authenticated but no usable wallet" state must persist before
 * the UI calls it stale. Privy's Solana `useWallets().ready` already waits for
 * every external connector's silent auto-connect attempt, but the `wallets`
 * array and `ready` flag are separate React state updates — the grace keeps a
 * normal page load from flashing "Reconnect wallet" for one render.
 */
export const RECONNECT_GRACE_MS = 1500;

/**
 * Fallback when Privy never reports `walletsReady`. Seen live on the playground (2026-10-02): after
 * an idle session the header kept showing the linked address while every Connect gate (which needs
 * an active wallet) said "connect". Only `walletsReady` was holding the stale check back, so a
 * session that is authenticated with no usable wallet for this long is treated as stale anyway.
 */
export const RECONNECT_FALLBACK_MS = 5000;

export interface WalletSessionSignals {
  /** `usePrivy().ready` */
  privyReady: boolean;
  /** `usePrivy().authenticated` — survives reloads via Privy's refresh token. */
  authenticated: boolean;
  /**
   * `useWallets().ready` from `@privy-io/react-auth/solana` (3.41.x): true once
   * every external connector has run its initial silent `standard:connect`
   * (or Privy's 1.5s connector timeout fired) and the user is resolved.
   */
  walletsReady: boolean;
  /** Whether `resolveActiveWallet()` found a wallet that can actually sign. */
  hasActiveWallet: boolean;
}

/**
 * The stale session: Privy still holds a valid session (so `authenticated` is
 * true and `user.wallet` is populated) but no connected Solana wallet was
 * restored — typically an extension that was locked overnight, which rejects
 * Privy's silent reconnect (`standard:connect({ silent: true })`, errors
 * swallowed). In that state nothing can sign, and Privy's `login()` is a no-op.
 */
export function isStaleWalletSession(s: WalletSessionSignals): boolean {
  return s.privyReady && s.authenticated && s.walletsReady && !s.hasActiveWallet;
}

/**
 * `isStaleWalletSession`, debounced by `graceMs` so it never flickers on load; or, if Privy never
 * reports `walletsReady`, the same unusable session after `fallbackMs`.
 */
export function useWalletNeedsReconnect(
  signals: WalletSessionSignals,
  graceMs: number = RECONNECT_GRACE_MS,
  fallbackMs: number = RECONNECT_FALLBACK_MS,
): boolean {
  // Authenticated, but nothing can sign. `walletsReady` only decides how long to wait before
  // calling it stale (it keeps a normal load from flashing); it can no longer block it for good.
  const unusable = signals.privyReady && signals.authenticated && !signals.hasActiveWallet;
  const waitMs = isStaleWalletSession(signals) ? graceMs : fallbackMs;
  const [confirmed, setConfirmed] = useState(false);

  useEffect(() => {
    if (!unusable) {
      setConfirmed(false);
      return;
    }
    const id = setTimeout(() => setConfirmed(true), waitMs);
    return () => clearTimeout(id);
  }, [unusable, waitMs]);

  return unusable && confirmed;
}
