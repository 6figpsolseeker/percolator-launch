/**
 * Limits error map: P1 wrapper codes 66..71, P3 (provisional, by name),
 * matcher v2 codes 8002..8005 — each mapped ONLY when the failing program is
 * the right one (P0b `failingProgramId` parses `Program <id> failed`). Works on
 * both wallet shapes: Phantom `custom program error: 0x42` and Solflare
 * `{"InstructionError":[n,{"Custom":66}]}` (via the shared extractErrorCode).
 */
import { P2_ERROR_COPY, p3ErrorCopyByCode } from "./copy";
import { P1_ERROR_MESSAGES } from "@/lib/errorMessages";
import { P1_ERR } from "./constants";

export type ErrorOrigin = "wrapper" | "matcher" | "other" | "unknown";

export interface LimitsErrorInput {
  code: number | null;
  /** program id from the failing log line; null when the message has no log (e.g. a bare Solflare JSON). */
  originProgramId: string | null;
  wrapperId: string;
  matcherId: string;
  p3Enabled: boolean;
}

export function originOf(originProgramId: string | null, wrapperId: string, matcherId: string): ErrorOrigin {
  if (!originProgramId) return "unknown";
  if (originProgramId === wrapperId) return "wrapper";
  if (originProgramId === matcherId) return "matcher";
  return "other";
}

/**
 * Copy for a limits error, or null. A Custom(n) is decoded ONLY by the program that raised it
 * (error-codes-4b1a5d30.md: CPI callees reuse the same numbers): wrapper codes (P1 66..71, P3)
 * need a wrapper origin, matcher codes (8002..8005) a matcher origin. An UNKNOWN origin (no
 * program log, e.g. a bare Solflare InstructionError JSON) is not guessed.
 */
export function limitsErrorCopy(i: LimitsErrorInput): string | null {
  if (i.code === null) return null;
  const origin = originOf(i.originProgramId, i.wrapperId, i.matcherId);
  if (origin === "wrapper") {
    if (P1_ERROR_MESSAGES[i.code]) return P1_ERROR_MESSAGES[i.code];
    if (i.p3Enabled) {
      const p3 = p3ErrorCopyByCode()[i.code];
      if (p3) return p3;
    }
    return null;
  }
  if (origin === "matcher" && P2_ERROR_COPY[i.code]) return P2_ERROR_COPY[i.code];
  return null;
}

/** Is this a P1 "reduce the size" class error (ticket should re-read limits)? */
export function isSizeLimitError(code: number | null): boolean {
  return (
    code === P1_ERR.LpExposureCapExceeded ||
    code === P1_ERR.ProtocolSideOiCapExceeded ||
    code === P1_ERR.ExecPriceOutsideOracleBand ||
    code === P1_ERR.LpFloorHalt
  );
}

/** P3 copy for a wrapper code under the CURRENT provisional ordinals, or null. */
export function p3LimitsErrorCopy(code: number): string | null {
  return p3ErrorCopyByCode()[code] ?? null;
}

// UX WP-1: the one user-message resolver (§5.3) lives in ./user-message and is re-exported here.
export { resolveUserMessage, parseFailure } from "./user-message";
export type { UserMessage, MessageContext, StatusVariant, UserMessageAction } from "./user-message";
