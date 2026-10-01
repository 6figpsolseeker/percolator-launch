"use client";

import type { FC } from "react";
import { ConnectButton } from "@/components/wallet/ConnectButton";
import { usePrivyAvailable, usePrivyLogin } from "@/hooks/usePrivySafe";
import { useWalletAdapterAvailable } from "@/hooks/useWalletAdapterAvailable";

/**
 * Full-width "connect your wallet" call to action for a flow that cannot go on
 * without one. Mode-aware, like OrderTicket's connect CTA:
 *   - Privy (the live playground): a labelled button that opens Privy's modal.
 *   - wallet-adapter only: the label, then the shared ConnectButton, whose own
 *     menu is the adapter's wallet picker (usePrivyLogin is a no-op there).
 *   - neither: a disabled "Wallet unavailable" button.
 */
export const ConnectWalletCta: FC<{ label: string; testId?: string }> = ({ label, testId }) => {
  const privyAvailable = usePrivyAvailable();
  const adapterAvailable = useWalletAdapterAvailable();
  const openWalletModal = usePrivyLogin();

  const base =
    "w-full border py-3 text-[13px] font-bold uppercase tracking-[0.1em] transition-all duration-200 hud-btn-corners";

  if (privyAvailable) {
    return (
      <button
        type="button"
        data-testid={testId}
        onClick={() => openWalletModal()}
        className={`${base} border-[var(--accent)]/50 bg-[var(--accent)]/[0.08] text-[var(--accent)] hover:border-[var(--accent)] hover:bg-[var(--accent)]/[0.15]`}
      >
        {label}
      </button>
    );
  }

  if (adapterAvailable) {
    return (
      <div data-testid={testId} className="space-y-2">
        <p className="text-center text-[11px] uppercase tracking-[0.1em] text-[var(--text-secondary)]">{label}</p>
        <div className="w-full [&>*]:w-full [&_button]:w-full">
          <ConnectButton />
        </div>
      </div>
    );
  }

  return (
    <button
      type="button"
      data-testid={testId}
      disabled
      className={`${base} cursor-not-allowed border-[var(--border)] text-[var(--text-secondary)]`}
    >
      Wallet unavailable
    </button>
  );
};
