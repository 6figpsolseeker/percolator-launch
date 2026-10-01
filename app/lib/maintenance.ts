/**
 * Maintenance mode (P0a cutover runbook step 5: "put up a maintenance banner
 * before 5b"). Toggled by build-time env, no code change:
 *   NEXT_PUBLIC_MAINTENANCE=1                 show the banner
 *   NEXT_PUBLIC_MAINTENANCE_MESSAGE="…"       banner text (optional)
 *   NEXT_PUBLIC_MAINTENANCE_BLOCK_WRITES=1    also refuse to build/sign any tx
 *                                             (sendTx throws MaintenanceError
 *                                             before the wallet is asked)
 * `MAINTENANCE_DEFAULT` is the committed fallback for when env can't be set.
 * NEXT_PUBLIC_* values are inlined at build time, so a toggle is a redeploy.
 */
export interface MaintenanceConfig {
  active: boolean;
  message: string;
  blockWrites: boolean;
}

export const DEFAULT_MAINTENANCE_MESSAGE =
  "Scheduled maintenance: the playground is moving to a new program deployment. Trading and deposits are paused; your funds are not affected.";

/** Committed fallback (edit + redeploy if env vars are unavailable). */
export const MAINTENANCE_DEFAULT: MaintenanceConfig = { active: false, message: DEFAULT_MAINTENANCE_MESSAGE, blockWrites: false };

function flag(v: string | undefined): boolean | null {
  const t = v?.trim().toLowerCase();
  if (!t) return null;
  if (t === "1" || t === "true" || t === "on" || t === "yes") return true;
  if (t === "0" || t === "false" || t === "off" || t === "no") return false;
  return null;
}

export function getMaintenanceConfig(): MaintenanceConfig {
  const active = flag(process.env.NEXT_PUBLIC_MAINTENANCE) ?? MAINTENANCE_DEFAULT.active;
  const blockWrites = active && (flag(process.env.NEXT_PUBLIC_MAINTENANCE_BLOCK_WRITES) ?? MAINTENANCE_DEFAULT.blockWrites);
  const message = process.env.NEXT_PUBLIC_MAINTENANCE_MESSAGE?.trim() || MAINTENANCE_DEFAULT.message;
  return { active, message, blockWrites };
}

export class MaintenanceError extends Error {
  constructor(message = "The playground is in maintenance: transactions are paused. Nothing was sent; please try again after the maintenance window.") {
    super(message);
    this.name = "MaintenanceError";
  }
}
