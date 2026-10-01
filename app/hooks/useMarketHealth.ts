"use client";

import { useEffect, useMemo, useState } from "react";
import { pollWhenVisible } from "@/lib/pollWhenVisible";
import { MAX_HEALTH_SLABS } from "@/lib/market-health";
import type { MarketHealthRow } from "@/lib/market-health";

/**
 * v18 market health (LP depleted, payout haircut, lock reasons) for a set of
 * markets, from /api/markets/health. Polls every 30 s while the tab is
 * visible. Requests for the same slab set share one in-flight fetch and a
 * 10 s cache, so the trade page's banner, order ticket and error mapping cost
 * one request between them.
 */
const CACHE_MS = 10_000;
const POLL_MS = 30_000;
type HealthMap = Record<string, MarketHealthRow | null>;
const cache = new Map<string, { at: number; promise: Promise<HealthMap> }>();

export function fetchMarketHealth(slabs: readonly string[], force = false): Promise<HealthMap> {
  const key = [...new Set(slabs)].sort().slice(0, MAX_HEALTH_SLABS).join(",");
  if (!key) return Promise.resolve({});
  const hit = cache.get(key);
  if (!force && hit && Date.now() - hit.at < CACHE_MS) return hit.promise;
  // Promise.resolve().then: a missing/throwing fetch (SSR, tests) rejects instead of throwing.
  const promise = Promise.resolve()
    .then(() => fetch(`/api/markets/health?slabs=${encodeURIComponent(key)}`))
    .then(async (r) => {
      if (!r.ok) throw new Error(`health ${r.status}`);
      const body = (await r.json()) as { markets?: HealthMap };
      return body.markets ?? {};
    })
    .catch((e: unknown) => {
      cache.delete(key);
      throw e;
    });
  cache.set(key, { at: Date.now(), promise });
  return promise;
}

/** Test hook: clear the shared cache. */
export function __resetMarketHealthCache(): void {
  cache.clear();
}

export function useMarketHealth(slabs: readonly string[]): {
  health: HealthMap;
  loading: boolean;
  refresh: () => void;
} {
  const key = useMemo(() => [...new Set(slabs.filter(Boolean))].sort().join(","), [slabs]);
  const [health, setHealth] = useState<HealthMap>({});
  const [loading, setLoading] = useState<boolean>(key.length > 0);
  const [nonce, setNonce] = useState(0);

  useEffect(() => {
    if (!key) {
      setHealth({});
      setLoading(false);
      return;
    }
    let cancelled = false;
    const list = key.split(",");
    const run = (force: boolean) => {
      fetchMarketHealth(list, force)
        .then((m) => {
          if (!cancelled) setHealth(m);
        })
        .catch(() => {
          /* keep the last good value */
        })
        .finally(() => {
          if (!cancelled) setLoading(false);
        });
    };
    run(nonce > 0);
    const stop = pollWhenVisible(() => run(false), POLL_MS);
    return () => {
      cancelled = true;
      stop();
    };
  }, [key, nonce]);

  return { health, loading, refresh: () => setNonce((n) => n + 1) };
}

/** Single-market convenience. */
export function useSingleMarketHealth(slab: string | null | undefined): MarketHealthRow | null {
  const slabs = useMemo(() => (slab ? [slab] : []), [slab]);
  const { health } = useMarketHealth(slabs);
  return slab ? health[slab] ?? null : null;
}
