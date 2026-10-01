"use client";

import { useEffect, useRef, useState } from "react";
import { SLOT_MS } from "@/lib/limits/earn-withdraw";

/** A re-read that moves the deadline LATER by less than this is slot-read lag, not a new ticket. */
export const LATER_RESET_TOLERANCE_MS = 15_000;

/**
 * A live cooldown countdown (Earn redemption, Stake withdraw lock).
 *
 * Live report 2026-10-01: after a withdrawal request the timer sat still until a page refresh.
 * The chain only tells us "N slots remain" at each 10 s poll, and every poll used to re-anchor
 * the local deadline; a poll whose slot read lags (finalized / cached) pushes it LATER, so the
 * clock kept snapping back and read as frozen (and Stake never ticked at all — it rendered the
 * last poll's slot count as static text).
 *
 * Rules: the deadline is set when the ticket (`resetKey`) changes or the countdown starts;
 * a later re-read only moves it EARLIER (or later by more than LATER_RESET_TOLERANCE_MS — a
 * genuinely new ticket); it ticks every second; at 0 it calls `onZero` (throttled to 2 s) until
 * the chain reports `elapsed`.
 */
export function useCooldownCountdown(p: {
  remainingSlots: number | bigint;
  elapsed: boolean;
  resetKey?: string | number | bigint | null;
  onZero?: () => void;
}): { remainingMs: number; done: boolean } {
  const rem = Number(p.remainingSlots);
  const [now, setNow] = useState(() => Date.now());
  const deadline = useRef<number | null>(null);
  const key = useRef<unknown>(undefined);
  const lastZeroCall = useRef(0);

  // Re-anchor only on a NEW reading (the remaining-slot value or the ticket changed), never on a
  // plain re-render: recomputing "now + remaining" every render drifts the deadline later by the
  // time elapsed since the reading, which is exactly the frozen clock.
  const lastRem = useRef<number | null>(null);
  if (p.elapsed) {
    deadline.current = null;
    lastRem.current = null;
  } else if (deadline.current === null || key.current !== p.resetKey || lastRem.current !== rem) {
    const candidate = Date.now() + rem * SLOT_MS;
    if (
      deadline.current === null ||
      key.current !== p.resetKey ||
      candidate < deadline.current - 1_000 ||
      candidate > deadline.current + LATER_RESET_TOLERANCE_MS
    ) {
      deadline.current = candidate;
    }
    lastRem.current = rem;
  }
  key.current = p.resetKey;

  useEffect(() => {
    if (p.elapsed) return;
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [p.elapsed]);

  const remainingMs = p.elapsed || deadline.current === null ? 0 : Math.max(0, deadline.current - now);
  const onZero = p.onZero;
  useEffect(() => {
    if (p.elapsed || remainingMs > 0 || !onZero) return;
    if (now - lastZeroCall.current < 2000) return;
    lastZeroCall.current = now;
    onZero();
  }, [p.elapsed, remainingMs, now, onZero]);

  return { remainingMs, done: p.elapsed };
}
