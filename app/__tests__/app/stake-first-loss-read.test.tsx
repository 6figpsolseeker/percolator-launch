/**
 * #3607: on a pool the API labels first-loss, a pending or failed chain read of the v5 pool used to show the plain
 * deposit form, whose 9-byte deposit the program refuses (33). Now: a reading line, or a read error with Try again.
 */
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { PublicKey } from "@solana/web3.js";
import { __setDevnetV22ForTest } from "@/lib/v22/flag";

const STAKE_PROGRAM = new PublicKey("Stake11111111111111111111111111111111111111");
const WALLET = new PublicKey("9xQeWvG816bUx9EPjHmaT23yvVM2ZWbrrpZb9PusVFin");
const MINT = new PublicKey("So11111111111111111111111111111111111111112");
const SLAB = new PublicKey("4Nd1mBQtrMJVYVfKf2PJy9NZUZdTAsp7D4xWLs4gDB4T");
const LP_MINT = new PublicKey("Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB");

const h = vi.hoisted(() => ({
  fetch: vi.fn(),
  poolRead: "reading" as "reading" | "failed" | "done",
  reread: vi.fn(),
  conn: { connection: { getAccountInfo: async () => null, getSlot: async () => 0, getTokenAccountBalance: async () => { throw new Error("n/a"); } } },
}));

vi.mock("@/hooks/useWalletCompat", () => ({
  useWalletCompat: () => ({ connected: true, publicKey: WALLET }),
  useConnectionCompat: () => h.conn,
}));
vi.mock("@/lib/config", async (orig) => ({ ...(await orig<Record<string, unknown>>()), getConfig: () => ({ vaultProgramId: STAKE_PROGRAM.toBase58() }) }));
vi.mock("@/hooks/useStakeFirstLoss", () => ({
  useStakeFirstLoss: () => ({ pool: null, poolRead: h.poolRead, rereadPool: h.reread, deposit: vi.fn(), loading: false, error: null }),
}));
vi.mock("@/hooks/useStakeDepositByPool", () => ({ useStakeDepositByPool: () => ({ deposit: vi.fn(), loading: false, error: null }) }));
vi.mock("@/hooks/useStakeWithdrawByPool", () => ({ useStakeWithdrawByPool: () => ({ withdraw: vi.fn(), loading: false, error: null }) }));
vi.mock("@/components/market/MarketLogo", () => ({ MarketLogo: () => null }));
vi.mock("@/components/wallet/ConnectWalletCta", () => ({ ConnectWalletCta: ({ label }: { label: string }) => <button>{label}</button> }));

import StakePage from "@/app/stake/page";

const apiPool = (stakeKind: "first-loss" | "fee-only") => ({
  poolAddress: "pool-AAA", slabAddress: SLAB.toBase58(), collateralMint: MINT.toBase58(), lpMint: LP_MINT.toBase58(), vault: LP_MINT.toBase58(),
  name: "AAA", symbol: "AAA", logoUrl: null, tvl: 1000, tvlRaw: "1000000000", poolValue: 1000, apr: 0, capTotal: 0, capTotalRaw: "0",
  capUsed: 0, capUsedRaw: "0", cooldownSlots: 0, totalLpSupply: 1_000_000_000, vaultBalance: 1000, poolMode: 0, adminTransferred: false, stakeKind,
});

beforeEach(() => {
  __setDevnetV22ForTest(true);
  h.reread.mockReset();
  vi.stubGlobal("fetch", h.fetch);
  vi.spyOn(console, "error").mockImplementation(() => {});
  Element.prototype.scrollIntoView = () => {};
});
afterEach(() => {
  cleanup();
  __setDevnetV22ForTest(null);
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

const open = async (stakeKind: "first-loss" | "fee-only") => {
  h.fetch.mockResolvedValue({ ok: true, status: 200, json: async () => ({ pools: [apiPool(stakeKind)] }) });
  render(<StakePage />);
  await screen.findAllByText("AAA");
};

describe("#3607: a first-loss pool whose chain read has not arrived", () => {
  it("while reading: a reading line, and no deposit form", async () => {
    h.poolRead = "reading";
    await open("first-loss");
    expect(await screen.findByTestId("first-loss-reading")).toBeTruthy();
    expect(screen.queryByTestId("stake-deposit-input")).toBeNull();
  });

  it("read failed: the error line with Try again, which reads the pool again; no deposit form", async () => {
    h.poolRead = "failed";
    await open("first-loss");
    const line = await screen.findByTestId("first-loss-read-error");
    expect(line.textContent).toContain("Couldn't read this pool.");
    expect(screen.queryByTestId("stake-deposit-input")).toBeNull();
    fireEvent.click(within(line).getByRole("button", { name: "Try again" }));
    expect(h.reread).toHaveBeenCalledTimes(1);
  });

  it("read, but no v5 first-loss pool on chain: says it isn't available, no deposit form", async () => {
    h.poolRead = "done";
    await open("first-loss");
    expect(await screen.findByTestId("first-loss-no-pool")).toBeTruthy();
    expect(screen.queryByTestId("stake-deposit-input")).toBeNull();
  });

  it("CONTROL: a fee-only pool still gets the plain deposit form", async () => {
    h.poolRead = "done";
    await open("fee-only");
    expect(await screen.findByTestId("stake-deposit-input")).toBeTruthy();
    expect(screen.queryByTestId("first-loss-read-error")).toBeNull();
  });
});
