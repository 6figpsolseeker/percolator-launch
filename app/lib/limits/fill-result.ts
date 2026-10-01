/**
 * P1 item 4: a TradeCpi can now return Ok as a ZERO fill (the wrapper clips
 * the request to LP headroom; `size 0` commits the req_id and returns Ok) or
 * a PARTIAL fill. So tx success no longer means "position changed by the
 * requested size" (security review LOW, zero-fill UI coupling). Classify by
 * the MEASURED position delta.
 */
export type FillKind = "full" | "partial" | "zero" | "unknown";

export interface FillResult {
  kind: FillKind;
  /** Signed measured delta (after − before); null when unknown. */
  filledQ: bigint | null;
}

/**
 * `requestedQ` is signed (the taker's requested delta). `afterQ === null`
 * (post-trade read failed) => unknown: the caller must NOT patch local state
 * with the requested size.
 */
export function classifyFill(beforeQ: bigint, afterQ: bigint | null, requestedQ: bigint): FillResult {
  if (afterQ === null || requestedQ === 0n) return { kind: "unknown", filledQ: null };
  const d = afterQ - beforeQ;
  if (d === 0n) return { kind: "zero", filledQ: 0n };
  const sameDir = (d > 0n) === (requestedQ > 0n);
  const absD = d < 0n ? -d : d;
  const absR = requestedQ < 0n ? -requestedQ : requestedQ;
  if (!sameDir) return { kind: "unknown", filledQ: d };
  if (absD >= absR) return { kind: "full", filledQ: d };
  return { kind: "partial", filledQ: d };
}

/** Thrown by a close whose confirmed TradeCpi filled nothing (P1 zero fill). */
export class ZeroFillError extends Error {
  readonly zeroFill = true;
  constructor(message: string) {
    super(message);
    this.name = "ZeroFillError";
  }
}

export function isZeroFillError(e: unknown): e is ZeroFillError {
  return e instanceof ZeroFillError || (typeof e === "object" && e !== null && (e as { zeroFill?: unknown }).zeroFill === true);
}

/**
 * What a CONFIRMED close means, from its measured fill: a zero fill is not a
 * close (the caller must keep the modal open and say so — never "closed");
 * a partial fill closed only part of it; unknown/null = the legacy path
 * (P1 flag off, or the post-trade read could not be pinned).
 */
export function closeOutcome(fill: FillResult | null): "closed" | "partial" | "no-fill" {
  if (!fill) return "closed";
  if (fill.kind === "zero") return "no-fill";
  if (fill.kind === "partial") return "partial";
  return "closed";
}
