'use client';

/**
 * UX WP-4 (audit §3.6 item 4, user decision 2026-09-30): the pending withdrawal card. Replaces
 * "Pending Redemption {n} LP" / "Claim Redemption". It counts the cooldown down, then:
 *  - `armed` (the user requested in this page session): opens the payout signature by itself
 *    (sendTx pre-simulates it and bundles the repairs), so the two signatures feel like one flow;
 *  - otherwise (they came back later): "Finish withdrawal".
 */
import { useEffect, useRef, useState, type FC } from 'react';
import { StatusLine } from '@/components/ui/StatusLine';
import { EARN_WITHDRAW_COPY as C, fmtCountdown, type PendingPhase } from '@/lib/limits/earn-withdraw';
import { useCooldownCountdown } from '@/hooks/useCooldownCountdown';

export interface EarnPendingWithdrawalProps {
  /** "12.50 USDC" (the estimate at the withdraw-side price), or the share count when unknown. */
  amountLabel: string;
  cooldownElapsed: boolean;
  cooldownRemainingSlots: bigint;
  /** Requested in this page session: open the payout prompt automatically when ready. */
  armed: boolean;
  disabled?: boolean;
  onCollect: () => Promise<void>;
  /** Re-read the ticket when the local countdown reaches 0 (the chain decides, not the clock). */
  onRefresh?: () => Promise<void> | void;
  /** A plain-language failure from the last payout attempt. */
  error?: string | null;
  /** Identifies the ticket (e.g. its share count): a new ticket restarts the clock. */
  ticketKey?: string;
  /** The payout can only pay part right now: offer the max (re-request, then collect). */
  resize?: { label: string; body: string; onResize: () => Promise<void> } | null;
}

export const EarnPendingWithdrawal: FC<EarnPendingWithdrawalProps> = ({
  amountLabel,
  cooldownElapsed,
  cooldownRemainingSlots,
  armed,
  disabled = false,
  onCollect,
  onRefresh,
  error = null,
  resize = null,
  ticketKey,
}) => {
  const [collecting, setCollecting] = useState(false);
  const autoFired = useRef(false);
  // One live clock shared with Stake (hooks/useCooldownCountdown): ticks every second, never
  // snaps back on a lagging poll, and re-reads the chain at 0 until the ticket reads elapsed.
  const { remainingMs } = useCooldownCountdown({ remainingSlots: cooldownRemainingSlots, elapsed: cooldownElapsed, resetKey: ticketKey ?? null, onZero: onRefresh ? () => void onRefresh() : undefined });

  const collect = async () => {
    if (collecting || disabled) return;
    setCollecting(true);
    try {
      await onCollect();
    } finally {
      setCollecting(false);
    }
  };

  // A new ticket ("Withdraw max available now" re-requests a smaller one) gets its own automatic
  // payout. The card stays mounted across the re-request, so without this the first ticket's
  // attempt left autoFired set and the armed payout never opened. Declared before the effect below
  // so a same-render change resets first.
  useEffect(() => {
    autoFired.current = false;
  }, [ticketKey]);

  // Ready + requested in this session: open the payout prompt by itself, once.
  useEffect(() => {
    if (!cooldownElapsed || !armed || autoFired.current || disabled) return;
    autoFired.current = true;
    void collect();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- fire once when it becomes ready
  }, [cooldownElapsed, armed, disabled]);

  const phase: PendingPhase = collecting ? 'collecting' : cooldownElapsed ? 'ready' : 'counting';
  const body =
    phase === 'collecting'
      ? `${C.collecting} ${C.payoutPrompt}.`
      : phase === 'ready'
        ? C.ready
        : C.readyIn(fmtCountdown(Math.max(0, remainingMs)));

  return (
    <div
      data-testid="earn-pending-withdrawal"
      data-phase={phase}
      className="mx-5 mt-5 border border-[var(--accent)]/30 bg-[var(--accent)]/5 p-3"
    >
      <p className="text-[11px] font-medium uppercase tracking-[0.08em] text-[var(--text-secondary)]">{C.pendingTitle(amountLabel)}</p>
      <p data-testid="earn-pending-countdown" className="mt-1 flex items-center gap-1.5 font-mono text-[13px] tabular-nums text-[var(--text)]">
        {phase !== 'ready' && (
          <span aria-hidden="true" className="inline-block h-[6px] w-[6px] animate-pulse rounded-full bg-[var(--text-muted)]" />
        )}
        {body}
      </p>
      {error && (
        <div className="mt-2">
          <StatusLine message={{ kind: 'earn-payout-refused', variant: 'error', title: 'Payout not sent', body: error }} legacyTestId="earn-error" />
        </div>
      )}
      {resize && (
        <div className="mt-2">
          <StatusLine
            message={{ kind: 'earn-max-available', variant: 'paused', title: C.maxAvailableTitle, body: resize.body, action: { id: 'use-max', label: resize.label } }}
            onAction={() => void resize.onResize()}
          />
        </div>
      )}
      {phase === 'ready' && !resize && (
        <button
          type="button"
          data-testid="earn-withdraw-execute"
          onClick={() => void collect()}
          disabled={disabled}
          className="mt-3 w-full bg-[var(--accent)] py-2.5 text-[12px] font-bold uppercase tracking-[0.12em] text-white transition-[filter] hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {C.finish}
        </button>
      )}
    </div>
  );
};
