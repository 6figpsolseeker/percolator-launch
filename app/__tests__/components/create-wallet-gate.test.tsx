/**
 * Create market, step 1 (live report 2026-10-01): without a wallet the Continue slot is a clear
 * "Connect wallet to continue" button that opens the wallet modal; with one, it is Continue.
 */
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { PrivyAvailableContext, PrivyLoginContext } from "@/hooks/usePrivySafe";

const h = vi.hoisted(() => ({ publicKey: null as null | { toBase58: () => string; equals: () => boolean } }));
vi.mock("@/hooks/useWalletCompat", () => ({
  useWalletCompat: () => ({ publicKey: h.publicKey }),
  useConnectionCompat: () => ({
    connection: {
      rpcEndpoint: "https://api.devnet.solana.com",
      getAccountInfo: vi.fn().mockResolvedValue(null),
      getParsedAccountInfo: vi.fn().mockResolvedValue({ value: null }),
    },
  }),
}));
vi.mock("@/hooks/useTokenMeta", () => ({ useTokenMeta: () => null }));
vi.mock("@/lib/config", async (orig) => ({ ...(await orig<object>()), getNetwork: () => "devnet" }));

import { StepTokenSelect } from "@/components/create/StepTokenSelect";

const step = () => (
  <StepTokenSelect
    mintAddress=""
    onMintChange={vi.fn()}
    onTokenResolved={vi.fn()}
    onBalanceChange={vi.fn()}
    onContinue={vi.fn()}
    canContinue={true}
  />
);

afterEach(() => { h.publicKey = null; });

describe("step 1 wallet gate", () => {
  it("no wallet (Privy, the live playground): 'Connect wallet to continue' opens the wallet modal; no Continue", () => {
    const login = vi.fn();
    render(
      <PrivyAvailableContext.Provider value={true}>
        <PrivyLoginContext.Provider value={login}>{step()}</PrivyLoginContext.Provider>
      </PrivyAvailableContext.Provider>,
    );
    expect(screen.queryByTestId("wizard-next")).toBeNull();
    const cta = screen.getByTestId("wizard-connect-wallet");
    expect(cta.textContent).toBe("Connect wallet to continue");
    fireEvent.click(cta);
    expect(login).toHaveBeenCalledTimes(1);
  });

  it("connected: the slot is Continue again", () => {
    h.publicKey = { toBase58: () => "G7NGnUffoo2bKBY7nGjJmSZq7rSvG4bsJpK931rGQshD", equals: () => false };
    render(<PrivyAvailableContext.Provider value={true}>{step()}</PrivyAvailableContext.Provider>);
    expect(screen.queryByTestId("wizard-connect-wallet")).toBeNull();
    expect(screen.getByTestId("wizard-next").textContent).toMatch(/CONTINUE/);
  });
});
