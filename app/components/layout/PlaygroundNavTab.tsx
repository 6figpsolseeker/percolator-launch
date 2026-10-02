"use client";

/**
 * The Playground tab in the main-site header.
 *
 * Everyone sees a plain "Playground" link to /playground — the waitlist gate page, which signs
 * people in (wallet or email), shows their position, and offers "Enter Playground" to members.
 * The devnet v2 app's own address is never in this markup or any client bundle; the only place
 * it is emitted is the server's redirect after a fresh grant (/api/playground/enter).
 *
 * A member the server has GRANTED while launch is open (PLAYGROUND_OPEN=true) sees
 * "Enter Playground" here directly — a form POST to /api/playground/enter, which re-verifies.
 */

import Link from "next/link";
import { usePrivyAvailable } from "@/hooks/usePrivySafe";
import { usePlaygroundAccess } from "@/hooks/usePlaygroundAccess";
import { EnterPlaygroundButton } from "@/components/playground/EnterPlaygroundButton";

const TAB_CLASS = [
  "group relative inline-flex min-h-9 items-center gap-1.5 rounded-md px-3 py-1.5",
  "text-[13px] font-medium tracking-tight",
  "transition-colors duration-200",
  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)] focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--bg)]",
].join(" ");


/** Slow, faint sweep across the label — something is alive in there. */
function Sweep() {
  return (
    <span aria-hidden="true" className="pointer-events-none absolute inset-0 overflow-hidden rounded-md">
      <span className="absolute inset-y-0 -left-full w-full bg-gradient-to-r from-transparent via-[var(--accent)]/10 to-transparent motion-safe:animate-[pg-sweep_5.5s_ease-in-out_infinite]" />
    </span>
  );
}




/**
 * 2026-10-02 (product): the tab is no longer a locked door. It is a plain link to /playground
 * (the waitlist gate page, which signs people in and shows "Enter Playground" to members).
 * The playground app's own URL is still only ever emitted by the server after a grant.
 */
function OpenTab() {
  return (
    <Link
      href="/playground"
      className={[TAB_CLASS, "text-[var(--text-secondary)] hover:text-[var(--text)]"].join(" ")}
    >
      <span>Playground</span>
      <Sweep />
    </Link>
  );
}

/** Inside PrivyProvider: ask the server, then render the door it decided on. */
function ConnectedTab() {
  const { state } = usePlaygroundAccess();
  if (state.status === "granted" && state.open) {
    return (
      <EnterPlaygroundButton
        className={[TAB_CLASS, "text-[var(--accent)] hover:text-[var(--text)] disabled:opacity-60"].join(" ")}
      >
        <span>Enter Playground</span>
        <span aria-hidden="true">→</span>
      </EnterPlaygroundButton>
    );
  }
  return <OpenTab />;
}

export function PlaygroundNavTab() {
  const privyAvailable = usePrivyAvailable();
  // Without Privy there is no way to prove membership, so the tab is simply
  // locked — and never calls a Privy hook outside its provider.
  if (!privyAvailable) return <OpenTab />;
  return <ConnectedTab />;
}
