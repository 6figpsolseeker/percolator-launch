"use client";

/**
 * UX WP-10 (audit §4.9, RP-1): a 28 px "Reconnecting to Solana…" bar under the nav while the RPC
 * is failing (lib/rpc-health.ts); it hides itself on the next good answer. Data surfaces keep
 * their last good values meanwhile.
 */
import { type FC, useSyncExternalStore } from "react";
import { rpcHealth } from "@/lib/rpc-health";

export const CONNECTION_BAR_TEXT = "Reconnecting to Solana…";

export const ConnectionBarView: FC<{ degraded: boolean }> = ({ degraded }) =>
  degraded ? (
    <div
      data-testid="connection-bar"
      role="status"
      aria-live="polite"
      className="flex h-7 items-center justify-center gap-2 border-b border-[var(--border)] bg-[var(--bg-elevated)] text-[11px] text-[var(--text-secondary)]"
    >
      <span aria-hidden="true" className="h-1.5 w-1.5 animate-pulse rounded-full bg-[var(--text-muted)]" />
      {CONNECTION_BAR_TEXT}
    </div>
  ) : null;

export const ConnectionBar: FC = () => {
  const degraded = useSyncExternalStore(rpcHealth.subscribe, rpcHealth.getSnapshot, rpcHealth.getServerSnapshot);
  return <ConnectionBarView degraded={degraded} />;
};
