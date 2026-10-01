"use client";

import { useCooldownCountdown } from "@/hooks/useCooldownCountdown";
import { fmtCountdown } from "@/lib/limits/earn-withdraw";

/**
 * Live stake withdraw-lock countdown (was static "Withdraw available in N min" from the last
 * fetch, frozen until a page refresh). `onZero` re-reads the position so the button enables.
 */
export function useStakeCooldown(
  position: { cooldownRemaining: number; cooldownElapsed: boolean; lpBalanceRaw: bigint } | null,
  onZero?: () => void,
): { label: string | null; elapsed: boolean } {
  const { remainingMs } = useCooldownCountdown({
    remainingSlots: position?.cooldownRemaining ?? 0,
    elapsed: position ? position.cooldownElapsed : true,
    resetKey: position ? position.lpBalanceRaw.toString() : null,
    onZero,
  });
  if (!position || position.cooldownElapsed) return { label: null, elapsed: true };
  return { label: `Withdraw available in ${fmtCountdown(remainingMs)}`, elapsed: false };
}
