import { BLOCKED_SLAB_ADDRESSES } from "@/lib/blocklist";
import { isZombieMarket } from "@/lib/activeMarketFilter";

/** Max sane price (USD) for both listed-market filtering and display capping.
 *  Mirrors /api/stats sanitizePrice() cap. Corrupt oracle prices (e.g. $7.9T)
 *  exceed this and are nulled/excluded. */
export const MAX_SANE_PRICE_USD = 1_000_000;

/** GH#1536: NUMERIC columns arrive from Supabase as strings; coerce before
 *  comparing (`"0" === 0` is false and lets zombies through). */
function numericOrNull(v: unknown): number | null {
  if (v == null) return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

/** GH#1536: raw DB prices above the cap are stale garbage and must not count
 *  as activity in the zombie check (mirrors /api/markets GH#1506). */
function sanitizePrice(v: unknown): number | null {
  const n = numericOrNull(v);
  if (n == null || n <= 0 || n > MAX_SANE_PRICE_USD) return null;
  return n;
}

/** The stats fields the listing decision reads. Values may be number, string or null. */
export interface ListedMarketStatsRow {
  vault_balance?: unknown;
  c_tot?: unknown;
  last_price?: unknown;
  volume_24h?: unknown;
  total_open_interest?: unknown;
  total_accounts?: unknown;
}

/**
 * Whether a market row from `/api/markets?include_zombie=true` is LISTED: not
 * blocklisted (GH#1539) and not a zombie (GH#1531). This is the single
 * definition shared by the /markets page and the landing page's Live Markets
 * rail, so the two can never disagree about which markets exist.
 */
export function isListedMarketRow(slab: string, row: ListedMarketStatsRow): boolean {
  if (BLOCKED_SLAB_ADDRESSES.has(slab)) return false;
  return !isZombieMarket({
    vault_balance: numericOrNull(row.vault_balance),
    c_tot: numericOrNull(row.c_tot),
    last_price: sanitizePrice(row.last_price),
    volume_24h: numericOrNull(row.volume_24h),
    total_open_interest: numericOrNull(row.total_open_interest),
    total_accounts: numericOrNull(row.total_accounts),
  });
}
