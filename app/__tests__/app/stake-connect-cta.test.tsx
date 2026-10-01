/**
 * Earn > Stake: the disconnected deposit / withdraw CTAs were plain buttons with no onClick
 * ("Connect Wallet to Deposit" did nothing). They are now ConnectWalletCta, the mode-aware
 * connect CTA the create wizard uses: on Privy (the live playground) a click opens the login
 * modal; wallet-adapter only renders the shared ConnectButton picker.
 */
import fs from "fs";
import path from "path";
import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({ privy: true, adapter: true, login: vi.fn() }));
vi.mock("@/hooks/usePrivySafe", () => ({ usePrivyAvailable: () => h.privy, usePrivyLogin: () => h.login }));
vi.mock("@/hooks/useWalletAdapterAvailable", () => ({ useWalletAdapterAvailable: () => h.adapter }));
vi.mock("@/components/wallet/ConnectButton", () => ({ ConnectButton: () => <button>picker</button> }));

import { ConnectWalletCta } from "@/components/wallet/ConnectWalletCta";

const SRC = fs.readFileSync(path.resolve(__dirname, "../../app/stake/page.tsx"), "utf8");

describe("Stake connect CTAs", () => {
  beforeEach(() => {
    h.privy = true;
    h.adapter = true;
    h.login.mockReset();
  });

  it("the stake page renders ConnectWalletCta for both, and no inert connect button is left", () => {
    expect(SRC).toContain('<ConnectWalletCta label="Connect Wallet to Deposit"');
    expect(SRC).toContain('<ConnectWalletCta label="Connect Wallet to Withdraw"');
    expect(SRC).not.toMatch(/<button[^>]*cursor-not-allowed[^>]*>\s*Connect Wallet to/);
  });

  it("Privy (the live playground): clicking opens the login modal", () => {
    render(<ConnectWalletCta label="Connect Wallet to Deposit" testId="stake-connect-deposit" />);
    fireEvent.click(screen.getByText("Connect Wallet to Deposit"));
    expect(h.login).toHaveBeenCalledTimes(1);
  });

  it("wallet-adapter only: renders the wallet picker", () => {
    h.privy = false;
    render(<ConnectWalletCta label="Connect Wallet to Withdraw" testId="stake-connect-withdraw" />);
    expect(screen.getByText("picker")).toBeTruthy();
  });
});
