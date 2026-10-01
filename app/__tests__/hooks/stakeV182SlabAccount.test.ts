/**
 * percolator-stake #290 (stake v18.2): Deposit (tag 1), DepositJunior (tag 16)
 * and Withdraw (tag 2) carry the pool's wrapper market (`pool.slab`) as ONE
 * trailing account — index 11 for the deposits, index 10 for Withdraw. A v18.2
 * mode-0 deposit without it fails with NotEnoughAccountKeys.
 *
 * Uses the REAL SDK account builders (only PDA derivation is stubbed) so the
 * assertion is on the instruction the hook actually hands to sendTx.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { PublicKey, Keypair, TransactionInstruction } from '@solana/web3.js';

const { mockPool, mockVaultAuth, mockDepositPda, mockLpMint, mockVault, mockSlab } = vi.hoisted(() => {
  const { Keypair: Kp } = require('@solana/web3.js');
  return {
    mockPool: Kp.generate().publicKey,
    mockVaultAuth: Kp.generate().publicKey,
    mockDepositPda: Kp.generate().publicKey,
    mockLpMint: Kp.generate().publicKey,
    mockVault: Kp.generate().publicKey,
    mockSlab: Kp.generate().publicKey,
  };
});

vi.mock('@/hooks/useWalletCompat', () => ({
  useConnectionCompat: vi.fn(),
  useWalletCompat: vi.fn(),
}));

vi.mock('@/lib/tx', () => ({
  sendTx: vi.fn(),
}));

// PDA hashing does not run under jsdom (same reason the sibling hook tests stub it).
vi.mock('@solana/spl-token', () => {
  const { Keypair: Kp, PublicKey: PK } = require('@solana/web3.js');
  return {
    getAssociatedTokenAddress: vi.fn().mockImplementation(async () => Kp.generate().publicKey),
    createAssociatedTokenAccountInstruction: vi.fn().mockReturnValue({
      programId: new PK('ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL'),
      keys: [],
      data: Buffer.alloc(0),
    }),
  };
});

vi.mock('@percolatorct/sdk', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@percolatorct/sdk')>();
  return {
    ...actual,
    deriveStakePool: vi.fn().mockReturnValue([mockPool, 255]),
    deriveStakeVaultAuth: vi.fn().mockReturnValue([mockVaultAuth, 254]),
    deriveDepositPda: vi.fn().mockReturnValue([mockDepositPda, 253]),
  };
});

import { useStakeDepositByPool } from '../../hooks/useStakeDepositByPool';
import { useStakeDepositJunior } from '../../hooks/useStakeDepositJunior';
import { useStakeWithdrawByPool } from '../../hooks/useStakeWithdrawByPool';
import { useConnectionCompat, useWalletCompat } from '@/hooks/useWalletCompat';
import { sendTx } from '@/lib/tx';

const STAKE_PROGRAM = new PublicKey('VmpVUArRnVkrjaPXQ2qaqCQa3ZrZFgsz7rjeALitF5w');
const TOKEN_PROGRAM = new PublicKey('TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA');
const USDC = 'So11111111111111111111111111111111111111112';

/** 392-byte v2 StakePool with slab@8, lpMint@104, vault@136. */
function poolData(poolSlab: PublicKey): Buffer {
  const buf = Buffer.alloc(392);
  buf[0] = 1;
  poolSlab.toBuffer().copy(buf, 8);
  mockLpMint.toBuffer().copy(buf, 104);
  mockVault.toBuffer().copy(buf, 136);
  return buf;
}

function stakeIx(): TransactionInstruction {
  const call = (sendTx as ReturnType<typeof vi.fn>).mock.calls.at(-1);
  expect(call).toBeDefined();
  const ixs = (call as [{ instructions: TransactionInstruction[] }])[0].instructions;
  const ix = ixs.find((i) => i.programId.equals(STAKE_PROGRAM));
  expect(ix).toBeDefined();
  return ix as TransactionInstruction;
}

let poolSlabOnChain: PublicKey;

beforeEach(() => {
  vi.clearAllMocks();
  poolSlabOnChain = mockSlab;
  const connection = {
    getAccountInfo: vi.fn().mockImplementation(async (pk: PublicKey) => {
      if (pk.equals(mockPool)) return { data: poolData(poolSlabOnChain), owner: STAKE_PROGRAM };
      if (pk.equals(mockDepositPda)) return { data: Buffer.alloc(152), owner: STAKE_PROGRAM };
      // slab, ATAs: exist. LP ATA: 165-byte token account holding 10 LP.
      const d = Buffer.alloc(165);
      d.writeBigUInt64LE(10_000_000n, 64);
      return { data: d, owner: TOKEN_PROGRAM };
    }),
    getTokenAccountBalance: vi.fn().mockResolvedValue({ value: { amount: '10000000' } }),
  };
  (useConnectionCompat as ReturnType<typeof vi.fn>).mockReturnValue({ connection });
  (useWalletCompat as ReturnType<typeof vi.fn>).mockReturnValue({
    publicKey: Keypair.generate().publicKey,
    connected: true,
    signTransaction: vi.fn(),
  });
  (sendTx as ReturnType<typeof vi.fn>).mockResolvedValue('sig');
});

const params = () => ({ slabAddress: mockSlab.toBase58(), collateralMint: USDC });

describe('stake v18.2 (#290): pool.slab trailing account', () => {
  it('Deposit sends 12 accounts with pool.slab (read-only) at index 11', async () => {
    const { result } = renderHook(() => useStakeDepositByPool(params()));
    await act(async () => { await result.current.deposit(1_000_000n); });
    const ix = stakeIx();
    expect(ix.data[0]).toBe(1);
    expect(ix.keys).toHaveLength(12);
    expect(ix.keys[11].pubkey.equals(mockSlab)).toBe(true);
    expect(ix.keys[11].isWritable).toBe(false);
    expect(ix.keys[11].isSigner).toBe(false);
  });

  it('DepositJunior sends 12 accounts with pool.slab at index 11', async () => {
    const { result } = renderHook(() => useStakeDepositJunior(params()));
    await act(async () => { await result.current.deposit(1_000_000n); });
    const ix = stakeIx();
    expect(ix.data[0]).toBe(16);
    expect(ix.keys).toHaveLength(12);
    expect(ix.keys[11].pubkey.equals(mockSlab)).toBe(true);
  });

  it('Withdraw sends 11 accounts with pool.slab at index 10', async () => {
    const { result } = renderHook(() => useStakeWithdrawByPool(params()));
    await act(async () => { await result.current.withdraw(1_000n); });
    const ix = stakeIx();
    expect(ix.data[0]).toBe(2);
    expect(ix.keys).toHaveLength(11);
    expect(ix.keys[10].pubkey.equals(mockSlab)).toBe(true);
    expect(ix.keys[10].isWritable).toBe(false);
  });

  it('refuses to build when pool.slab disagrees with the selected market', async () => {
    poolSlabOnChain = Keypair.generate().publicKey;
    const { result } = renderHook(() => useStakeDepositByPool(params()));
    await act(async () => {
      await expect(result.current.deposit(1_000_000n)).rejects.toThrow(/pool\.slab mismatch/);
    });
    expect(sendTx).not.toHaveBeenCalled();
  });
});
