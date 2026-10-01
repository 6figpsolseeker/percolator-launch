// @vitest-environment node
/**
 * P1 F4: CloseSlab can return Ok WITHOUT closing (fee-leg re-book / scan progress).
 * The Reclaim flow (useCloseMarket) re-reads the slab AT the tx's slot and calls
 * CloseSlab again until it is closed (tombstone kind 8, or gone), bounded; it never
 * reports "closed" on a still-open slab. The loop is `closeSlabUntilClosed`
 * (lib/limits/close-slab.ts); the hook injects the send + the pinned read.
 */
import { describe, it, expect, vi } from "vitest";
import { Keypair } from "@solana/web3.js";
import {
  closeSlabState,
  closeInOneApproval,
  closeSlabUntilClosed,
  MAX_CLOSE_SLAB_RESENDS,
  PRESIGNED_CLOSE_RESENDS,
  type CloseSlabState,
} from "@/lib/limits/close-slab";
import { readCloseSlabStateAfter } from "@/hooks/useCloseMarket";
import { COPY } from "@/lib/limits/copy";

const SLAB = Keypair.generate().publicKey;

describe("closeSlabState", () => {
  it("gone / tombstone => closed; market => still-open; short/other => unknown", () => {
    expect(closeSlabState(null)).toBe("closed");
    const t = new Uint8Array(16);
    t[10] = 8;
    expect(closeSlabState(t)).toBe("closed");
    const m = new Uint8Array(64);
    m[10] = 1;
    expect(closeSlabState(m)).toBe("still-open");
    expect(closeSlabState(new Uint8Array(5))).toBe("unknown");
    const other = new Uint8Array(64);
    other[10] = 3;
    expect(closeSlabState(other)).toBe("unknown");
  });
});

describe("readCloseSlabStateAfter", () => {
  it("pins the read to the tx slot and classifies the bytes", async () => {
    const tomb = Buffer.alloc(16);
    tomb[10] = 8;
    const conn = {
      getSignatureStatuses: vi.fn(async () => ({ value: [{ slot: 901 }] })),
      getAccountInfo: vi.fn(async () => ({ data: tomb })),
    };
    expect(await readCloseSlabStateAfter(conn as never, SLAB, "sig1")).toBe("closed");
    expect(conn.getAccountInfo).toHaveBeenCalledWith(SLAB, { commitment: "confirmed", minContextSlot: 901 });
  });
  it("RPC failure => unknown (never loops on an unreadable state)", async () => {
    const conn = {
      getSignatureStatuses: vi.fn(async () => {
        throw new Error("429");
      }),
      getAccountInfo: vi.fn(),
    };
    expect(await readCloseSlabStateAfter(conn as never, SLAB, "s")).toBe("unknown");
  });
});

function driver(states: CloseSlabState[]) {
  let n = 0;
  const readState = vi.fn(async () => states[Math.min(n, states.length - 1)]);
  const resend = vi.fn(async () => `sig${++n + 1}`);
  return { readState, resend };
}

describe("closeSlabUntilClosed", () => {
  it("re-book on the first send => one re-send, then closed", async () => {
    const d = driver(["still-open", "closed"]);
    const r = await closeSlabUntilClosed({ firstSig: "sig1", ...d, rebookedMessage: COPY.closeRebooked });
    expect(r).toEqual({ signature: "sig2", resends: 1, finalState: "closed" });
    expect(d.resend).toHaveBeenCalledTimes(1);
    expect(d.readState).toHaveBeenNthCalledWith(1, "sig1");
    expect(d.readState).toHaveBeenNthCalledWith(2, "sig2");
  });
  it("closed on the first send => no re-send", async () => {
    const d = driver(["closed"]);
    const r = await closeSlabUntilClosed({ firstSig: "sig1", ...d, rebookedMessage: COPY.closeRebooked });
    expect(r.resends).toBe(0);
    expect(d.resend).not.toHaveBeenCalled();
  });
  it("never closes => bounded re-sends, then throws the re-book message (not success)", async () => {
    const d = driver(["still-open"]);
    await expect(
      closeSlabUntilClosed({ firstSig: "sig1", ...d, rebookedMessage: COPY.closeRebooked }),
    ).rejects.toThrow(COPY.closeRebooked);
    expect(d.resend).toHaveBeenCalledTimes(MAX_CLOSE_SLAB_RESENDS);
  });
  it("unknown read => stop without re-sending", async () => {
    const d = driver(["unknown"]);
    const r = await closeSlabUntilClosed({ firstSig: "sig1", ...d, rebookedMessage: COPY.closeRebooked });
    expect(r).toEqual({ signature: "sig1", resends: 0, finalState: "unknown" });
  });
});

/**
 * UX WP-9 AC3 (audit §3.11, MM-2): Close market = ONE prompt, including the re-book case. The
 * cleanups, the main tx and PRESIGNED_CLOSE_RESENDS CloseSlab copies are signed together; a copy
 * is broadcast only while the slab still reads as a live market.
 */
describe("closeInOneApproval: prompts counted", () => {
  const run = async (states: CloseSlabState[], cleanup = 0) => {
    const signAll = vi.fn(async (t: string[]) => t.map((x) => `signed:${x}`));
    const sent: string[] = [];
    let n = 0;
    const r = closeInOneApproval({
      cleanup: Array.from({ length: cleanup }, (_, i) => `cleanup${i}`),
      main: "main",
      resends: Array.from({ length: PRESIGNED_CLOSE_RESENDS }, (_, i) => `resend${i}`),
      signAll,
      broadcast: async (t) => {
        sent.push(t);
        return `sig:${t}`;
      },
      readState: async () => states[Math.min(n++, states.length - 1)]!,
      rebookedMessage: COPY.closeRebooked,
    });
    return { r, signAll, sent };
  };
  it("closed on the main tx: 1 prompt, no copy broadcast", async () => {
    const { r, signAll, sent } = await run(["closed"]);
    expect(await r).toMatchObject({ signature: "sig:signed:main", resends: 0, finalState: "closed" });
    expect(signAll).toHaveBeenCalledTimes(1);
    expect(signAll.mock.calls[0]![0]).toEqual(["main", "resend0", "resend1"]);
    expect(sent).toEqual(["signed:main"]);
  });
  it("re-book once: still 1 prompt; exactly one pre-signed copy broadcast", async () => {
    const { r, signAll, sent } = await run(["still-open", "closed"]);
    expect(await r).toMatchObject({ resends: 1, finalState: "closed" });
    expect(signAll).toHaveBeenCalledTimes(1);
    expect(sent).toEqual(["signed:main", "signed:resend0"]);
  });
  it("own-portfolio cleanups ride in the same prompt, broadcast first", async () => {
    const { r, signAll, sent } = await run(["closed"], 2);
    await r;
    expect(signAll).toHaveBeenCalledTimes(1);
    expect(sent).toEqual(["signed:cleanup0", "signed:cleanup1", "signed:main"]);
  });
  it("copies exhausted: the calm 'last fee sweep' line, never success; still 1 prompt", async () => {
    const { r, signAll, sent } = await run(["still-open"]);
    await expect(r).rejects.toThrow("The market is finishing its last fee sweep. Close again in a minute.");
    expect(signAll).toHaveBeenCalledTimes(1);
    expect(sent).toHaveLength(1 + PRESIGNED_CLOSE_RESENDS);
  });
  it("the hook uses the one-approval path (no per-tx signTransaction left)", async () => {
    const { readFileSync } = await import("node:fs");
    const src = readFileSync(`${process.cwd()}/hooks/useCloseMarket.ts`, "utf8");
    expect(src).toContain("closeInOneApproval({");
    expect(src).not.toMatch(/walletCompat\.signTransaction\(/);
    expect(src).not.toMatch(/signTransaction!\(/);
  });
});
