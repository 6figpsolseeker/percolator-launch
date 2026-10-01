// @vitest-environment node
/**
 * A registration the launch page did not finish is re-sent on the creator's next visit, from what
 * is already on the device (the creation-tx proof + the memo-bound payload). 2026-10-01: the first
 * relaunch market (9EPm...) got six 500s from the markets write and was never enrolled.
 */
import { describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  pendingRegistrationSlabs,
  registrationCandidates,
  resumePendingRegistrations,
  saveRegisterRequest,
  type KeeperRegisterAttempt,
  type KeeperRegisterRequest,
  type KeyStore,
} from "@/lib/keeper-register-client";

const SLAB = "9EPm8nB8Fs7WcEZgE1WGFPTGc6rAzD6GhFJyMm4dEFHn";
const PROOF = "2U4TFzSboHomgWAo1REiwVMC6jA8BZR77VdeNBChnE4NvSDsghA1Bg59oJ3fP6Gzk4FTv6THAJANRoYwV5Q1PRbY";
const PAYLOAD = { slab_address: SLAB, dex_pool_address: "POOL", mainnet_ca: "CA", symbol: "TKN", max_leverage: 5.4 };

function store(init: Record<string, string> = {}): KeyStore & { m: Map<string, string> } {
  const m = new Map(Object.entries(init));
  return {
    m,
    get length() {
      return m.size;
    },
    key: (i) => [...m.keys()][i] ?? null,
    getItem: (k) => m.get(k) ?? null,
    setItem: (k, v) => void m.set(k, v),
  };
}
const launched = () => store({ [`perc.keeperProofTx.${SLAB}`]: PROOF, [`perc.keeperPayload.${SLAB}`]: JSON.stringify(PAYLOAD) });
const ok: KeeperRegisterAttempt = { registered: true, retryable: false, message: "ok" };
const memoMismatch: KeeperRegisterAttempt = { registered: false, retryable: false, message: "no matching registration memo" };
const serverDown: KeeperRegisterAttempt = { registered: false, retryable: true, message: "HTTP 500" };

describe("resume a registration the launch page did not finish", () => {
  it("payload-only launch: tries each keeper dex type; the one the memo bound registers; marked done", async () => {
    const s = launched();
    const post = vi.fn(async (r: KeeperRegisterRequest) => (r.dexType === "meteora-dlmm" ? ok : memoMismatch));
    const res = await resumePendingRegistrations({ store: s, post });
    expect(res.registered).toEqual([SLAB]);
    expect(post.mock.calls.map((c) => c[0].dexType)).toEqual(["raydium-clmm", "meteora-dlmm"]);
    const sent = post.mock.calls[1]![0];
    expect(sent).toMatchObject({ slabAddress: SLAB, dexPoolAddress: "POOL", mainnetCA: "CA", symbol: "TKN", proofTx: PROOF });
    expect(sent.payload).toEqual(PAYLOAD); // the exact bound payload, so the memo digest matches
    // Done: the next visit sends nothing.
    expect(pendingRegistrationSlabs(s)).toEqual([]);
    const again = vi.fn(async () => ok);
    await resumePendingRegistrations({ store: s, post: again });
    expect(again).not.toHaveBeenCalled();
  });

  it("a saved request is sent as is (one candidate)", () => {
    const s = launched();
    saveRegisterRequest({ slabAddress: SLAB, dexPoolAddress: "POOL", mainnetCA: "CA", dexType: "pumpswap", symbol: "TKN" }, s);
    const c = registrationCandidates(SLAB, s);
    expect(c).toHaveLength(1);
    expect(c[0]).toMatchObject({ dexType: "pumpswap", proofTx: PROOF, payload: PAYLOAD });
  });

  it("server trouble: stops, nothing marked, tried again next visit", async () => {
    const s = launched();
    const post = vi.fn(async () => serverDown);
    const res = await resumePendingRegistrations({ store: s, post });
    expect(res.retryLater).toEqual([SLAB]);
    expect(post).toHaveBeenCalledTimes(1);
    expect(pendingRegistrationSlabs(s)).toEqual([SLAB]);
  });

  it("every candidate refused (final): marked, never re-sent", async () => {
    const s = launched();
    const res = await resumePendingRegistrations({ store: s, post: async () => memoMismatch });
    expect(res.refused).toEqual([SLAB]);
    expect(pendingRegistrationSlabs(s)).toEqual([]);
  });

  it("NEGATIVE CONTROL: no proof on this device -> nothing to resume, nothing sent", async () => {
    const s = store({ [`perc.keeperPayload.${SLAB}`]: JSON.stringify(PAYLOAD) });
    const post = vi.fn(async () => ok);
    expect(pendingRegistrationSlabs(s)).toEqual([]);
    await resumePendingRegistrations({ store: s, post });
    expect(post).not.toHaveBeenCalled();
  });

  it("wiring: the launch loop saves its request and marks success; the app runs the resume once per load", () => {
    const hook = readFileSync(join(__dirname, "..", "..", "hooks", "useCreateMarket.ts"), "utf8");
    expect(hook).toMatch(/saveRegisterRequest\(\{ slabAddress: slab/);
    expect(hook).toMatch(/if \(phase === "ready"\) markRegistered\(slab\)/);
    const providers = readFileSync(join(__dirname, "..", "..", "app", "providers.tsx"), "utf8");
    expect(providers).toContain("<ResumeKeeperRegistrations />");
  });
});
