/**
 * GH#2703: with no cached entry (the v17/v18 norm after any scale-in, reduce
 * or flip) PositionsDock fell back to the on-chain `account.pnl` and passed it
 * through computeMarkPnlCollateral. `pnl` is already collateral atoms, so the
 * row showed it multiplied by the mark. The dock must match usePortfolio /
 * PositionsBar: PnL from the pnl-derived entry, resolved against the
 * effective (ADL-adjusted) size. Fixture: real devnet v18 portfolio 2SewEcvf.
 */
import fs from "fs";
import path from "path";
import { render } from "@testing-library/react";
import { PublicKey } from "@solana/web3.js";
import { parsePortfolioV17 } from "@percolatorct/sdk";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { portfolioV17ToAccount } from "@/lib/userAccountScan";
import { ADL_ONE } from "@/lib/v17-adl";

const h = vi.hoisted(() => ({
  account: null as unknown,
  priceE6: 118_686_275n,
  insurance: 0n,
  adlFactors: null as { aLong: bigint; aShort: bigint } | null,
}));

const OWNER = new PublicKey("11111111111111111111111111111111");

vi.mock("@/hooks/useUserAccount", () => ({ useUserAccount: () => h.account }));
vi.mock("@/hooks/useNftWrappedPosition", () => ({ useNftWrappedPosition: () => null }));
vi.mock("@/hooks/useClosePosition", () => ({
  useClosePosition: () => ({ closePosition: vi.fn(), loading: false, error: null, prewarmClose: vi.fn() }),
}));
vi.mock("@/components/providers/SlabProvider", () => ({
  useSlabState: () => ({
    accounts: [],
    config: { collateralMint: OWNER, lastEffectivePriceE6: h.priceE6, invert: 0 },
    params: { maintenanceMarginBps: 500n, initialMarginBps: 1000n },
    adlFactors: h.adlFactors,
  }),
}));
vi.mock("@/hooks/useTokenMeta", () => ({ useTokenMeta: () => ({ symbol: "USDC", decimals: 6 }) }));
vi.mock("@/hooks/useLivePrice", () => ({ useLivePrice: () => ({ priceE6: h.priceE6, priceUsd: Number(h.priceE6) / 1e6 }) }));
vi.mock("@/hooks/useMarketConfig", () => ({ useMarketConfig: () => null }));
vi.mock("@/hooks/useMarketInfo", () => ({ useMarketInfo: () => ({ market: { symbol: "SOL-PERP" } }) }));
vi.mock("@/hooks/useEngineState", () => ({ useEngineState: () => ({ engine: null, insuranceBalance: h.insurance }) }));
vi.mock("@/hooks/useMarketFillCap", () => ({ useMarketFillCap: () => ({ maxFillAbs: null }) }));
vi.mock("@/hooks/useOracleFreshness", () => ({ useOracleFreshness: () => ({ level: "fresh", mode: "keeper", ready: true }) }));
vi.mock("@/hooks/useEngineFreshness", () => ({ useEngineFreshness: () => ({ engineStale: false }) }));
vi.mock("@/hooks/usePriceFlash", () => ({ usePriceFlash: () => null }));
vi.mock("@/lib/mock-mode", () => ({ isMockMode: () => false }));
vi.mock("@/lib/mock-trade-data", () => ({ isMockSlab: () => false, getMockUserAccount: () => null }));
vi.mock("@/components/dev/RenderProfiler", () => ({ RenderProfiler: ({ children }: { children: React.ReactNode }) => <>{children}</> }));
vi.mock("@/components/trade/OtherMarketPositions", () => ({ OtherMarketPositions: () => null }));
vi.mock("@/components/trade/TradeHistory", () => ({ TradeHistory: () => null }));
vi.mock("@/components/trade/WarmupProgress", () => ({ WarmupProgress: () => null }));
vi.mock("@/components/trade/ClosePositionModal", () => ({ ClosePositionModal: () => null }));

import { PositionsDock } from "@/components/trade/PositionsDock";

const f = JSON.parse(
  fs.readFileSync(path.resolve(__dirname, "../../fixtures/2SewEcvf.portfolio.json"), "utf8"),
) as { dataBase64: string };
const portfolio = parsePortfolioV17(Buffer.from(f.dataBase64, "base64"));
const fixtureAccount = portfolioV17ToAccount(portfolio);

const row = () => render(<PositionsDock slabAddress="s" />).container.textContent ?? "";

beforeEach(() => {
  localStorage.clear(); // no cached entry: the fallback path
  h.priceE6 = 118_686_275n;
  h.insurance = 0n;
  h.adlFactors = null;
  h.account = { idx: 0, pubkey: OWNER, account: fixtureAccount };
});

describe("PositionsDock PnL with no cached entry (GH#2703)", () => {
  it("2SewEcvf at $118.69: shows the PositionsBar figure, not pnl x mark", () => {
    expect(fixtureAccount.entryPrice).toBe(0n); // CONTROL: v17/v18 has no on-chain entry
    expect(fixtureAccount.pnl).toBe(4_528_764n); // CONTROL: $4.53 on-chain
    h.insurance = 28_520_000n;
    const { container } = render(<PositionsDock slabAddress="s" />);
    const text = container.textContent ?? "";
    expect(text).toContain("+4.524083");
    expect(text).not.toContain("+537.502129");
    // $4.52 is under the $28.52 insurance balance: no "payout may be capped" icon.
    expect(container.querySelector("tbody td svg")).toBeNull();
  });

  it("sub-dollar mark: a $5 loss is not deflated to cents", () => {
    h.priceE6 = 1_495n;
    h.account = {
      idx: 0,
      pubkey: OWNER,
      account: { ...fixtureAccount, capital: 100_000_000n, pnl: -5_000_000n, positionSize: 1_000_000_000_000n, adlABasis: 0n },
    };
    const text = row();
    expect(text).toContain("-4.999999");
    expect(text).not.toContain("-0.007475");
  });

  it("deleveraged leg (a_side = a_basis / 2): same figure, not half of it", () => {
    h.account = { idx: 0, pubkey: OWNER, account: { ...fixtureAccount, adlABasis: ADL_ONE } };
    h.adlFactors = { aLong: ADL_ONE, aShort: ADL_ONE / 2n };
    const text = row();
    expect(text).toContain("+4.524083");
    expect(text).not.toContain("+2.262041");
  });
});
