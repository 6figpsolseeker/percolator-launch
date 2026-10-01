/**
 * UX WP-9 (audit §3.14, ST-1): stake cooldown as a time, never slots ("Withdraw available in
 * 2 min" / "Ready"), and the stake's own sidebar line (not Earn's "Redeem LP tokens…").
 */
import { SLOT_MS } from "@/lib/limits/resolved-eta";

/** "40 s", "2 min", "3 h", "2 days" from a slot count (devnet slot time). */
export function cooldownDuration(slots: number): string {
  const s = Math.max(1, Math.round((Math.max(0, slots) * SLOT_MS) / 1000));
  if (s < 60) return `${s} s`;
  const m = Math.round(s / 60);
  if (m < 90) return `${m} min`;
  const h = Math.round(m / 60);
  if (h < 36) return `${h} h`;
  return `${Math.round(h / 24)} days`;
}

export const STAKE_COPY = {
  ready: "Ready",
  availableIn: (slots: number) => `Withdraw available in ${cooldownDuration(slots)}`,
  period: (slots: number) => `Cooldown: ${cooldownDuration(slots)} before you can withdraw.`,
  sidebar: "Stake pays you a share of every trading fee. Your stake is first-loss for this market's insurance, so its value can fall.",
} as const;
