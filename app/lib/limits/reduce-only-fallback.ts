/**
 * F-3 fallback: a matcher close failed — was it the ADL reduce-only gate? True iff the
 * failure is Custom(21) (EngineLockActive) raised by the WRAPPER (or with no program log,
 * e.g. Solflare's bare JSON), AND a FRESH read of the market shows a_long or a_short !=
 * ADL_ONE. Any read failure => false (the original error is shown).
 */
import type { Connection, PublicKey } from "@solana/web3.js";
import { extractErrorCode, failingProgramId } from "@/lib/errorMessages";
import { decodeMarketEngineView } from "./decode";
import { isAdlReduceOnly } from "./adl-reduce-only";

export const ENGINE_LOCK_ACTIVE = 21;

export function isWrapperLock21(message: string, wrapperId: string): boolean {
  if (extractErrorCode(message) !== ENGINE_LOCK_ACTIVE) return false;
  const origin = failingProgramId(message);
  return origin === null || origin === wrapperId;
}

export async function isReduceOnlyLock21(
  message: string,
  connection: Pick<Connection, "getAccountInfo">,
  market: PublicKey,
  wrapperProgramId: PublicKey,
): Promise<boolean> {
  if (!isWrapperLock21(message, wrapperProgramId.toBase58())) return false;
  try {
    const info = await connection.getAccountInfo(market, "confirmed");
    if (!info) return false;
    return isAdlReduceOnly(decodeMarketEngineView(new Uint8Array(info.data)));
  } catch {
    return false;
  }
}
