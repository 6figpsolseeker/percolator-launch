/**
 * Small pure display rules for the trade page (E2E B6).
 */

/** Position NFT empty state: only a DISCONNECTED wallet is asked to connect. */
export function positionNftEmptyText(walletConnected: boolean): string {
  return walletConnected
    ? "No open position on this market. Open one to wrap it as an NFT."
    : "Connect wallet to view NFT status.";
}

/**
 * "<side> capacity left" must not advertise room the LP cannot fill: a depleted or
 * underfunded LP has no capacity, whatever the exposure-cap arithmetic says.
 */
export function sideCapacityForDisplay(capacityNotional: bigint | null, lpUnavailable: boolean): bigint | null {
  if (capacityNotional === null) return null;
  return lpUnavailable ? 0n : capacityNotional;
}
