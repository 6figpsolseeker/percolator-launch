// @vitest-environment node
import { describe, expect, it, vi } from "vitest";
import { Keypair, PublicKey } from "@solana/web3.js";
import { AccountLayout, ACCOUNT_SIZE, TOKEN_PROGRAM_ID } from "@solana/spl-token";

vi.mock("@percolatorct/sdk", async (orig) => ({
  ...(await orig<object>()),
  parseLpVaultRegistry: () => ({ totalLpSharesOutstanding: 2_000_000_000n, feeDistributionTotalAtoms: 0n }),
  parseLpRedemption: () => ({ shares: 100n }),
}));
vi.mock("@/lib/limits/earn-split-pot", () => ({
  readSplitPotState: async () => ({ own: {}, sib: {}, totalShares: 2_000_000_000n, feeShareBps: 1000 }),
  combinedVault: () => ({ nav: 2_002_000_000n, available: 2_002_000_000n }),
}));
import { readEarnPositions, valueShares } from "@/lib/limits/earn-positions";

const PROG = Keypair.generate().publicKey;
const WALLET = Keypair.generate().publicKey;
const tokenAcct = (amount: bigint) => {
  const d = Buffer.alloc(ACCOUNT_SIZE);
  AccountLayout.encode({ mint: PublicKey.default, owner: WALLET, amount, delegateOption: 0, delegate: PublicKey.default, state: 1, isNativeOption: 0, isNative: 0n, delegatedAmount: 0n, closeAuthorityOption: 0, closeAuthority: PublicKey.default }, d);
  return { data: d, owner: TOKEN_PROGRAM_ID, lamports: 1, executable: false };
};

describe("readEarnPositions", () => {
  it("values the wallet's LP ATA (a creator's seed) + escrow at the program NAV", async () => {
    const slab = Keypair.generate().publicKey.toBase58();
    const conn = {
      getMultipleAccountsInfo: vi.fn(async () => [tokenAcct(1_999_999_000n), { data: Buffer.alloc(8), owner: PROG }, { data: Buffer.alloc(8), owner: PROG }]),
    };
    const m = await readEarnPositions(conn as never, PROG, WALLET, [slab]);
    expect(m.get(slab)).toEqual({ shares: 1_999_999_100n, valueAtoms: valueShares(1_999_999_100n, 2_002_000_000n, 2_000_000_000n) });
  });
  it("a vault with no registry is unknown, not zero", async () => {
    const slab = Keypair.generate().publicKey.toBase58();
    const conn = { getMultipleAccountsInfo: vi.fn(async () => [null, null, null]) };
    expect((await readEarnPositions(conn as never, PROG, WALLET, [slab])).has(slab)).toBe(false);
  });
});
