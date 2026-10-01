/**
 * "Crank behind" (useEngineFreshness) measures the ENGINE accrual clock
 * (`AssetStateV16Account.slot_last`) against `max_accrual_dt_slots`, on REAL
 * devnet v18 bytes (TRUMP CdN8r7FB, captured read-only at contextSlot).
 *
 * The two scenarios that separate the accrual clock from the push clock
 * (`last_good_oracle_slot`, which in AUTH_MARK only PushAuthMark advances):
 *   - crank dead, keeper pushing   → must read crank-behind (old hook: healthy)
 *   - crank live, keeper paused    → not crank-behind; the push age belongs to
 *                                    useOracleFreshness (old hook: crank-behind)
 */
import fs from "fs";
import path from "path";
import { renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { parseWrapperConfigV17, type WrapperConfigV17 } from "@percolatorct/sdk";

let slabState: Record<string, unknown> = {};
vi.mock("@/components/providers/SlabProvider", () => ({ useSlabState: () => slabState }));

const mocks = vi.hoisted(() => ({ getSlot: vi.fn() }));
vi.mock("@/hooks/useWalletCompat", () => ({
  useConnectionCompat: () => ({ connection: { getSlot: mocks.getSlot } }),
}));

import { useEngineFreshness, engineStaleSlotLag } from "@/hooks/useEngineFreshness";
import { readV17AssetSlotLast } from "@/lib/v17-engine-clock";

const fixture = JSON.parse(
  fs.readFileSync(path.resolve(__dirname, "../fixtures/CdN8r7FB.freshness.market.json"), "utf8"),
) as { contextSlot: number; dataBase64: string };
const raw = new Uint8Array(Buffer.from(fixture.dataBase64, "base64"));
const CAPTURE_SLOT = BigInt(fixture.contextSlot);
const liveCfg: WrapperConfigV17 = parseWrapperConfigV17(raw);
const SLOT_LAST = readV17AssetSlotLast(raw) as bigint;

async function run(clusterSlot: bigint, cfg: WrapperConfigV17 = liveCfg) {
  slabState = { raw, wrapperConfigV17: cfg };
  mocks.getSlot.mockResolvedValue(Number(clusterSlot));
  const hook = renderHook(() => useEngineFreshness());
  await waitFor(() => expect(hook.result.current.currentSlot).toBe(clusterSlot));
  const value = hook.result.current;
  hook.unmount();
  return value;
}

beforeEach(() => vi.clearAllMocks());

describe("useEngineFreshness — accrual clock on live bytes", () => {
  it("UX WP-2: threshold = what the app's own catch-up cranks repair (dt x 32 cranks of 25k CU; 500 -> 16,000)", () => {
    expect(engineStaleSlotLag(500n)).toBe(16_000n);
    expect(engineStaleSlotLag(null)).toBe(16_000n);
    expect(engineStaleSlotLag(1n)).toBe(32n); // floor((1.2M - 400k) / 25k crank)
  });

  it("live capture: a cranked market is not behind, lag measured from slot_last", async () => {
    const s = await run(CAPTURE_SLOT);
    expect(s.engineSlotLast).toBe(SLOT_LAST);
    expect(s.slotLag).toBe(CAPTURE_SLOT - SLOT_LAST);
    expect(s.staleSlotLag).toBe(16_000n);
    expect(s.engineStale).toBe(false);
  });

  it("crank dead while the keeper keeps pushing: a 600-slot lag is repaired in the user's tx (not a block)", async () => {
    const clusterSlot = SLOT_LAST + 600n;
    // The keeper is alive: last_good_oracle_slot is at the tip.
    const keeperAlive = { ...liveCfg, lastGoodOracleSlot: clusterSlot, markEwmaLastSlot: clusterSlot };
    const s = await run(clusterSlot, keeperAlive);
    expect(s.slotLag).toBe(600n);
    expect(s.engineStale).toBe(false);
    // beyond the catch-up cap it is (the keeper must catch up; the UI waits calmly)
    expect((await run(SLOT_LAST + 16_001n, keeperAlive)).engineStale).toBe(true);
  });

  it("crank live while the keeper is paused → NOT crank behind (oracle freshness owns push age)", async () => {
    const clusterSlot = SLOT_LAST + 20n;
    const keeperPaused = { ...liveCfg, lastGoodOracleSlot: clusterSlot - 600n, markEwmaLastSlot: clusterSlot - 600n };
    const s = await run(clusterSlot, keeperPaused);
    expect(s.engineStale).toBe(false);
  });

  it("boundary: at the threshold not stale, one slot past it stale", async () => {
    expect((await run(SLOT_LAST + 16_000n)).engineStale).toBe(false);
    expect((await run(SLOT_LAST + 16_001n)).engineStale).toBe(true);
  });

  it("unknown (no raw bytes yet) never trips the gate", async () => {
    slabState = { raw: null, wrapperConfigV17: liveCfg };
    mocks.getSlot.mockResolvedValue(Number(CAPTURE_SLOT));
    const { result, unmount } = renderHook(() => useEngineFreshness());
    await waitFor(() => expect(result.current.currentSlot).toBe(CAPTURE_SLOT));
    expect(result.current.engineStale).toBe(false);
    expect(result.current.slotLag).toBeNull();
    unmount();
  });
});
