/**
 * The order ticket shows "Get test funds" when the wallet holds some collateral but less than the
 * order needs (fundOverWallet), and opens this card. The card offered the faucet only at a 0
 * balance (no account: !hasTokens; account: walletBalance === 0n), so the button was a dead end.
 * offerFaucet shows it in both branches.
 */
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { PublicKey } from '@solana/web3.js';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { DepositWithdrawCard } from '@/components/trade/DepositWithdrawCard';

const mocks = vi.hoisted(() => ({
  useWalletCompat: vi.fn(),
  useConnectionCompat: vi.fn(),
  getTokenAccountBalance: vi.fn(),
  getAssociatedTokenAddressSync: vi.fn(),
  useUserAccount: vi.fn(),
  useSlabState: vi.fn(),
  useTokenMeta: vi.fn(),
  initUser: vi.fn(),
  deposit: vi.fn(),
}));

vi.mock('@/hooks/useWalletCompat', () => ({
  useWalletCompat: mocks.useWalletCompat,
  useConnectionCompat: mocks.useConnectionCompat,
}));

vi.mock('@solana/spl-token', () => ({
  getAssociatedTokenAddressSync: mocks.getAssociatedTokenAddressSync,
}));

vi.mock('@/hooks/useUserAccount', () => ({
  useUserAccount: mocks.useUserAccount,
}));

vi.mock('@/hooks/useDeposit', () => ({
  useDeposit: () => ({
    deposit: mocks.deposit,
    loading: false,
    error: null,
  }),
}));

vi.mock('@/hooks/useWithdraw', () => ({
  useWithdraw: () => ({
    withdraw: vi.fn(),
    loading: false,
    error: null,
  }),
}));

vi.mock('@/hooks/useInitUser', () => ({
  useInitUser: () => ({
    initUser: mocks.initUser,
    loading: false,
    error: null,
  }),
}));

vi.mock('@/components/providers/SlabProvider', () => ({
  useSlabState: mocks.useSlabState,
}));

vi.mock('@/hooks/useTokenMeta', () => ({
  useTokenMeta: mocks.useTokenMeta,
}));

vi.mock('@/hooks/useLivePrice', () => ({
  useLivePrice: () => ({
    priceE6: null,
  }),
}));

vi.mock('@/lib/mock-mode', () => ({
  isMockMode: () => false,
}));

vi.mock('@/lib/mock-trade-data', () => ({
  isMockSlab: () => false,
  getMockUserAccount: () => null,
}));

vi.mock('@/lib/tx', () => ({
  prewarmTxLanding: vi.fn(),
}));

vi.mock('@/components/trade/DevnetTokenFaucetButton', () => ({
  DevnetTokenFaucetButton: () => <button>faucet</button>,
}));

describe('DepositWithdrawCard: "Get test funds" opens a card that offers the faucet', () => {
  const walletA = new PublicKey('11111111111111111111111111111111');
  const walletB = new PublicKey('So11111111111111111111111111111111111111112');
  const collateralMint = new PublicKey('SysvarRent111111111111111111111111111111111');

  const connection = {
    getTokenAccountBalance: mocks.getTokenAccountBalance,
  };

  let activeWallet = walletA;

  beforeEach(() => {
    vi.clearAllMocks();

    activeWallet = walletA;

    mocks.useWalletCompat.mockImplementation(() => ({
      connected: true,
      publicKey: activeWallet,
    }));

    mocks.useConnectionCompat.mockReturnValue({
      connection,
    });

    mocks.getAssociatedTokenAddressSync.mockReturnValue(collateralMint);

    mocks.useUserAccount.mockReturnValue(null);

    mocks.useSlabState.mockReturnValue({
      config: {
        collateralMint,
      },
      params: null,
    });

    mocks.useTokenMeta.mockReturnValue({
      symbol: 'USDC',
      decimals: 6,
    });

    mocks.deposit.mockResolvedValue('deposit-signature');

    mocks.initUser.mockResolvedValue({
      sig: 'test-signature',
    });
  });

  const short = () => mocks.getTokenAccountBalance.mockResolvedValue({ value: { amount: '5000000', decimals: 6 } });
  const account = { idx: 0, pubkey: walletA, account: { capital: 1_000_000n, positionSize: 0n, entryPrice: 0n, pnl: 0n } };

  it('no account yet, some USDC: offers the faucet when asked', async () => {
    short();
    render(<DepositWithdrawCard slabAddress="test-slab" offerFaucet />);
    await waitFor(() => expect(screen.getByTestId('more-funds-faucet')).toBeInTheDocument());
    expect(screen.getByText(/Need more USDC for this order/)).toBeInTheDocument();
    expect(screen.getByText('faucet')).toBeInTheDocument();
  });

  it('CONTROL: without offerFaucet the card is unchanged (no faucet at a non-zero balance)', async () => {
    short();
    render(<DepositWithdrawCard slabAddress="test-slab" />);
    await waitFor(() => expect(screen.getByRole('button', { name: 'Create Trading Account' })).toBeInTheDocument());
    expect(screen.queryByTestId('more-funds-faucet')).toBeNull();
    expect(screen.queryByText('faucet')).toBeNull();
  });

  it('account exists, deposit tab, some USDC: offers the faucet when asked', async () => {
    short();
    mocks.useUserAccount.mockReturnValue(account);
    render(<DepositWithdrawCard slabAddress="test-slab" offerFaucet />);
    await waitFor(() => expect(screen.getByTestId('more-funds-faucet')).toBeInTheDocument());
  });

  it('the order ticket asks for it exactly when it shows "Get test funds"', () => {
    const fs = require('fs') as typeof import('fs');
    const path = require('path') as typeof import('path');
    const src = fs.readFileSync(path.resolve(__dirname, '../../../components/trade/OrderTicket.tsx'), 'utf8');
    expect(src).toContain('<DepositWithdrawCard slabAddress={slabAddress} initialMode={inlineDepositMode} offerFaucet={fundOverWallet} />');
    expect(src).toMatch(/fundOverWallet && !ticketState\.blocks\s*\?\s*"Get test funds"/);
  });
});
