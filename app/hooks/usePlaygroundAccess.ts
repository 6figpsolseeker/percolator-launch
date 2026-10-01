"use client";

import { useCallback, useEffect, useState } from "react";
import { usePrivy, useIdentityToken } from "@privy-io/react-auth";
import { usePrivyAvailable } from "@/hooks/usePrivySafe";

export type PlaygroundAccessState =
  /** Not signed in yet — the gate shows its two sign-in paths. */
  | { status: "idle" }
  | { status: "checking" }
  /**
   * Verified, inside the opening cohort. `open` is the server's launch switch
   * (PLAYGROUND_OPEN): only when it is true is "Enter Playground" offered, and
   * even then entry is re-decided server-side by /api/playground/enter.
   */
  | { status: "granted"; position: number; cutoff: number; open: boolean }
  /** On the waitlist, but further back than the cohort currently open. */
  | { status: "queued"; position: number | null; cutoff: number }
  /** Signed in, but this identity is not on the waitlist at all. */
  | { status: "not-member" }
  | { status: "error"; reason: string };

type Settled = Exclude<PlaygroundAccessState, { status: "idle" } | { status: "checking" }>;

/**
 * One in-flight / recent answer per Privy user, shared by every caller.
 *
 * The nav tab and the /playground page both ask on the same render; without
 * this they would each verify against the server. Errors are never cached, so
 * "Try again" always really tries again.
 */
const CACHE_MS = 60_000;
const cache = new Map<string, { at: number; answer: Promise<Settled> }>();

/** Test seam: forget every cached verdict. */
export function __resetPlaygroundAccessCache(): void {
  cache.clear();
}

async function ask(getAccessToken: () => Promise<string | null>, identityToken: string | null): Promise<Settled> {
  try {
    const accessToken = await getAccessToken();
    if (!accessToken) return { status: "error", reason: "no-session" };
    const headers: Record<string, string> = { Authorization: `Bearer ${accessToken}` };
    if (identityToken) headers["x-privy-id-token"] = identityToken;

    const res = await fetch("/api/playground/authorize", { method: "POST", headers, cache: "no-store" });
    const body = (await res.json().catch(() => null)) as
      | { ok?: boolean; status?: string; position?: number | null; cutoff?: number; open?: boolean }
      | null;

    if (res.ok && body?.ok === true && body.status === "granted" && typeof body.position === "number") {
      return {
        status: "granted",
        position: body.position,
        cutoff: typeof body.cutoff === "number" ? body.cutoff : 0,
        // Strictly true. Anything else — absent, "true", 1 — keeps the door shut.
        open: body.open === true,
      };
    }
    if (body?.status === "not_yet") {
      return {
        status: "queued",
        position: typeof body.position === "number" ? body.position : null,
        cutoff: typeof body.cutoff === "number" ? body.cutoff : 0,
      };
    }
    if (body?.status === "not_member") return { status: "not-member" };
    // Anything else — 401, 503, an unparseable body — is an error, NOT a
    // refusal and certainly not a grant. A refusal is final; an error is worth
    // retrying.
    return { status: "error", reason: `http-${res.status}` };
  } catch {
    return { status: "error", reason: "network" };
  }
}

/**
 * Asks the server whether this Privy identity may enter the playground.
 *
 * The decision is made ENTIRELY server-side by /api/playground/authorize. This
 * hook only relays the answer, so nothing it returns can be made true by
 * editing client state — and the door itself (/api/playground/enter)
 * re-decides from scratch anyway.
 *
 * It does NOT fall back to a permissive state on error, which is where it
 * diverges from useWaitlistWhoami: a gate that degraded to "granted" on a
 * network blip would be no gate at all.
 *
 * Must be called inside PrivyProvider; callers check usePrivyAvailable() first
 * (the nav tab does this with an inner component, the gate page renders a
 * "sign-in unavailable" state).
 */
export function usePlaygroundAccess(): {
  state: PlaygroundAccessState;
  /** Re-ask. Used by the "try again" affordance after an error. */
  recheck: () => void;
} {
  const privyAvailable = usePrivyAvailable();
  const { ready, authenticated, user, getAccessToken } = usePrivy();
  const { identityToken } = useIdentityToken();
  const [state, setState] = useState<PlaygroundAccessState>({ status: "idle" });
  const [nonce, setNonce] = useState(0);
  const userId = user?.id ?? null;

  const recheck = useCallback(() => {
    for (const k of cache.keys()) if (k.startsWith(`${userId ?? "__anon__"}|`)) cache.delete(k);
    setNonce((n) => n + 1);
  }, [userId]);

  useEffect(() => {
    if (!privyAvailable || (ready && !authenticated)) {
      setState({ status: "idle" });
      return;
    }
    if (!ready) return;

    let cancelled = false;
    // The identity token arrives a beat after sign-in, and without it the server
    // can only match on the Privy DID. Key on its presence so the richer answer
    // replaces the DID-only one instead of being shadowed by it.
    const key = `${userId ?? "__anon__"}|${identityToken ? "id" : "no-id"}`;
    const hit = cache.get(key);
    let answer: Promise<Settled>;
    if (hit && Date.now() - hit.at < CACHE_MS) {
      answer = hit.answer;
    } else {
      answer = ask(getAccessToken, identityToken ?? null);
      cache.set(key, { at: Date.now(), answer });
      answer.then((a) => {
        if (a.status === "error" && cache.get(key)?.answer === answer) cache.delete(key);
      });
    }
    setState({ status: "checking" });
    answer.then((a) => {
      if (!cancelled) setState(a);
    });
    return () => {
      cancelled = true;
    };
  }, [privyAvailable, ready, authenticated, userId, getAccessToken, identityToken, nonce]);

  return { state, recheck };
}
