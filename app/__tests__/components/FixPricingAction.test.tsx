/**
 * "Improve pricing" clarity (follow-up to #2731). Real FixPricingAction + real useFixPricing; only
 * chain I/O is mocked (LP resolution, account reads, ctx decode, sendTx).
 * Live reference (devnet, creator 9sM73A4M...): 9EPm8nB8 skew=1 (offered); 8WC8vALs and Fz5JfUcb
 * skew=0 (hidden).
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, waitFor, fireEvent, cleanup } from "@testing-library/react";
import { Keypair, PublicKey } from "@solana/web3.js";
import type { MatcherCtxView } from "@/lib/limits/decode";

const creator = Keypair.generate().publicKey;
const stranger = Keypair.generate().publicKey;

const state = {
  wallet: creator as PublicKey | null,
  skew: 1,
  sendTx: vi.fn(async (..._a: unknown[]): Promise<string> => "sig"),
};

const baseCtx = (skew: number): MatcherCtxView => ({
  kind: 1, tradingFeeBps: 5, baseSpreadBps: 50, maxTotalBps: 200, impactKBps: 200,
  liquidityNotionalE6: 11_000_000_000n, maxFillAbs: 318_748_188_930n, inventoryBase: -5_473_455_388n,
  maxInventoryAbs: 1_274_992_755_722n, feeToInsuranceBps: 0, skewSpreadMultBps: skew, v2: null,
});

// Portfolio provenance owner lives at bytes 80..112 (useFixPricing); the LP is owned by `creator`.
function portfolioBytes(): Uint8Array {
  const d = new Uint8Array(200);
  d.set(creator.toBytes(), 80);
  return d;
}

// Stable identities, like the real providers (a fresh object per render would loop the load effect).
const stableConn = { connection: { getMultipleAccountsInfo: async () => [{ data: portfolioBytes() }, { data: new Uint8Array(200) }] } };
vi.mock("@/hooks/useWalletCompat", () => ({
  useConnectionCompat: () => stableConn,
  useWalletCompat: () => ({ publicKey: state.wallet }),
}));
const stableSlab = { programId: new PublicKey("ETDLAdiAyWnEUngspYczTXUceT6X8f92eZQvr8nmSkWB") };
vi.mock("@/components/providers/SlabProvider", () => ({ useSlabState: () => stableSlab }));
vi.mock("@/hooks/useTrade", () => ({
  resolveLpTradeAccounts: async () => ({
    accountB: new PublicKey("F9YYtzdytRapfTdT4xjeHdMxnUxp1ess1ZJKbxSB7yP9"),
    matcherProg: new PublicKey("EDKKgRaVHna6FCxiY1kgMzegD9rpaN1nwJNSzAzeBUBX"),
    matcherCtx: new PublicKey("E71nQq8b5puvLqEuai8KpPu4iXCtgGZYPMrU3AjbHg95"),
  }),
}));
vi.mock("@/lib/limits/decode", () => ({ decodeMatcherCtx: () => baseCtx(state.skew) }));
// jsdom's Uint8Array realm breaks the SDK's PDA derivation; instruction encoding is covered in
// live-sdk-findings-f2-f3-c1.test.ts. Here the builder just returns a marker instruction.
vi.mock("@percolatorct/sdk", async (orig) => ({
  ...(await orig<typeof import("@percolatorct/sdk")>()),
  buildMatcherConfigureSetParamsIx: () => ({ programId: Keypair.generate().publicKey, keys: [], data: Buffer.alloc(0) }),
}));
vi.mock("@/lib/tx", () => ({ sendTx: (...a: unknown[]) => state.sendTx(...a) }));

import { FixPricingAction } from "@/components/trade/FixPricingAction";
import { FIX_PRICING_COPY, fixPricingWhat, skewOverchargeBps } from "@/lib/fix-pricing";

const SLAB = "9EPm8nB8Fs7WcEZgE1WGFPTGc6rAzD6GhFJyMm4dEFHn";
const settle = () => new Promise((r) => setTimeout(r, 30));

beforeEach(() => {
  state.wallet = creator;
  state.skew = 1;
  state.sendTx = vi.fn(async () => "sig");
});
afterEach(cleanup);

describe("FixPricingAction", () => {
  it("is offered to the creator (LP owner) while on-chain skew > 0, with the what + signature copy", async () => {
    render(<FixPricingAction slabAddress={SLAB} />);
    const body = await screen.findByTestId("status-line-body");
    expect(body.textContent).toMatch(/inventory-skew surcharge/);
    expect(body.textContent).toMatch(/units bug/);
    expect(body.textContent).toMatch(/base spread plus impact/);
    expect(body.textContent).toContain("up to ~1.45%");
    expect(body.textContent).toMatch(/updates your market's pricing settings \(matcher config\); no funds move/);
    expect(screen.getByTestId("status-line-action").textContent).toBe(FIX_PRICING_COPY.button);
  });

  it("is hidden for a non-creator wallet", async () => {
    state.wallet = stranger;
    const { container } = render(<FixPricingAction slabAddress={SLAB} />);
    await settle();
    expect(container.textContent).toBe("");
    expect(screen.queryByTestId("status-line")).toBeNull();
  });

  it("is hidden when the on-chain matcher ctx already has skew = 0", async () => {
    state.skew = 0;
    const { container } = render(<FixPricingAction slabAddress={SLAB} />);
    await settle();
    expect(container.textContent).toBe("");
  });

  it("after a successful send shows 'Pricing updated' and no longer offers the action (re-read ctx now skew 0)", async () => {
    render(<FixPricingAction slabAddress={SLAB} />);
    fireEvent.click(await screen.findByTestId("status-line-action"));
    state.skew = 0; // the chain now reports skew 0 on the post-send re-read
    await waitFor(() => expect(state.sendTx).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(screen.getByText("Pricing updated")).toBeTruthy());
    expect(screen.queryByTestId("status-line-action")).toBeNull();
    await settle();
    expect(screen.getByText("Pricing updated")).toBeTruthy();
  });
});

describe("fix-pricing copy numbers", () => {
  it("overcharge is max_total - base - fee (live 9EPm8nB8: 145 bps), not 2% on top", () => {
    expect(skewOverchargeBps(baseCtx(1))).toBe(145);
    expect(skewOverchargeBps({ maxTotalBps: 200, baseSpreadBps: 50, tradingFeeBps: 20 })).toBe(130);
    expect(skewOverchargeBps({ maxTotalBps: 40, baseSpreadBps: 50, tradingFeeBps: 5 })).toBe(0);
    expect(fixPricingWhat(baseCtx(1))).toContain("up to ~1.45%");
    expect(fixPricingWhat(null)).not.toContain("up to");
  });
});
