/**
 * Which hosts carry the Playground surfaces (nav tab, /playground gate page,
 * /api/playground/*).
 *
 * This repo's `main` branch is built by TWO Vercel projects: percolator-launch
 * (percolator.trade, the waitlist) and percolator-mainnet
 * (mainnet.percolatorlaunch.com, the mainnet trading app). The playground gate
 * belongs to the waitlist only, so it is an ALLOW-list: the waitlist host, its
 * own Vercel previews, and local development. Every other host — mainnet
 * included — behaves exactly as it did before the gate existed.
 *
 * Edge-safe and dependency-free: imported by middleware and by the header.
 * Deliberately contains no playground app URL.
 */
export function isPlaygroundGateHost(rawHost: string | null | undefined): boolean {
  const host = (rawHost ?? "").toLowerCase().split(":")[0] ?? "";
  if (!host) return false;
  if (host === "percolator.trade") return true;
  if (host === "localhost" || host === "127.0.0.1") return true;
  // Preview deployments of the percolator-launch project only — NOT
  // percolator-mainnet-*.vercel.app.
  if (host === "percolator-launch.vercel.app") return true;
  if (host.endsWith(".vercel.app") && host.startsWith("percolator-launch-")) return true;
  return false;
}
