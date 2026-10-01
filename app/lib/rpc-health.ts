/**
 * UX WP-10 (audit §4.9, RP-1): one tiny client-side store of "can we reach Solana?". The batching
 * RPC fetch (lib/batchRpc.ts) reports every outcome here. Degraded after 2 consecutive failed
 * calls, or at once on -32005 (rate limited) / -32603 (internal error); the next success clears
 * it. The ConnectionBar renders "Reconnecting to Solana…" while degraded.
 */
export const RPC_FAIL_STREAK = 2;
const IMMEDIATE_CODES = new Set([-32005, -32603]);

let streak = 0;
let degraded = false;
const listeners = new Set<() => void>();

function set(next: boolean): void {
  if (next === degraded) return;
  degraded = next;
  for (const l of listeners) l();
}

/** Report one RPC outcome: ok, or a failure (optionally with its JSON-RPC error code / HTTP 429). */
export function reportRpcOutcome(ok: boolean, code?: number | null): void {
  if (ok) {
    streak = 0;
    set(false);
    return;
  }
  streak++;
  if ((code !== undefined && code !== null && IMMEDIATE_CODES.has(code)) || streak >= RPC_FAIL_STREAK) set(true);
}

/** JSON-RPC error code in a response body, if any (a batch: the first error). */
export function rpcErrorCode(bodyJson: string): number | null {
  try {
    const v = JSON.parse(bodyJson) as unknown;
    const arr = Array.isArray(v) ? v : [v];
    for (const x of arr) {
      const c = (x as { error?: { code?: unknown } } | null)?.error?.code;
      if (typeof c === "number") return c;
    }
  } catch {
    /* not JSON */
  }
  return null;
}

export const rpcHealth = {
  subscribe(l: () => void): () => void {
    listeners.add(l);
    return () => listeners.delete(l);
  },
  getSnapshot: (): boolean => degraded,
  getServerSnapshot: (): boolean => false,
};

/** For tests only. */
export function __resetRpcHealthForTest(): void {
  streak = 0;
  degraded = false;
}
