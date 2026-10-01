/**
 * UX WP-3 (§4.2 mobile): the collapsed "Trade" bar of the mobile sheet shows the ticket's
 * blocked state ("Trade · Close-only"). The ticket publishes its row per market; the bar reads it.
 */
import { useSyncExternalStore } from "react";
import type { TicketRow } from "./ticket-state";

const rows = new Map<string, TicketRow>();
const listeners = new Set<() => void>();

export function publishTicketRow(slab: string, row: TicketRow | null): void {
  const prev = rows.get(slab) ?? null;
  if (prev === row) return;
  if (row === null) rows.delete(slab);
  else rows.set(slab, row);
  for (const l of listeners) l();
}

const SHORT: Partial<Record<TicketRow, string>> = {
  retired: "Closed",
  settled: "Settled",
  "admin-paused": "Paused",
  "close-only": "Close-only",
  "catching-up": "Catching up",
  "waiting-price": "Waiting for price",
  "side-paused": "One side paused",
  "both-paused": "Opening paused",
  "same-owner": "Close-only",
};

/** "Close-only" etc. for a blocked ticket, null when it can trade. */
export function ticketRowShortLabel(row: TicketRow | null | undefined): string | null {
  return row ? SHORT[row] ?? null : null;
}

export function useTicketRow(slab: string): TicketRow | null {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    () => rows.get(slab) ?? null,
    () => null,
  );
}
