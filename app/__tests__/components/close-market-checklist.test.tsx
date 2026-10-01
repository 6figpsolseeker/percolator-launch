/** UX WP-9 (audit §3.11, MM-2): close-market preconditions shown BEFORE the button. */
import { describe, expect, it } from "vitest";
import { render } from "@testing-library/react";
import { CLOSE_MARKET_COPY, closeMarketChecklist, firstUnmet } from "@/lib/close-market-checklist";
import { CloseMarketChecklistView } from "@/components/my-markets/CreatorMarketRow";

describe("close-market checklist", () => {
  it("all clear: ✓ ✓ ✓, no blocker", () => {
    const c = closeMarketChecklist({ claimableFeeAtoms: 0n, otherOpenAccounts: 0, insuranceAtoms: 0n });
    expect(firstUnmet(c)).toBeNull();
    const { getByTestId, queryByTestId } = render(<CloseMarketChecklistView checks={c} />);
    expect(getByTestId("close-market-checklist").textContent).toBe("Fees claimed ✓ · No open accounts ✓ · Insurance empty ✓");
    expect(queryByTestId("close-market-blocker")).toBeNull();
  });
  it("the FIRST unmet item is the reason line; unknown never blocks", () => {
    const c = closeMarketChecklist({ claimableFeeAtoms: 5n, otherOpenAccounts: null, insuranceAtoms: 9n });
    expect(firstUnmet(c)?.key).toBe("fees");
    const { getByTestId } = render(<CloseMarketChecklistView checks={c} />);
    expect(getByTestId("close-check-accounts").dataset.state).toBe("unknown");
    expect(getByTestId("close-market-blocker").textContent).toBe("Claim your fees first: closing the market would give them up.");
    expect(firstUnmet(closeMarketChecklist({ claimableFeeAtoms: null, otherOpenAccounts: null, insuranceAtoms: null }))).toBeNull();
    expect(firstUnmet(closeMarketChecklist({ claimableFeeAtoms: 0n, otherOpenAccounts: 2, insuranceAtoms: 1n }))?.key).toBe("accounts");
  });
  it("confirm copy (no 'closeSlab will tell you', no 'press Close again')", () => {
    expect(CLOSE_MARKET_COPY.body("WIF", "0.0521")).toBe("Close WIF market and get back ≈ 0.0521 SOL rent. You can't reopen it.");
    expect(CLOSE_MARKET_COPY.confirm).toBe("Close market · 1 approval");
  });
});
