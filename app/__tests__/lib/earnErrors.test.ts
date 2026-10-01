import { describe, it, expect } from "vitest";
import { earnErrorMessage } from "@/lib/earnErrors";
import { resolveDevnetProgramIds } from "@/lib/program-ids";

// Error strings in the shapes the wallet/sendTx path actually produces, ATTRIBUTED to the
// wrapper by its failing-program log line (a Custom(n) is only decoded as a wrapper code when
// the wrapper raised it; error-codes-4b1a5d30.md).
const W = resolveDevnetProgramIds().wrapper;
const hex = (n: number) => new Error(`Transaction simulation failed: Error processing Instruction 2: custom program error: 0x${n.toString(16)}\nProgram ${W} failed: custom program error: 0x${n.toString(16)}`);
const json = (n: number) => new Error(`Transaction failed: {"InstructionError":[1,{"Custom":${n}}]}\nProgram ${W} failed: custom program error: 0x${n.toString(16)}`);

describe("earnErrorMessage", () => {
  it("Custom(21) on deposit says the vault is locked and nothing was deposited", () => {
    for (const e of [hex(21), json(21)]) {
      const m = earnErrorMessage(e, "deposit");
      // UX WP-1 (§5.3): calm, no jargon; the app retries on its own.
      expect(m).toMatch(/updating after a market move/i);
      expect(m).toMatch(/Nothing was deposited/);
      expect(m).not.toMatch(/0x15/);
    }
  });

  it("Custom(21) on claim: in use by open trades, the withdrawal stays ready (no jargon)", () => {
    const m = earnErrorMessage(json(21), "claim");
    expect(m).toMatch(/in use by open trades/);
    expect(m).toMatch(/stays ready to collect/);
    expect(m).not.toMatch(/escrow|unrealized PnL|backing/i);
  });

  it("Custom(19): catching up, retried automatically", () => {
    expect(earnErrorMessage(hex(19), "deposit")).toMatch(/catching up/i);
    expect(earnErrorMessage(hex(19), "claim")).toMatch(/catching up/i);
  });

  it("cooldown (36) and OI reservation (37, claim) get Earn copy", () => {
    expect(earnErrorMessage(json(36), "claim")).toMatch(/^Ready in/);
    expect(earnErrorMessage(json(37), "claim")).toMatch(/the rest as open trades close/i);
  });

  it("NotEnoughAccountKeys is reported as an app-side layout problem, not a user error", () => {
    const m = earnErrorMessage(new Error('Transaction failed: {"InstructionError":[1,"NotEnoughAccountKeys"]}'), "claim");
    expect(m).toMatch(/page is out of date/i);
    expect(m).toMatch(/Nothing was sent/);
  });

  it("small deposits and non-errors get plain copy", () => {
    expect(earnErrorMessage(json(50), "deposit")).toMatch(/too small/i);
    expect(earnErrorMessage(undefined, "deposit")).toBe("Something went wrong and nothing was sent.");
  });
});
