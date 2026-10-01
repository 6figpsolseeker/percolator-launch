// @vitest-environment node
import { describe, it, expect, vi, afterEach } from "vitest";
import { Keypair } from "@solana/web3.js";
import { getMaintenanceConfig, DEFAULT_MAINTENANCE_MESSAGE, MaintenanceError } from "@/lib/maintenance";
import { humanizeError } from "@/lib/errorMessages";

vi.mock("@/lib/config", () => ({
  getConfig: () => ({ network: "devnet", rpcUrl: "https://api.devnet.solana.com" }),
  getNetwork: () => "devnet",
}));
import { sendTx } from "@/lib/tx";

describe("maintenance mode", () => {
  afterEach(() => vi.unstubAllEnvs());

  it("NEGATIVE CONTROL: off by default", () => {
    expect(getMaintenanceConfig()).toEqual({ active: false, message: DEFAULT_MAINTENANCE_MESSAGE, blockWrites: false });
  });
  it("env toggles banner, message and write-block", () => {
    vi.stubEnv("NEXT_PUBLIC_MAINTENANCE", "1");
    vi.stubEnv("NEXT_PUBLIC_MAINTENANCE_MESSAGE", "Back at 18:00 UTC");
    expect(getMaintenanceConfig()).toEqual({ active: true, message: "Back at 18:00 UTC", blockWrites: false });
    vi.stubEnv("NEXT_PUBLIC_MAINTENANCE_BLOCK_WRITES", "true");
    expect(getMaintenanceConfig().blockWrites).toBe(true);
  });
  it("NEGATIVE CONTROL: BLOCK_WRITES alone (banner off) blocks nothing", () => {
    vi.stubEnv("NEXT_PUBLIC_MAINTENANCE_BLOCK_WRITES", "1");
    expect(getMaintenanceConfig().blockWrites).toBe(false);
  });
  it("sendTx refuses before the wallet is asked when writes are blocked", async () => {
    vi.stubEnv("NEXT_PUBLIC_MAINTENANCE", "1");
    vi.stubEnv("NEXT_PUBLIC_MAINTENANCE_BLOCK_WRITES", "1");
    const wallet = { publicKey: Keypair.generate().publicKey, signTransaction: vi.fn() };
    const err = await sendTx({ connection: {} as never, wallet, instructions: [] }).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(MaintenanceError);
    expect(wallet.signTransaction).not.toHaveBeenCalled();
    expect(humanizeError((err as Error).message)).toMatch(/^The playground is in maintenance/);
  });
});
