"use client";
import { useState } from "react";
import { getNetwork } from "@/lib/config";

export function MainnetBetaBanner() {
  const [dismissed, setDismissed] = useState(false);
  if (getNetwork() !== "mainnet" || dismissed) return null;
  return (
    <div className="w-full bg-[var(--accent)]/10 border-b border-[var(--accent)]/20 px-4 py-2 flex items-center justify-between text-[11px]">
      <span className="text-[var(--accent)] font-medium">
        BETA — $1K seed vault. Open to anyone. Trade at your own risk.
      </span>
      <button
        onClick={() => setDismissed(true)}
        className="ml-4 text-[var(--text-dim)] hover:text-[var(--text)] transition-colors"
        aria-label="Dismiss beta banner"
      >
        ✕
      </button>
    </div>
  );
}
