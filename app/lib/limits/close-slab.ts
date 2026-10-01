/**
 * P1 F4 (security review LOW): CloseSlab can return Ok WITHOUT closing — it
 * persists a fee-leg re-book (and the windowed scan's progress) as its own
 * successful step. A caller that treats Ok as "closed" reports success on a
 * slab that is still open. Classify the slab AFTER the tx:
 *   - account gone, or shrunk to the `KIND_CLOSED_MARKET` (8) tombstone => closed;
 *   - still a `KIND_MARKET` (1) account => still open: call CloseSlab again.
 * (percolator-prog feat/p1-safety-release `handle_close_slab`; tombstone =
 * `write_closed_market_tombstone`, 16-byte header, kind @10.)
 */
import { HEADER_KIND_OFF, HEADER_LEN } from "./constants";

export const KIND_MARKET = 1;
export const KIND_CLOSED_MARKET = 8;
/** CloseSlab re-sends after an Ok-without-close, beyond the first send. */
export const MAX_CLOSE_SLAB_RESENDS = 3;

export type CloseSlabState = "closed" | "still-open" | "unknown";

export function closeSlabState(data: Uint8Array | null): CloseSlabState {
  if (data === null || data.length === 0) return "closed";
  if (data.length < HEADER_LEN) return "unknown";
  const kind = data[HEADER_KIND_OFF];
  if (kind === KIND_CLOSED_MARKET) return "closed";
  if (kind === KIND_MARKET) return "still-open";
  return "unknown";
}

/**
 * The Ok-without-close loop, as a pure async driver (the hook injects I/O):
 * after the first CloseSlab `firstSig`, read the slab; while it is still open,
 * send CloseSlab again (up to `maxResends`). Returns the last signature when
 * closed, or throws `rebookedMessage` when it is still open after the bound.
 * An "unknown" read stops the loop (the caller's refresh then shows the truth;
 * never loop on a read we cannot interpret).
 */
export async function closeSlabUntilClosed(p: {
  firstSig: string;
  readState: (sig: string) => Promise<CloseSlabState>;
  resend: () => Promise<string>;
  maxResends?: number;
  rebookedMessage: string;
}): Promise<{ signature: string; resends: number; finalState: CloseSlabState }> {
  const max = p.maxResends ?? MAX_CLOSE_SLAB_RESENDS;
  let sig = p.firstSig;
  let resends = 0;
  for (;;) {
    const state = await p.readState(sig);
    if (state !== "still-open") return { signature: sig, resends, finalState: state };
    if (resends >= max) throw new Error(p.rebookedMessage);
    resends++;
    sig = await p.resend();
  }
}

/** UX WP-9 (audit §3.11, MM-2): CloseSlab re-sends pre-signed in the ONE approval. */
export const PRESIGNED_CLOSE_RESENDS = 2;

/**
 * Close a market in ONE approval: the wallet's own-portfolio cleanups, then the main tx (cranks +
 * ResolveMarket + CloseSlab, or CloseSlab alone), then up to PRESIGNED_CLOSE_RESENDS CloseSlab
 * copies (distinct compute-unit prices), all signed together. The cleanups and the main tx are
 * broadcast in order; each re-send is broadcast ONLY while the slab still reads as a live market
 * (the Ok-without-close re-book) and never after it closed. Exhausted: `rebookedMessage`.
 */
export async function closeInOneApproval<Tx>(p: {
  cleanup: readonly Tx[];
  main: Tx;
  resends: readonly Tx[];
  signAll: (txs: Tx[]) => Promise<Tx[]>;
  broadcast: (tx: Tx) => Promise<string>;
  readState: (sig: string) => Promise<CloseSlabState>;
  rebookedMessage: string;
}): Promise<{ signature: string; resends: number; finalState: CloseSlabState; cleanupSignatures: string[] }> {
  const all = [...p.cleanup, p.main, ...p.resends];
  const signed = await p.signAll(all);
  if (signed.length !== all.length) throw new Error("the wallet returned fewer signed transactions");
  const cleanupSignatures: string[] = [];
  for (let i = 0; i < p.cleanup.length; i++) cleanupSignatures.push(await p.broadcast(signed[i]!));
  let sig = await p.broadcast(signed[p.cleanup.length]!);
  const pre = signed.slice(p.cleanup.length + 1);
  let resends = 0;
  for (;;) {
    const state = await p.readState(sig);
    if (state !== "still-open") return { signature: sig, resends, finalState: state, cleanupSignatures };
    if (resends >= pre.length) throw new Error(p.rebookedMessage);
    sig = await p.broadcast(pre[resends]!);
    resends++;
  }
}
