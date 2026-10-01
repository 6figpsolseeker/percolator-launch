/**
 * Partial resolved payouts (P3 wrapper ordering). A trader whose CloseResolved (30) runs BEFORE
 * the vault LP's 101 VaultLpSettleResolved has finished gets a PARTIAL payout receipt: the rest
 * arrives only through the permissionless tag-46 ClaimResolvedPayoutTopup, and only after the
 * vault LP has settled. No money is lost; it is purely ordering.
 *
 * So the app:
 *   - orders "Finish now" as 101 until final -> 46 (the viewer's own receipt first, then any other
 *     open receipt) -> the rest -> the viewer's 76 (lib/limits/resolved-finish.ts);
 *   - shows one calm line while the viewer's receipt is partial (COPY.resolvedExit.partialReceipt);
 *   - once 101 has closed, bundles the viewer's 46 into their next Earn transaction on that market
 *     (hooks/useInsuranceLP) and puts it first in the settled-market panel's "Finish now".
 * The 46 is sim-gated before it rides along: a refused top-up never costs the user's own tx.
 *
 * "Ready" is the planner's word, not a guess: planResolvedExit emits a claim-topup step for a
 * portfolio only once no vault LP is still materialized and the owners' window has passed.
 */
import { ComputeBudgetProgram, PublicKey, Transaction, type TransactionInstruction } from "@solana/web3.js";
import type { ExitPortfolio, ExitStep, ResolvedExitPlan } from "./resolved-exit";

export type ViewerReceipt = "none" | "partial-waiting" | "partial-ready";

const receiptOpen = (p: ExitPortfolio): boolean => p.view.receiptPresent && !p.view.receiptFinalized;

/** Keys of the non-vault portfolios the viewer owns (none without a viewer). */
export function viewerOwnedKeys(portfolios: readonly ExitPortfolio[], viewer: PublicKey | string | null): Set<string> {
  const out = new Set<string>();
  if (!viewer) return out;
  const v = typeof viewer === "string" ? viewer : viewer.toBase58();
  for (const p of portfolios) if (!p.isVaultLp && new PublicKey(p.view.owner).toBase58() === v) out.add(p.key);
  return out;
}

/** The viewer's own claim-topup (46) steps the plan can run NOW (101 has closed). */
export function viewerTopupSteps(plan: ResolvedExitPlan, portfolios: readonly ExitPortfolio[], viewer: PublicKey | string | null): Extract<ExitStep, { kind: "claim-topup" }>[] {
  if (plan.phase !== "sweep") return [];
  const own = viewerOwnedKeys(portfolios, viewer);
  const out: Extract<ExitStep, { kind: "claim-topup" }>[] = [];
  for (const s of plan.steps) if (s.kind === "claim-topup" && own.has(s.portfolio)) out.push(s);
  return out;
}

/** Is the viewer's resolved payout partial, and can the rest be claimed now? */
export function viewerReceiptStatus(plan: ResolvedExitPlan | null, portfolios: readonly ExitPortfolio[], viewer: PublicKey | string | null): ViewerReceipt {
  if (!plan || plan.phase === "not-resolved") return "none";
  const own = viewerOwnedKeys(portfolios, viewer);
  const open = portfolios.some((p) => own.has(p.key) && receiptOpen(p));
  if (!open) return "none";
  return viewerTopupSteps(plan, portfolios, viewer).length > 0 ? "partial-ready" : "partial-waiting";
}

/** Solana's packet limit for a serialized transaction. */
export const PACKET_DATA_SIZE = 1232;

/**
 * Serialized size of `ixs` as sendTx will finally send them: heap frame + CU limit + CU price
 * (the gate simulation only carries two of these, so it can pass a tx the wallet then can't sign).
 */
export function finalTxWireSize(ixs: readonly TransactionInstruction[], feePayer: PublicKey): number {
  const tx = new Transaction();
  tx.add(
    ComputeBudgetProgram.requestHeapFrame({ bytes: 131072 }),
    ComputeBudgetProgram.setComputeUnitLimit({ units: 1_400_000 }),
    ComputeBudgetProgram.setComputeUnitPrice({ microLamports: 1_000_000 }),
    ...ixs,
  );
  tx.feePayer = feePayer;
  tx.recentBlockhash = PublicKey.default.toBase58();
  const msg = tx.serializeMessage();
  const numSigners = msg[0];
  return 1 + 64 * numSigners + msg.length; // shortvec sig count (< 128) + signatures + message
}

/**
 * Review of #2721: the first `droppable` topup ixs (the empty-portfolio closes) are optional. Drop
 * trailing ones until the FINAL tx (+ `reserveBytes` for self-heal repairs) fits the packet; if even
 * the bare topup does not fit, return null (send the user's tx alone).
 */
export function fitTopupToPacket(
  topup: readonly TransactionInstruction[],
  base: readonly TransactionInstruction[],
  droppable: number,
  feePayer: PublicKey,
  reserveBytes = 0,
): TransactionInstruction[] | null {
  const keep = topup.slice(droppable);
  for (let n = Math.min(droppable, topup.length); n >= 0; n -= 1) {
    const candidate = [...topup.slice(0, n), ...keep];
    if (finalTxWireSize([...candidate, ...base], feePayer) + reserveBytes <= PACKET_DATA_SIZE) return candidate;
  }
  return null;
}

/**
 * Send `base` with a prefix (the viewer's top-up, empty-portfolio closes) in front when there is
 * one. A prefix that makes the tx fail its pre-sign simulation (`isPreSignRefusal`: the wallet
 * never opened) is dropped and the user's own tx is sent alone, so bundling can never cost the
 * user their tx; if that refuses too, the bundled refusal is the one reported.
 */
export async function sendWithTopup<T>(p: {
  topup: readonly TransactionInstruction[];
  base: TransactionInstruction[];
  send: (ixs: TransactionInstruction[], bundled: boolean) => Promise<T>;
  isPreSignRefusal: (e: unknown) => boolean;
  /** Packet gate (review of #2721): fee payer, leading droppable topup ixs, bytes reserved for repairs. */
  packet?: { feePayer: PublicKey; droppable: number; reserveBytes?: number };
}): Promise<T> {
  if (p.topup.length === 0) return p.send(p.base, false);
  let topup: readonly TransactionInstruction[] = p.topup;
  if (p.packet) {
    try {
      topup = fitTopupToPacket(p.topup, p.base, p.packet.droppable, p.packet.feePayer, p.packet.reserveBytes) ?? [];
    } catch {
      topup = []; // the size estimate itself failed: never risk an unsignable bundle, send the user's tx alone
    }
  }
  if (topup.length === 0) return p.send(p.base, false);
  let bundledErr: unknown;
  try {
    return await p.send([...topup, ...p.base], true);
  } catch (e) {
    if (!p.isPreSignRefusal(e)) throw e;
    bundledErr = e;
  }
  try {
    return await p.send(p.base, false);
  } catch (e) {
    // Both refused before the wallet opened: report the BUNDLED refusal. It is the one that got
    // further (e.g. the closes landed in simulation and the payout then asked for 78 with 84), so
    // a caller's own retry rule (sendWithHarvestOn84) can act on it; the user's tx alone would
    // only say 21 "not terminal-flat".
    if (p.isPreSignRefusal(e)) throw bundledErr;
    throw e;
  }
}
