// @vitest-environment node
/**
 * Earn LP-vault WITHDRAW split-pot message (issue: ExecuteRedemption Custom(25)).
 *
 * An UNBOUND Earn vault whose backing is split across the market's two sides
 * (domains) refuses a large redemption in percolator-prog handle_execute_redemption
 * with the engine's generic `EngineCounterUnderflow` (Custom 25) — the
 * `principal_portion > ledger.total_principal_atoms` gate (v16_program.rs). Confirmed
 * on devnet by simulating the real stuck redemption on SI (8WC8…): the payout is
 * priced on the COMBINED two-pot principal (1.6B + 1.0B = 2.6B) but drawn from one
 * pot (1.6B), so a redeemer holding ~100% of shares is short by ~1000 USDC.
 *
 * A BOUND vault names this VaultLpRedeemNeedsRecall and auto-repairs
 * (senior-draw-repair.ts); an UNBOUND vault has no recall path, so the error used to
 * fall through to "Something went wrong and nothing was sent." on a money screen where
 * nothing was actually sent. This pins the fix: an honest, non-alarming message on the
 * withdraw surface ONLY, with the code scoped so every other surface keeps the generic
 * internal-fault message.
 */
import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/config", () => ({
  getConfig: () => ({ network: "devnet", rpcUrl: "https://api.devnet.solana.com" }),
  getNetwork: () => "devnet",
}));

import { resolveUserMessage } from "@/lib/limits/user-message";
import { WRAPPER_ERR } from "@/lib/wrapper-errors";
import { resolveDevnetProgramIds } from "@/lib/program-ids";
import { earnErrorMessage } from "@/lib/earnErrors";

const WRAPPER = resolveDevnetProgramIds().wrapper;
const CODE = WRAPPER_ERR.EngineCounterUnderflow; // 25 = 0x19
const underflow = () => new Error(`Program ${WRAPPER} failed: custom program error: 0x${CODE.toString(16)}`);

// Banned UX terms (ux-audit §5.1) — the message must never leak internals or the raw code.
const BANNED = [
  /\bpot\b/i, /\bdomain\b/i, /backing bucket/i, /\btranche/i, /\bsenior/i, /\bjunior/i, /\bNAV\b/,
  /\brecall/i, /\bescrow/i, /\bledger/i, /underflow/i, /Custom\(\d+\)/, /\b0x[0-9a-f]+/i, /\bcode \d+/i,
  /Program error/i, /something went wrong/i,
];

describe("Earn withdraw: split-pot EngineCounterUnderflow (Custom 25)", () => {
  it("is the engine underflow code 25", () => {
    expect(CODE).toBe(25);
  });

  it("maps to an honest, actionable message on the earn-withdraw surface", () => {
    const u = resolveUserMessage(underflow(), { surface: "earn-withdraw" });
    expect(u.kind).toBe("earn-payout-split");
    expect(u.variant).toBe("paused");
    expect(u.title).toBe("Can't pay out in full");
    // Reassures: funds safe, nothing sent, still collectable.
    expect(u.body).toMatch(/nothing was sent/i);
    expect(u.body).toMatch(/ready to collect/i);
    expect(u.body).not.toMatch(/something went wrong/i);
    for (const b of BANNED) expect(u.body, String(b)).not.toMatch(b);
    // Matches the app's UX length standard (title <=5 words, body <=30).
    expect(u.title.split(/\s+/).length).toBeLessThanOrEqual(5);
    expect(u.body.split(/\s+/).length).toBeLessThanOrEqual(30);
    // The raw code stays available in details, never in the body.
    expect(u.details.code).toBe(25);
  });

  it("flows through earnErrorMessage('claim') to the same body", () => {
    const msg = earnErrorMessage(underflow(), "claim", {});
    expect(msg).toMatch(/other side/i);
    expect(msg).not.toMatch(/something went wrong/i);
  });

  it("is SCOPED: code 25 on any non-withdraw surface stays the generic internal-fault message", () => {
    // Everywhere else Custom(25) is a genuine internal-accounting fault and must NOT be
    // re-interpreted as a routine split-pot condition.
    for (const surface of ["trade", "close", "earn-deposit", "creator-stake"] as const) {
      const u = resolveUserMessage(underflow(), { surface });
      expect(u.kind, surface).toBe("unmapped");
      expect(u.body, surface).toMatch(/something went wrong/i);
    }
  });
});
