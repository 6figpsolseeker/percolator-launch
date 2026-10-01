"use client";

/**
 * The Playground tab — a locked door with a lock behind it.
 *
 * For everyone the server has not admitted it is a <button> with NO href: there
 * is nothing to follow, middle-click, copy or crawl, and the devnet v2 app's
 * address is never in this markup (or in any client bundle — the only place it
 * is ever emitted is the server's redirect after a fresh grant).
 *
 * Clicking the locked tab opens a small popover explaining who gets in and
 * pointing at the two useful next steps — check your spot (/playground, the
 * gate page) or join the waitlist.
 *
 * States, all decided server-side (see hooks/usePlaygroundAccess):
 *   - signed out / checking / not a member / queued / error → locked + popover
 *   - granted, launch not open (PLAYGROUND_OPEN≠true)       → locked, popover
 *                                                              says "You're in."
 *   - granted, launch open                                   → "Enter Playground",
 *     a form POST to /api/playground/enter, which re-verifies and redirects.
 */

import Link from "next/link";
import { useEffect, useId, useRef, useState } from "react";
import { usePrivyAvailable } from "@/hooks/usePrivySafe";
import { usePlaygroundAccess, type PlaygroundAccessState } from "@/hooks/usePlaygroundAccess";
import { EnterPlaygroundButton } from "@/components/playground/EnterPlaygroundButton";

/** The announced opening cohort, for copy only. The server enforces the real one. */
const ANNOUNCED_COHORT = 1000;

const TAB_CLASS = [
  "group relative inline-flex min-h-9 items-center gap-1.5 rounded-md px-3 py-1.5",
  "text-[13px] font-medium tracking-tight",
  "transition-colors duration-200",
  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)] focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--bg)]",
].join(" ");

function Padlock() {
  // Shackle lifts a little on hover: "locked, but not forever".
  return (
    <svg
      viewBox="0 0 24 24"
      aria-hidden="true"
      className="h-3 w-3 shrink-0 opacity-60 transition-opacity duration-200 group-hover:opacity-90"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.2"
      strokeLinecap="round"
    >
      <path
        d="M8 10V7a4 4 0 0 1 8 0v3"
        className="origin-bottom transition-transform duration-300 ease-out motion-safe:group-hover:-translate-y-[1.5px]"
      />
      <rect x="5" y="10" width="14" height="9" rx="2" />
    </svg>
  );
}

/** Slow, faint sweep across the label — something is alive in there. */
function Sweep() {
  return (
    <span aria-hidden="true" className="pointer-events-none absolute inset-0 overflow-hidden rounded-md">
      <span className="absolute inset-y-0 -left-full w-full bg-gradient-to-r from-transparent via-[var(--accent)]/10 to-transparent motion-safe:animate-[pg-sweep_5.5s_ease-in-out_infinite]" />
    </span>
  );
}

const LINK_CLASS =
  "inline-flex min-h-8 items-center text-[11px] uppercase tracking-[0.14em] transition-opacity hover:opacity-80 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-[var(--accent)]";

function PopoverBody({ state, onNavigate }: { state: PlaygroundAccessState; onNavigate: () => void }) {
  if (state.status === "granted") {
    // Granted but launch is not open: no link out, exactly like the gate page.
    return (
      <>
        <p className="text-[13px] font-medium text-[var(--text)]">You&apos;re in. Opens at launch.</p>
        <p className="mt-1 text-[12px] leading-relaxed text-[var(--text-secondary)]">
          Waitlist position #{state.position.toLocaleString()}. This tab unlocks for you the moment
          devnet&nbsp;v2 opens.
        </p>
      </>
    );
  }
  const cohort = state.status === "queued" && state.cutoff > 0 ? state.cutoff : ANNOUNCED_COHORT;
  return (
    <>
      <p className="text-[13px] font-medium leading-snug text-[var(--text)]">
        Devnet v2 opens to the first {cohort.toLocaleString()} on the waitlist.
      </p>
      {state.status === "queued" && state.position != null && (
        <p className="mt-1 text-[12px] text-[var(--text-secondary)]">
          You&apos;re #{state.position.toLocaleString()} — referrals move you up.
        </p>
      )}
      <div className="mt-3 flex items-center gap-4">
        <Link href="/playground" onClick={onNavigate} className={`${LINK_CLASS} text-[var(--accent)]`}>
          Check my spot
        </Link>
        <Link href="/waitlist" onClick={onNavigate} className={`${LINK_CLASS} text-[var(--text-secondary)]`}>
          Join the waitlist
        </Link>
      </div>
    </>
  );
}

function LockedTab({ state }: { state: PlaygroundAccessState }) {
  const [open, setOpen] = useState(false);
  const wrapRef = useRef<HTMLSpanElement>(null);
  const panelId = useId();
  const granted = state.status === "granted";

  // Dismiss on Escape or an outside click — a popover, not a modal.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    const onDown = (e: MouseEvent) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("keydown", onKey);
    document.addEventListener("mousedown", onDown);
    return () => {
      document.removeEventListener("keydown", onKey);
      document.removeEventListener("mousedown", onDown);
    };
  }, [open]);

  return (
    <span ref={wrapRef} className="relative inline-flex">
      <button
        type="button"
        // Not `disabled`: a disabled button is skipped by the keyboard and says
        // nothing to a screen reader. This stays reachable and announces itself
        // as unavailable, which is the accessible way to render a closed door.
        aria-disabled="true"
        aria-expanded={open}
        aria-controls={open ? panelId : undefined}
        title={granted ? "You're in — opens at launch" : "Locked — devnet v2 opens to the waitlist first"}
        onClick={() => setOpen((o) => !o)}
        className={[
          TAB_CLASS,
          "cursor-pointer select-none",
          open ? "text-[var(--text)]" : "text-[var(--text-secondary)]/70 hover:text-[var(--text-secondary)]",
        ].join(" ")}
      >
        <span>Playground</span>
        {granted ? (
          // A quiet "you're in" mark instead of the padlock.
          <span aria-hidden="true" className="h-1.5 w-1.5 shrink-0 rounded-full bg-[var(--accent)]/80" />
        ) : (
          <Padlock />
        )}
        <span className="sr-only">{granted ? " (you're in, opens at launch)" : " (locked)"}</span>
        <Sweep />
      </button>

      {/* Rendered only while open, so the closed tab's markup holds no links. */}
      {open && (
        <div
          id={panelId}
          role="dialog"
          aria-label="Playground access"
          className={[
            "absolute left-0 top-full z-30 mt-2 w-[min(18rem,calc(100vw-2rem))]",
            "border border-[var(--border)] bg-[var(--panel-bg)] p-3.5 shadow-lg shadow-black/30",
            "motion-safe:animate-[pg-pop_160ms_ease-out]",
          ].join(" ")}
        >
          <span
            aria-hidden="true"
            className="absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-[var(--accent)]/50 to-transparent"
          />
          <PopoverBody state={state} onNavigate={() => setOpen(false)} />
        </div>
      )}
    </span>
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
  return <LockedTab state={state} />;
}

export function PlaygroundNavTab() {
  const privyAvailable = usePrivyAvailable();
  // Without Privy there is no way to prove membership, so the tab is simply
  // locked — and never calls a Privy hook outside its provider.
  if (!privyAvailable) return <LockedTab state={{ status: "idle" }} />;
  return <ConnectedTab />;
}
