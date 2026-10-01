/**
 * With the REAL errorMessages module (useDeposit.test.ts mocks humanizeError as identity, which
 * hid this): a deposit the hook refuses with its own explanation must show that explanation, not
 * "Something went wrong and nothing was sent." (humanizeError maps free text to the unmapped line
 * since 18f85ba9; UserFacingError is the opt-in).
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook } from "@testing-library/react";
import { act } from "react";
import { PublicKey } from "@solana/web3.js";
import { useDeposit } from "../../hooks/useDeposit";
import { UNMAPPED_MESSAGE } from "@/lib/errorMessages";

const blocked = vi.hoisted(() => ({ on: false }));

vi.mock("@/hooks/useWalletCompat", () => ({ useConnectionCompat: vi.fn(), useWalletCompat: vi.fn() }));
vi.mock("@/components/providers/SlabProvider", () => ({ useSlabState: vi.fn() }));
vi.mock("@/lib/tx", () => ({ sendTx: vi.fn() }));
vi.mock("@/lib/programAllowlist", () => ({ isKnownProgram: () => true, assertKnownProgram: () => {} }));
vi.mock("@percolatorct/sdk", async () => ({
  ...(await vi.importActual<object>("@percolatorct/sdk")),
  getAta: vi.fn().mockResolvedValue(new (await vi.importActual<typeof import("@solana/web3.js")>("@solana/web3.js")).PublicKey("DjVE6JNiYqPL2QXyCUUh8rNjHrbz9hXHNYt99MQ59qw1")),
}));
vi.mock("@/lib/blocklist", async () => ({
  ...(await vi.importActual<object>("@/lib/blocklist")),
  isBlockedSlab: () => blocked.on,
}));

import { useConnectionCompat, useWalletCompat } from "@/hooks/useWalletCompat";
import { useSlabState } from "@/components/providers/SlabProvider";

const SLAB = "11111111111111111111111111111111";
const WALLET = new PublicKey("7xKXtg2CW87d97TXJSDpbD5jBkheTqA83TZRuJosgAsU");

describe("useDeposit: the hook's own refusals reach the user", () => {
  let getAccountInfo: ReturnType<typeof vi.fn>;
  beforeEach(() => {
    vi.clearAllMocks();
    blocked.on = false;
    getAccountInfo = vi.fn().mockResolvedValue(null);
    vi.mocked(useConnectionCompat).mockReturnValue({ connection: { getAccountInfo } } as never);
    vi.mocked(useWalletCompat).mockReturnValue({ publicKey: WALLET, connected: true, signTransaction: vi.fn() } as never);
    vi.mocked(useSlabState).mockReturnValue({
      config: { collateralMint: new PublicKey("So11111111111111111111111111111111111111112"), vaultPubkey: WALLET },
      programId: new PublicKey("5BZWY6XWPxuWFxs2nPCLLsVaKRWZVnzZh3FkJDLJBkJf"),
      refresh: vi.fn(),
    } as never);
  });

  const run = async () => {
    const { result } = renderHook(() => useDeposit(SLAB));
    await act(async () => {
      await result.current.deposit({ userIdx: 1, amount: 1_000_000n }).catch(() => {});
    });
    return result.current.error;
  };

  it("market not on this network: says so, not the unmapped line", async () => {
    const error = await run();
    expect(error).toContain("Market not found on current network");
    expect(error).not.toBe(UNMAPPED_MESSAGE);
  });

  it("retired market: says deposits are disabled", async () => {
    blocked.on = true;
    const error = await run();
    expect(error).toMatch(/This market has been retired/);
    expect(getAccountInfo).not.toHaveBeenCalled();
  });
});
