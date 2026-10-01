"use client";

/**
 * The Playground tab — present, deliberately inert.
 *
 * Devnet v2 opens to the waitlist in position order. Until it does, this sits
 * in the nav as a closed door: visible, obviously locked, and going nowhere.
 * It is a <button> rather than a <Link> so that "it does nothing" is a
 * PROPERTY OF THE MARKUP and not a behaviour someone has to remember to keep —
 * there is no href to follow, to middle-click, to copy, or to crawl.
 *
 * TO UNLOCK: flip `UNLOCKED` to true (or lift it to an env flag) and give it an
 * href. Everything else — the gate page, the handoff and the session — lives
 * behind that and is already written. Nothing about unlocking requires touching
 * the lock itself.
 */

import { useState } from "react";

/**
 * Hard-coded, not an env var, and deliberately so.
 *
 * An env flag can be flipped by accident, by a stale preview environment, or by
 * a copy-pasted `.env`. Opening the playground should be a reviewed diff with
 * someone's name on it. There is no rush here that is worth a config switch.
 */
const UNLOCKED = false;

export function PlaygroundNavTab() {
  const [nudged, setNudged] = useState(false);

  if (UNLOCKED) return null; // the live tab replaces this; see the header

  return (
    <button
      type="button"
      // Not `disabled`: a disabled button is skipped by the keyboard and says
      // nothing to a screen reader. This is reachable and announces itself as
      // unavailable, which is the accessible way to render a closed door.
      aria-disabled="true"
      title="Playground opens with devnet v2"
      onClick={() => {
        // The whole behaviour: acknowledge the click, go nowhere.
        setNudged(true);
        window.setTimeout(() => setNudged(false), 1400);
      }}
      className={[
        "group relative inline-flex items-center gap-1.5 rounded-md px-3 py-1.5",
        "text-[13px] font-medium tracking-tight",
        "text-[var(--text-secondary)]/70",
        "transition-colors duration-200 hover:text-[var(--text-secondary)]",
        "cursor-default select-none",
      ].join(" ")}
    >
      <span>Playground</span>

      {/* Padlock. Shackle lifts a little on hover — the only motion here, and
          it reads as "locked, but not forever". */}
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
          className="origin-bottom transition-transform duration-300 ease-out group-hover:-translate-y-[1.5px]"
        />
        <rect x="5" y="10" width="14" height="9" rx="2" />
      </svg>

      {/* A slow sweep across the label. Mysterious rather than busy: it is long
          and low-contrast, so it reads as "something is alive in there" instead
          of competing with the live nav items beside it.
          Honours prefers-reduced-motion via the utility's own media query. */}
      <span
        aria-hidden="true"
        className="pointer-events-none absolute inset-0 overflow-hidden rounded-md"
      >
        <span className="absolute inset-y-0 -left-full w-full bg-gradient-to-r from-transparent via-[var(--accent)]/10 to-transparent motion-safe:animate-[pg-sweep_5.5s_ease-in-out_infinite]" />
      </span>

      {/* Click acknowledgement. Not a toast and not a modal — a whisper that
          confirms the button registered, so it reads as locked rather than
          broken. */}
      <span
        role="status"
        aria-live="polite"
        className={[
          "pointer-events-none absolute left-1/2 top-full z-20 mt-1.5 -translate-x-1/2 whitespace-nowrap",
          "rounded border border-[var(--border)] bg-[var(--panel-bg)] px-2 py-1",
          "text-[10px] uppercase tracking-[0.14em] text-[var(--text-secondary)]",
          "transition-all duration-200",
          nudged ? "opacity-100 translate-y-0" : "pointer-events-none opacity-0 -translate-y-1",
        ].join(" ")}
      >
        {nudged ? "Opens with devnet v2" : ""}
      </span>
    </button>
  );
}
