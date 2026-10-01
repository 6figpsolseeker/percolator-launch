"use client";

/**
 * UX WP-10 (audit §4.9, UI-2): a numeric field that has not loaded yet shows "—" with
 * data-state="loading", never a default rendered as a fact ("$0", "Cooldown None").
 */
import type { FC, ReactNode } from "react";

export const LOADING_DASH = "—";

export const LoadingValue: FC<{ loading: boolean; children: ReactNode; className?: string }> = ({ loading, children, className }) =>
  loading ? (
    <span data-state="loading" aria-busy="true" className={className ?? "text-[var(--text-secondary)]"}>
      {LOADING_DASH}
    </span>
  ) : (
    <>{children}</>
  );

/** For string-valued rows: the dash while loading, the value once loaded. */
export const loadingText = (loading: boolean, value: string): string => (loading ? LOADING_DASH : value);
