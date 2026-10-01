// @vitest-environment node
/**
 * Negative-control-able regression for the 2026-10-01 keeper-register 502 (SI, 8WC8…), written
 * against ONLY the public API (`upsertRegisteredMarket`, `readRegisteredMarkets`), so the same test
 * runs against the old single-blob ETag implementation and the new versioned one.
 *
 * The fake Blob speaks both protocols (ETag + `ifMatch`, and create-only) and models the measured
 * CDN behaviour: a pathname is served from the edge's first cached copy, whatever `?ts=` says,
 * with that copy's (stale) ETag. The old implementation's CAS therefore fails on every attempt
 * after the first overwrite (the 502) and its reads miss the newest registration.
 */
import { describe, it, expect, vi } from "vitest";

const { BlobPreconditionFailedError, origin, edge, URL_BASE, nextEtag } = vi.hoisted(() => {
  class BlobPreconditionFailedError extends Error {
    constructor() {
      super("Vercel Blob: Precondition failed: ETag mismatch.");
      this.name = "BlobPreconditionFailedError";
    }
  }
  let etagSeq = 0;
  return {
    BlobPreconditionFailedError,
    origin: new Map<string, { body: string; etag: string }>(),
    edge: new Map<string, { body: string; etag: string }>(),
    URL_BASE: "https://store.public.blob.vercel-storage.com/",
    nextEtag: () => `"e${(etagSeq += 1)}"`,
  };
});

vi.mock("@vercel/blob", () => ({
  BlobPreconditionFailedError,
  list: vi.fn(async ({ prefix }: { prefix: string }) => ({
    blobs: [...origin.keys()].filter((p) => p.startsWith(prefix)).map((pathname) => ({ pathname, url: URL_BASE + pathname })),
    hasMore: false,
  })),
  put: vi.fn(async (pathname: string, body: string, opts: { allowOverwrite?: boolean; ifMatch?: string }) => {
    const cur = origin.get(pathname);
    if (opts.ifMatch !== undefined && cur?.etag !== opts.ifMatch) throw new BlobPreconditionFailedError();
    if (opts.allowOverwrite === false && cur) throw new Error("Vercel Blob: This blob already exists");
    origin.set(pathname, { body, etag: nextEtag() });
    return { url: URL_BASE + pathname, pathname };
  }),
  del: vi.fn(async (urls: string[]) => {
    for (const u of urls) origin.delete(u.slice(URL_BASE.length));
  }),
}));

globalThis.fetch = vi.fn(async (input: string | URL | Request) => {
  const href = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
  const pathname = href.slice(URL_BASE.length).split("?")[0];
  let hit = edge.get(pathname);
  if (!hit) {
    const o = origin.get(pathname);
    if (!o) return new Response("not found", { status: 404 });
    edge.set(pathname, o);
    hit = o;
  }
  return new Response(hit.body, { status: 200, headers: { etag: `W/${hit.etag}` } });
}) as typeof fetch;

import { readRegisteredMarkets, upsertRegisteredMarket, type RegisteredMarket } from "@/lib/playground-registered-markets";

const mk = (slab: string, registeredAt: number): RegisteredMarket => ({
  slabAddress: slab,
  marketAddress: slab,
  poolAddress: `pool-${slab}`,
  dexType: "pumpswap",
  symbol: slab,
  label: `${slab}/USDC`,
  mainnetCA: null,
  collateral: "DJ54k4wH92NTtNP8RuHAwG8si1bevXEknzctDdqYN8eC",
  registeredAt,
});

describe("registered-markets behind a CDN that ignores ?ts=", () => {
  it("three launches in a row all register and all read back (no 502, no hidden market)", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout"] });
    try {
      const run = async (m: RegisteredMarket) => {
        const p = upsertRegisteredMarket(m);
        await vi.runAllTimersAsync();
        return p;
      };
      await run(mk("9EPm", 1)); // first launch
      await readRegisteredMarkets(); // the GET feed warms the edge
      await run(mk("8WC8", 2)); // SI: the launch that 502'd live
      await run(mk("NEXT", 3));
      const slabs = (await readRegisteredMarkets()).map((m) => m.slabAddress).sort();
      expect(slabs).toEqual(["8WC8", "9EPm", "NEXT"]);
    } finally {
      vi.useRealTimers();
    }
  });
});
