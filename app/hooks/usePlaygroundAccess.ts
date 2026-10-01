"use client";

import { useCallback, useEffect, useState } from "react";
import { usePrivy, useIdentityToken } from "@privy-io/react-auth";
import { usePrivyAvailable } from "@/hooks/usePrivySafe";

export type PlaygroundAccessState =
  /** Not signed in yet — the gate shows its two sign-in paths. */
  | { status: "idle" }
  | { status: "checking" }
  /** Verified, inside the opening cohort. */
  | { status: "granted"; position: number }
  /** On the waitlist, but further back than the cohort currently open. */
  | { status: "queued"; position: number | null; cutoff: number }
  /** Signed in, but this identity is not on the waitlist at all. */
  | { status: "not-member" }
  | { status: "error"; reason: string };

/**
 * Asks the server whether this Privy identity may enter the playground.
 *
 * Mirrors `useWaitlistWhoami` deliberately — same auth plumbing, same
 * once-per-authentication shape — because the two answer closely related
 * questions and a second style here would be a second thing to keep in step.
 *
 * The decision is made ENTIRELY server-side by /api/playground/authorize,
 * which verifies the Privy token against Privy with the app secret. This hook
 * only relays the answer: it never decides anything itself, so nothing it
 * returns can be made true by editing client state.
 *
 * Note it does NOT fall back to a permissive state on error, which is the one
 * place it diverges from useWaitlistWhoami. That hook degrades to "not-found"
 * so a user can still sign up by hand; a gate that degraded to "granted" on a
 * network blip would be no gate at all.
 */
export function usePlaygroundAccess(): {
  state: PlaygroundAccessState;
  /** Re-ask. Used by the "try again" affordance after an error. */
  recheck: () => void;
} {
  const privyAvailable = usePrivyAvailable();
  const { ready, authenticated, getAccessToken } = usePrivy();
  const { identityToken } = useIdentityToken();
  const [state, setState] = useState<PlaygroundAccessState>({ status: "idle" });
  const [nonce, setNonce] = useState(0);

  const recheck = useCallback(() => setNonce((n) => n + 1), []);

  useEffect(() => {
    if (!privyAvailable) {
      setState({ status: "idle" });
      return;
    }
    if (!ready) return;
    if (!authenticated) {
      setState({ status: "idle" });
      return;
    }

    let cancelled = false;
    (async () => {
      setState({ status: "checking" });
      try {
        const accessToken = await getAccessToken();
        if (!accessToken) {
          if (!cancelled) setState({ status: "error", reason: "no-session" });
          return;
        }
        const headers: Record<string, string> = {
          Authorization: `Bearer ${accessToken}`,
        };
        if (identityToken) headers["x-privy-id-token"] = identityToken;

        const res = await fetch("/api/playground/authorize", {
          method: "POST",
          headers,
          cache: "no-store",
        });
        const body = (await res.json().catch(() => null)) as
          | { ok?: boolean; status?: string; position?: number | null; cutoff?: number }
          | null;
        if (cancelled) return;

        if (res.ok && body?.ok && typeof body.position === "number") {
          setState({ status: "granted", position: body.position });
          return;
        }
        if (body?.status === "not_yet") {
          setState({
            status: "queued",
            position: typeof body.position === "number" ? body.position : null,
            cutoff: typeof body.cutoff === "number" ? body.cutoff : 0,
          });
          return;
        }
        if (body?.status === "not_member") {
          setState({ status: "not-member" });
          return;
        }
        // Anything else — 401, 503, an unparseable body — is an error, NOT a
        // refusal and certainly not a grant. The distinction matters: a refusal
        // is final and a user should stop trying, an error is worth retrying.
        setState({ status: "error", reason: `http-${res.status}` });
      } catch {
        if (!cancelled) setState({ status: "error", reason: "network" });
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [privyAvailable, ready, authenticated, getAccessToken, identityToken, nonce]);

  return { state, recheck };
}
