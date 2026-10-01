/**
 * Limits UI render contract (plan §4 data-testids) for every new panel, driven
 * by MarketLimits fixtures (no RPC). Also pins the zero-fill copy:
 * "Market at capacity — no fill", never a success message.
 */
import { afterEach, describe, expect, it, vi } from "vitest";

// The Earn deposit panel renders a connect prompt without a wallet.
vi.mock("@/hooks/useWalletCompat", () => ({
  useWalletCompat: () => ({ connected: true, publicKey: null }),
  useConnectionCompat: () => ({ connection: {} }),
}));
import { cleanup, fireEvent, render } from "@testing-library/react";
import { OrderTicketLimits } from "@/components/limits/OrderTicketLimits";
import { MarketLimitsStripView } from "@/components/limits/MarketLimitsStrip";
import { EarnTrancheCardView } from "@/components/limits/EarnTrancheCard";
import { PositionLimitsRow } from "@/components/limits/PositionLimitsRow";
import { CreatorTranchePanelView, WizardTranchePanel } from "@/components/limits/CreatorLimits";
import { deriveTicketLimits } from "@/lib/limits/ticket";
import { earnViewFromLimits } from "@/lib/limits/earn";
import { DepositWithdrawPanel } from "@/components/earn/DepositWithdrawPanel";
import { COPY } from "@/lib/limits/copy";
import { __setLimitsFlagsForTest } from "@/lib/limits/flags";
import { marketLimits, OWNER_A, ALL_ON } from "../lib/limits/fixtures";

afterEach(() => {
  cleanup();
  __setLimitsFlagsForTest(null);
});

const ticketFor = (L = marketLimits(), direction: "long" | "short" = "long", sizeQ = 100_000_000n) =>
  deriveTicketLimits({ limits: L, direction, sizeQ, takerPosQ: 0n, takerOwner: OWNER_A, leverage: 2, limitPriceE6: 0n });

describe("OrderTicketLimits", () => {
  it("renders max size per side with raw q, the reason, and the band", () => {
    const L = marketLimits();
    const { getAllByTestId, getByTestId } = render(
      <OrderTicketLimits limits={L} ticket={ticketFor(L)} direction="long" symbol="SOL" />,
    );
    const rows = getAllByTestId("limits-max-size");
    expect(rows.map((r) => [r.dataset.side, r.dataset.maxQ, r.dataset.state])).toEqual([
      ["long", "600000000", "ready"],
      ["short", "1400000000", "ready"],
    ]);
    expect(getByTestId("limits-max-size-reason").dataset.reason).toBe("lp-exposure");
    expect(getByTestId("limits-band").dataset.bandBps).toBe("500");
  });

  it("UX WP-3: the Details half stacks NO notices (halt / same-owner / clamp / step-down / fill live in the ticket's one slot)", () => {
    const L = marketLimits({ lp: { ...marketLimits().lp!, capital: 0n }, assetAdmin: OWNER_A });
    const t = ticketFor(L);
    // the derivation still reports every one of them (the ticket state machine consumes them) ...
    expect(t.halted.long).toBe(true);
    expect(t.sameOwnerCloseOnly).toBe(true);
    expect(t.stepDown?.stepped).toBe(true);
    const { queryByTestId, getAllByTestId } = render(<OrderTicketLimits limits={L} ticket={t} direction="long" symbol="SOL" />);
    // ... but this panel only renders the per-side rows, reason and band.
    for (const id of ["limits-halt-notice", "limits-same-owner-notice", "limits-clamp-notice", "limits-stepdown-notice", "limits-fill-result", "status-line"]) {
      expect(queryByTestId(id), id).toBeNull();
    }
    expect(getAllByTestId("limits-max-size")).toHaveLength(2);
  });

  it("P2 quote panel: rows, settles-at-mark honesty note", () => {
    const L = marketLimits({ matcher: { ...marketLimits().matcher!, inventoryBase: 0n } });
    const { getByTestId, getAllByTestId } = render(
      <OrderTicketLimits limits={L} ticket={ticketFor(L)} direction="long" symbol="SOL" />,
    );
    expect(getByTestId("limits-quote").dataset.kind).toBe("adaptive");
    const rows = getAllByTestId("limits-quote-row").map((r) => r.dataset.row);
    expect(rows).toEqual(["mark", "quote", "base", "fee-adaptive", "impact", "skew", "band", "settles"]);
    expect(getByTestId("limits-quote").textContent).toContain("settle at the mark price");
  });

  it("renders nothing with all flags off", () => {
    const L = marketLimits({ state: "off" });
    const { container } = render(
      <OrderTicketLimits limits={L} ticket={ticketFor(L)} direction="long" symbol="SOL" />,
    );
    expect(container.innerHTML).toBe("");
  });
});

describe("MarketLimitsStripView", () => {
  it("OI meters, LP health, band, skew", () => {
    const { getAllByTestId, getByTestId } = render(<MarketLimitsStripView limits={marketLimits()} symbol="SOL" />);
    const meters = getAllByTestId("limits-oi-meter");
    expect(meters.map((m) => m.dataset.side)).toEqual(["long", "short"]);
    expect(getByTestId("limits-lp-health").dataset.halted).toBe("false");
    expect(getByTestId("limits-band").dataset.bandBps).toBe("500");
    expect(getByTestId("limits-skew").dataset.skewBps).toBe("-4000");
    expect(getByTestId("limits-skew").textContent).toContain("traders net long");
  });
});

/** UX_SHOTS_OUT: write the REAL card markup for scripts/ux-shots/shoot-html.mjs (375/1440). */
function snapCard(name: string) {
  const out = process.env.UX_SHOTS_OUT;
  if (!out) return;
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const fs = require("node:fs") as typeof import("node:fs");
  fs.mkdirSync(out, { recursive: true });
  fs.writeFileSync(`${out}/${name}.html`, document.querySelector("[data-testid=limits-tranche-card]")!.outerHTML);
}

describe("EarnTrancheCardView = 'How your deposit is protected' (UX WP-5, §4.4)", () => {
  it("share value 4 dp, your balance, creator stake, Earn deposits, losses shared, fees paid; no chip when covered", () => {
    const L = marketLimits();
    const { getByTestId, queryByTestId, getByText } = render(
      <EarnTrancheCardView limits={L} view={earnViewFromLimits(L, 1_000_000_000n, 100_000_000n)} slab="SLAB" withdrawShares={100_000_000n} decimals={6} collateralSymbol="USDC" />,
    );
    const card = getByTestId("limits-tranche-card");
    expect(card.textContent).toContain("How your deposit is protected");
    expect(card.dataset.status).toBe("covered");
    expect(card.dataset.valuation).toBe("certified");
    // C_eff = 1e9 + 2e6 harvestable; senior = C_eff => 1.0020
    expect(getByTestId("limits-share-price").dataset.priceE6).toBe("1002000");
    expect(getByTestId("limits-share-price").textContent).toContain("1.0020 USDC");
    expect(getByTestId("earn-your-balance").textContent).toMatch(/\$100\.20.*\(10\.00% of vault\)/);
    expect(getByTestId("limits-junior-value").textContent).toContain("covers the first losses");
    expect(getByTestId("earn-deposits-value").textContent).toContain("$1,002.00");
    expect(getByTestId("limits-earn-absorbed").textContent).toContain("$0.00");
    // AC2: "Fees paid to Earn" = senior_fee_credited_atoms
    expect(getByTestId("earn-fees-paid").dataset.atoms).toBe(L.vaultState!.seniorFeeCreditedAtoms.toString());
    expect(getByTestId("earn-fees-paid").textContent).toContain("$5.00");
    expect(queryByTestId("earn-status-chip")).toBeNull();
    expect(queryByTestId("limits-withdraw-effect")).toBeNull();
    // "How losses work" once, collapsed; §5.2 wording when open
    fireEvent.click(getByTestId("earn-how-losses-toggle"));
    expect(getByText(COPY.howLossesWork)).toBeTruthy();
    snapCard("covered");
    expect(card.textContent).not.toMatch(/tranche|senior|junior|\bLP\b|cushion|Needs refresh|APY/i);
  });

  it("covering a loss: 'Covering a loss' chip and the real (below-principal) value", () => {
    const L = marketLimits();
    const view = earnViewFromLimits(L, 800_000_000n, 0n)!; // pots + LP < the Earn claim
    expect(view.impaired).toBe(true);
    const { getByTestId } = render(<EarnTrancheCardView limits={L} view={view} slab="S" withdrawShares={0n} decimals={6} collateralSymbol="USDC" />);
    expect(getByTestId("limits-tranche-card").dataset.status).toBe("impaired");
    expect(getByTestId("earn-status-chip").textContent).toBe("Covering a loss");
    expect(getByTestId("limits-withdraw-effect").dataset.kind).toBe("impaired");
    expect(getByTestId("limits-withdraw-effect").textContent).toMatch(/below what was put in/);
    snapCard("covering-a-loss");
  });

  it("losses shared by Earn: −$X (−p%) · $Y restored, in --text (not red)", () => {
    const base = marketLimits();
    const L = marketLimits({ vaultState: { ...base.vaultState!, seniorDrawnAtoms: 1_635_213n, seniorDrawOutstandingAtoms: 635_213n } });
    const { getByTestId } = render(<EarnTrancheCardView limits={L} view={earnViewFromLimits(L, 1_000_000_000n, 0n)} slab="S3" withdrawShares={0n} decimals={6} collateralSymbol="USDC" />);
    const row = getByTestId("limits-earn-absorbed");
    expect(row.dataset.outstanding).toBe("635213");
    expect(row.dataset.drawn).toBe("1635213");
    expect(row.textContent).toMatch(/−\$0\.63.*\$1\.00 restored/);
    expect(row.innerHTML).not.toMatch(/--short/);
  });

  it("AC1: a stale certificate never shows 'Needs refresh': with a simulated value the card has numbers; without one it shows 'updating'", () => {
    const L = marketLimits({ lp: { ...marketLimits().lp!, staleState: 1 } });
    const stale = render(<EarnTrancheCardView limits={L} view={earnViewFromLimits(L, 900_000_000n, 0n)} slab="S2" withdrawShares={0n} decimals={6} collateralSymbol="USDC" valuation={{ updating: true, asOf: null }} />);
    expect(stale.getByTestId("limits-tranche-card").dataset.status).toBe("updating");
    expect(stale.getByTestId("earn-value-updating")).toBeTruthy();
    expect(stale.container.textContent).not.toMatch(/Needs refresh/);
    stale.unmount();
    const sim = { kind: "certified" as const, atoms: 120_000_000n };
    const { getByTestId } = render(
      <EarnTrancheCardView limits={L} view={earnViewFromLimits(L, 900_000_000n, 0n, undefined, sim)} slab="S2" withdrawShares={0n} decimals={6} collateralSymbol="USDC" valuation={{ updating: false, asOf: null }} />,
    );
    expect(getByTestId("limits-tranche-card").dataset.status).toBe("covered");
    expect(getByTestId("limits-share-price").dataset.priceE6).not.toBe("");
  });

  it("resolved: a calm settled line, never 'not available yet'", () => {
    const base = marketLimits();
    const L = marketLimits({ engine: { ...base.engine!, mode: 1 } });
    const { getByTestId, container } = render(<EarnTrancheCardView limits={L} view={earnViewFromLimits(L, 1_000_000_000n, 0n)} slab="S" withdrawShares={0n} decimals={6} collateralSymbol="USDC" />);
    expect(getByTestId("earn-resolved").textContent).toBe(COPY.resolvedSettled);
    expect(container.textContent).not.toMatch(/not available yet/);
    snapCard("resolved");
  });

  it("the max-now footnote shows only when it binds", () => {
    const L = marketLimits();
    const v = earnViewFromLimits(L, 1_000_000_000n, 0n);
    const a = render(<EarnTrancheCardView limits={L} view={v} slab="S" withdrawShares={100_000_000n} decimals={6} collateralSymbol="USDC" maxNowAtoms={50_000_000n} />);
    expect(a.getByTestId("limits-withdraw-effect").dataset.kind).toBe("max-now");
    a.unmount();
    const b = render(<EarnTrancheCardView limits={L} view={v} slab="S" withdrawShares={100_000_000n} decimals={6} collateralSymbol="USDC" maxNowAtoms={500_000_000n} />);
    expect(b.queryByTestId("limits-withdraw-effect")).toBeNull();
  });
});

describe("DepositWithdrawPanel deposit gate", () => {
  it("disables Deposit and shows the reason when the program would refuse", () => {
    const { getByTestId } = render(
      <DepositWithdrawPanel
        userBalance={10_000_000n}
        userLpBalance={0n}
        vaultBalance={1n}
        lpSupply={1n}
        vaultAvailable
        decimals={6}
        collateralSymbol="USDC"
        loading={false}
        cooldownElapsed
        onDeposit={async () => {}}
        onWithdraw={async () => {}}
        depositBlockedReason={COPY.depositsPausedImpaired}
        depositBlockKind="senior-impaired"
      />,
    );
    const input = getByTestId("earn-deposit-input") as HTMLInputElement;
    fireEvent.change(input, { target: { value: "1" } });
    expect((getByTestId("earn-deposit-submit") as HTMLButtonElement).disabled).toBe(true);
    const b = getByTestId("earn-deposit-blocked");
    expect(b.dataset.reason).toBe("senior-impaired");
    expect(b.textContent).toContain("covering a loss");
  });
  it("control: without a block the same deposit is enabled", () => {
    const { getByTestId, queryByTestId } = render(
      <DepositWithdrawPanel
        userBalance={10_000_000n}
        userLpBalance={0n}
        vaultBalance={1n}
        lpSupply={1n}
        vaultAvailable
        decimals={6}
        collateralSymbol="USDC"
        loading={false}
        cooldownElapsed
        onDeposit={async () => {}}
        onWithdraw={async () => {}}
      />,
    );
    fireEvent.change(getByTestId("earn-deposit-input"), { target: { value: "1" } });
    expect((getByTestId("earn-deposit-submit") as HTMLButtonElement).disabled).toBe(false);
    expect(queryByTestId("earn-deposit-blocked")).toBeNull();
  });
});

describe("Quote panel with the P2 fee channel on", () => {
  it("labels the quote as charged and shows the signed cap", () => {
    const L = marketLimits({
      matcher: { ...marketLimits().matcher!, inventoryBase: 0n },
      riskLimits: { ...marketLimits().riskLimits!, matcherExtMode: 1, maxRequestedFeeBps: 50 },
      engine: { ...marketLimits().engine!, maxTradingFeeBps: 100n },
    });
    const { getAllByTestId, getByTestId } = render(
      <OrderTicketLimits limits={L} ticket={ticketFor(L)} direction="long" symbol="SOL" />,
    );
    const row = getAllByTestId("limits-quote-row").find((r) => r.dataset.row === "fee-charged")!;
    expect(row.textContent).toContain("+31 bps");
    const cap = getByTestId("limits-fee-cap");
    expect(cap.dataset.signedBps).toBe("43");
    expect(cap.dataset.marginBps).toBe("2");
    expect(cap.textContent).toContain("Max fee you consent to");
    expect(cap.textContent).toContain("43 bps (base + quote 31 + margin 2)");
    expect(getByTestId("limits-quote").textContent).toContain("The quoted price is charged");
  });
  it("the margin is user-editable and flows into the signed cap", () => {
    const L = marketLimits({
      matcher: { ...marketLimits().matcher!, inventoryBase: 0n },
      riskLimits: { ...marketLimits().riskLimits!, matcherExtMode: 1, maxRequestedFeeBps: 50 },
      engine: { ...marketLimits().engine!, maxTradingFeeBps: 100n },
    });
    let margin = 2;
    const onChange = (b: number) => { margin = b; };
    const { getByTestId } = render(
      <OrderTicketLimits limits={L} ticket={ticketFor(L)} direction="long" symbol="SOL" clampedToQ={null} fillResult={null} requestedQ={null} feeMarginBps={2} onFeeMarginChange={onChange} />,
    );
    fireEvent.change(getByTestId("limits-fee-margin-input"), { target: { value: "5" } });
    expect(margin).toBe(5);
    fireEvent.change(getByTestId("limits-fee-margin-input"), { target: { value: "999" } });
    expect(margin).toBe(50);
  });
});

describe("PositionLimitsRow", () => {
  it("a long on a long-crowded book pays skew funding", () => {
    const { getByTestId } = render(
      <PositionLimitsRow limits={marketLimits()} positionQ={100_000_000n} priceE6={1_000_000n} marginAboveMaintAtoms={1_000n} decimals={6} collateralSymbol="USDC" />,
    );
    expect(getByTestId("limits-position-funding").dataset.direction).toBe("pay");
    expect(getByTestId("limits-liq-drift")).toBeTruthy();
  });
  it("a short receives", () => {
    const { getByTestId, queryByTestId } = render(
      <PositionLimitsRow limits={marketLimits()} positionQ={-100_000_000n} priceE6={1_000_000n} marginAboveMaintAtoms={1_000n} decimals={6} collateralSymbol="USDC" />,
    );
    expect(getByTestId("limits-position-funding").dataset.direction).toBe("receive");
    expect(queryByTestId("limits-liq-drift")).toBeNull();
  });
});

describe("Creator panels", () => {
  it("wizard tranche panel (P3 on) / hidden (off)", () => {
    __setLimitsFlagsForTest(ALL_ON);
    const { getByTestId, unmount } = render(<WizardTranchePanel juniorUnits={1000} initialMarginBps={1000} decimals={6} collateralSymbol="USDC" />);
    expect(getByTestId("limits-wizard-tranche").textContent).toContain("Largest open exposure10000 USDC"); // UX WP-7: in Details
    expect(getByTestId("limits-wizard-tranche").textContent).toContain("Your creator stake");
    unmount();
    __setLimitsFlagsForTest({ ...ALL_ON, p3: false });
    const { container } = render(<WizardTranchePanel juniorUnits={1000} initialMarginBps={1000} decimals={6} collateralSymbol="USDC" />);
    expect(container.innerHTML).toBe("");
  });
  it("creator tranche panel", () => {
    const { getByTestId } = render(
      <CreatorTranchePanelView limits={marketLimits()} slab="SLAB" backingNavAtoms={1_000_000_000n} totalShares={1_000_000_000n} creatorFeesAtoms={1_234_567n} decimals={6} collateralSymbol="USDC" />,
    );
    const p = getByTestId("limits-creator-tranche");
    expect(p.dataset.market).toBe("SLAB");
    // UX WP-9: the stake rows moved to "Your creator stake"; this card keeps fees and caps.
    expect(p.textContent).not.toContain("Junior at risk");
    expect(p.textContent).toContain("Creator fees (claimable)");
  });
});
