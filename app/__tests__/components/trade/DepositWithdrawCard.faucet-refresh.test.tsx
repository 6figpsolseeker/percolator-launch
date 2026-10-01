/**
 * A brand-new user clicks the faucet next to "Get tokens first, then create your account." The
 * claim used to change none of the balance effect's deps, so "Create Trading Account" never
 * appeared until a reload. invalidateWalletBalance() (sent by both faucets) re-reads it, again at
 * the follow-up offsets because /api/rpc caches getTokenAccountBalance for 1s.
 */
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { PublicKey } from '@solana/web3.js';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { DepositWithdrawCard } from '@/components/trade/DepositWithdrawCard';
import { invalidateWalletBalance } from '@/lib/wallet-balance-invalidation';

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
  DevnetTokenFaucetButton: () => null,
}));

describe('DepositWithdrawCard: a faucet claim refreshes the wallet balance', () => {
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

  it('shows Create Trading Account once a faucet claim lands, without a reload', async () => {
    mocks.getTokenAccountBalance.mockResolvedValue({ value: { amount: '0', decimals: 6 } });
    render(<DepositWithdrawCard slabAddress="test-slab" />);
    await waitFor(() => expect(screen.getByText(/Get tokens first/)).toBeInTheDocument());
    expect(screen.queryByRole('button', { name: 'Create Trading Account' })).not.toBeInTheDocument();
    const readsBefore = mocks.getTokenAccountBalance.mock.calls.length;

    mocks.getTokenAccountBalance.mockResolvedValue({ value: { amount: '10000000000', decimals: 6 } });
    await act(async () => {
      invalidateWalletBalance();
    });

    await waitFor(() => expect(screen.getByRole('button', { name: 'Create Trading Account' })).toBeInTheDocument());
    expect(screen.queryByText(/Get tokens first/)).not.toBeInTheDocument();
    expect(mocks.getTokenAccountBalance.mock.calls.length).toBeGreaterThan(readsBefore);
  });

  it('re-reads again at the follow-up offsets (the first read can hit the 1s RPC cache)', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    try {
      mocks.getTokenAccountBalance.mockResolvedValue({ value: { amount: '0', decimals: 6 } });
      render(<DepositWithdrawCard slabAddress="test-slab" />);
      await waitFor(() => expect(screen.getByText(/Get tokens first/)).toBeInTheDocument());
      await act(async () => {
        invalidateWalletBalance();
      });
      const afterImmediate = mocks.getTokenAccountBalance.mock.calls.length;
      // The cache served the old balance to the immediate read; the chain has it by the follow-up.
      mocks.getTokenAccountBalance.mockResolvedValue({ value: { amount: '10000000000', decimals: 6 } });
      await act(async () => {
        await vi.advanceTimersByTimeAsync(1500);
      });
      expect(mocks.getTokenAccountBalance.mock.calls.length).toBeGreaterThan(afterImmediate);
      await waitFor(() => expect(screen.getByRole('button', { name: 'Create Trading Account' })).toBeInTheDocument());
    } finally {
      vi.useRealTimers();
    }
  });
});
