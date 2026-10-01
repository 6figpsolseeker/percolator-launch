"use client";

import { getMaintenanceConfig } from "@/lib/maintenance";

/** Site-wide maintenance banner (lib/maintenance.ts). Not dismissible by design. */
export function MaintenanceBanner() {
  const cfg = getMaintenanceConfig();
  if (!cfg.active) return null;
  return (
    <div
      data-testid="maintenance-banner"
      data-block-writes={cfg.blockWrites ? "1" : "0"}
      role="alert"
      className="w-full border-b border-[var(--warning)]/30 bg-[var(--warning)]/10 px-4 py-2 text-center text-[11px] font-medium text-[var(--warning)]"
    >
      {cfg.message}
    </div>
  );
}
