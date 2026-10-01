"use client";

/**
 * "Enter Playground" — a top-level form POST to /api/playground/enter.
 *
 * Rendered ONLY for a member the server reported as granted while launch is
 * open, and even then it holds no destination of its own: the form posts to
 * this site, the server re-verifies from scratch, and only its 303 Location
 * header names the playground. So this markup never contains the playground's
 * address, and nobody can read one out of the DOM or the bundle.
 *
 * A real form navigation (not fetch) is what lets the server's redirect move
 * the whole tab across to the other domain. The Privy tokens are written into
 * the hidden fields at the moment of submission and cleared immediately after,
 * so they do not sit in the DOM.
 */

import { useRef, useState, type ReactNode } from "react";
import { usePrivy, useIdentityToken } from "@privy-io/react-auth";

export const ENTER_ACTION = "/api/playground/enter";

export function EnterPlaygroundButton({
  className,
  children = "Enter Playground",
}: {
  className?: string;
  children?: ReactNode;
}) {
  const { getAccessToken } = usePrivy();
  const { identityToken } = useIdentityToken();
  const formRef = useRef<HTMLFormElement>(null);
  const accessRef = useRef<HTMLInputElement>(null);
  const idRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (busy) return;
    setBusy(true);
    setFailed(false);
    let token: string | null = null;
    try {
      token = await getAccessToken();
    } catch {
      token = null;
    }
    const form = formRef.current;
    if (!token || !form || !accessRef.current || !idRef.current) {
      setBusy(false);
      setFailed(true);
      return;
    }
    accessRef.current.value = token;
    idRef.current.value = identityToken ?? "";
    // form.submit() serialises the fields synchronously and does not re-fire
    // onSubmit, so the values can be wiped straight after.
    form.submit();
    accessRef.current.value = "";
    idRef.current.value = "";
  }

  return (
    <form ref={formRef} method="post" action={ENTER_ACTION} onSubmit={onSubmit} className="contents">
      <input ref={accessRef} type="hidden" name="access_token" defaultValue="" />
      <input ref={idRef} type="hidden" name="id_token" defaultValue="" />
      <button type="submit" aria-busy={busy || undefined} disabled={busy} className={className}>
        {busy ? "Opening…" : failed ? "Sign in again" : children}
      </button>
      {failed && (
        <span role="alert" className="sr-only">
          Your session expired. Sign in again to enter.
        </span>
      )}
    </form>
  );
}
