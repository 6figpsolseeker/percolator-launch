/**
 * UX WP-8 (audit §3.9): when Earn on a settled market pays out, as a wall-clock time. Never a slot.
 *
 * The keeper closes abandoned positions once the owners' window (`force_close_delay_slots` after
 * the resolve) has passed; the estimate is the window's remaining slots at the devnet slot time,
 * plus a margin for the keeper's sweep. Pure: the caller passes the clock.
 */

/** Devnet slot time used for every slot -> time conversion in the app. */
export const SLOT_MS = 400;
/** Allowance for the keeper's sweep after the owners' window closes. */
export const KEEPER_SWEEP_MARGIN_MS = 10 * 60_000;

export interface ResolvedEta {
  at: Date;
  /** e.g. "Tue 1 Oct, 14:30" (the viewer's locale and time zone unless given). */
  label: string;
  /** e.g. "in about 3 hours". */
  relative: string;
}

/** Estimated payout time: the rest of the owners' window (0 when it has passed) + the sweep margin. */
export function resolvedPayoutEta(p: { untilSlot: bigint | null; nowSlot: bigint; now: Date; locale?: string; timeZone?: string }): ResolvedEta {
  const left = p.untilSlot !== null && p.untilSlot > p.nowSlot ? p.untilSlot - p.nowSlot : 0n;
  const ms = Number(left) * SLOT_MS + KEEPER_SWEEP_MARGIN_MS;
  const at = new Date(p.now.getTime() + ms);
  const label = new Intl.DateTimeFormat(p.locale ?? undefined, {
    weekday: "short",
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
    timeZone: p.timeZone,
  }).format(at);
  return { at, label, relative: relativePhrase(ms) };
}

/** "in about N minutes / hours / days", rounded to one unit. */
export function relativePhrase(ms: number): string {
  const min = Math.max(1, Math.round(ms / 60_000));
  if (min < 60) return `in about ${min} minute${min === 1 ? "" : "s"}`;
  const h = Math.round(min / 60);
  if (h < 36) return `in about ${h} hour${h === 1 ? "" : "s"}`;
  const d = Math.round(h / 24);
  return `in about ${d} day${d === 1 ? "" : "s"}`;
}

/** Base fee per signature (lamports) and the rent of an owner's payout token account. */
const BASE_FEE_LAMPORTS = 5_000;
const ATA_RENT_LAMPORTS = 2_039_280;

/** "about {sol} SOL": base fees for the txs a finish broadcasts plus payout-account rent it may create. */
export function finishFeeSol(p: { txs: number; payoutAccounts: number }): string {
  const lamports = p.txs * BASE_FEE_LAMPORTS + p.payoutAccounts * ATA_RENT_LAMPORTS;
  const sol = lamports / 1e9;
  return sol < 0.001 ? "0.001" : sol.toFixed(3);
}
