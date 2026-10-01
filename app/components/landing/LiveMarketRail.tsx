"use client";

import { useCallback, useMemo, useSyncExternalStore, type FC } from "react";
import Link from "next/link";
import { MarketLogo } from "@/components/market/MarketLogo";
import { GlassCard } from "@/components/ui/GlassCard";
import { formatMarkPrice, formatStatValue } from "@/lib/format";
import { rowVolumeUsd } from "@/lib/q-usd";
import { subscribeSlab, getSnapshot } from "@/lib/priceStore/priceStore";
import { usePriceFlash } from "@/hooks/usePriceFlash";
import { useAllMarketStats, type MarketWithStats } from "@/hooks/useAllMarketStats";
import { isZombieMarket } from "@/lib/activeMarketFilter";

/** Decorative right-chevron — same mark used by every other CTA on the
 *  landing page (see app/app/page.tsx's ARROW), duplicated here rather than
 *  imported since it's a leaf presentational constant, not shared state. */
const ARROW = (
  <svg
    className="hidden h-3.5 w-3.5 shrink-0 text-[var(--text-dim)] transition-transform duration-150 group-hover:translate-x-0.5 group-hover:text-[var(--accent)] sm:block"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth={2.5}
    strokeLinecap="round"
    strokeLinejoin="round"
    aria-hidden="true"
  >
    <path d="M5 12h14M12 5l7 7-7 7" />
  </svg>
);

/** Rows shown on the landing page; /markets has the full list. */
const RAIL_LIMIT = 6;

/** NUMERIC columns can arrive as strings; coerce like /markets does (GH#1536). */
const num = (v: unknown): number | null => {
  const n = Number(v);
  return v == null || !Number.isFinite(n) ? null : n;
};
const zombieInputs = (m: MarketWithStats) => {
  const r = m as Record<string, unknown>;
  return {
    vault_balance: num(r.vault_balance),
    c_tot: num(r.c_tot),
    last_price: num(r.last_price),
    volume_24h: num(r.volume_24h),
    total_open_interest: num(r.total_open_interest),
    total_accounts: num(r.total_accounts),
  };
};

interface RailRowProps {
  slab: string;
  symbol: string;
  name: string;
  mainnetCa: string | null;
  fallbackPrice: number | null;
  volume24h: number | null;
  maxLeverage: number | null;
  isLast: boolean;
}

/**
 * One rail row — subscribes ITSELF to the shared price store
 * (lib/priceStore/priceStore.ts), mirroring the `LiveRowPrice` leaf pattern
 * already proven on app/markets/page.tsx. Two narrow selectors (priceUsd for
 * the label, priceE6 for the flash) rather than one subscription to the
 * whole `PriceState` object — `PriceState` also carries change24h/high24h/
 * low24h/loading, none of which this row renders, so a store update to any
 * of those (e.g. `setStats24h`) would otherwise re-render this row for
 * nothing. A tick re-renders only this row, never the rail or the page —
 * no new WebSocket, no page-level re-render.
 */
const RailRow: FC<RailRowProps> = ({
  slab,
  symbol,
  name,
  mainnetCa,
  fallbackPrice,
  volume24h,
  maxLeverage,
  isLast,
}) => {
  const subscribe = useCallback((cb: () => void) => subscribeSlab(slab, cb), [slab]);
  const getPriceUsd = useCallback(() => getSnapshot(slab).priceUsd, [slab]);
  const getPriceE6 = useCallback(() => getSnapshot(slab).priceE6, [slab]);
  const getServerPriceUsd = useCallback(() => null, []);
  const getServerPriceE6 = useCallback(() => null, []);
  const livePriceUsd = useSyncExternalStore(subscribe, getPriceUsd, getServerPriceUsd);
  const livePriceE6 = useSyncExternalStore(subscribe, getPriceE6, getServerPriceE6);

  // Same green/up · red/down tick-flash micro-interaction used across the
  // trade terminal (MarketInfoBar / PositionsDock), keyed on the store's
  // post-invert priceE6 so it fires exactly when a real tick lands.
  const flash = usePriceFlash(livePriceE6);
  const tintClass =
    flash === "up" ? "text-[var(--long)]" : flash === "down" ? "text-[var(--short)]" : "text-[var(--text)]";

  const priceLabel = formatMarkPrice(livePriceUsd ?? fallbackPrice);
  const displaySymbol = symbol.replace(/-PERP$/, "");

  return (
    <Link
      href={`/trade/${slab}`}
      className={[
        "group flex items-center gap-3 px-4 py-3.5 transition-colors duration-150 hover:bg-[var(--accent)]/[0.04]",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[var(--accent)]",
        "sm:gap-4",
        isLast ? "" : "border-b border-[var(--border)]",
      ].join(" ")}
    >
      {/* decorative: the symbol text right next to it already gives the
          logo's accessible name — an alt/initials duplicate would make the
          link's a11y name read "SOL SOL". */}
      <MarketLogo mainnetCa={mainnetCa} symbol={displaySymbol} size="sm" decorative />

      <div className="min-w-0 flex-1">
        <div className="truncate text-[13px] font-semibold text-[var(--text)]">{displaySymbol}</div>
        <div className="hidden truncate text-[11px] text-[var(--text-secondary)] sm:block">{name}</div>
      </div>

      {/* Slot is always rendered (never conditionally omitted) so arriving
          stats don't pop the column in and shove the price/arrow — matches
          the volume column below, which formatStatValue already placeholds
          with "—". */}
      <div
        className="hidden shrink-0 text-right font-mono text-[10px] uppercase tracking-[0.1em] text-[var(--text-secondary)] sm:block"
        style={{ minWidth: 28 }}
      >
        {maxLeverage != null ? `${maxLeverage}x` : "—"}
      </div>

      <div
        className="hidden shrink-0 text-right font-mono text-[11px] text-[var(--text-secondary)] md:block"
        style={{ minWidth: 68 }}
      >
        {formatStatValue(volume24h, "currency")}
      </div>

      <div
        className={[
          "shrink-0 text-right font-mono text-[13px] font-semibold tabular-nums transition-colors duration-300",
          tintClass,
        ].join(" ")}
        style={{ minWidth: 84 }}
      >
        {priceLabel}
      </div>

      {ARROW}
    </Link>
  );
};

/**
 * Column header row. Without it the three stat columns read as bare, unlabeled
 * numbers — "10x" looks like an ambiguous badge, a lone "$3.3M" on one row
 * looks like an error rather than "the only market with 24h volume so far", and
 * nothing names the price. Mirrors RailRow's flex layout EXACTLY (same gap, the
 * 24px logo-width lead spacer, per-column minWidths, and the sm:/md: reveal
 * breakpoints) so each label sits above its column and appears/disappears with
 * it. Non-interactive and aria-hidden — screen readers get each value from the
 * row links themselves; this is a visual key only.
 */
const RailHeader: FC = () => (
  <div
    aria-hidden="true"
    className="flex items-center gap-3 border-b border-[var(--border)] bg-[var(--accent)]/[0.02] px-4 py-2 font-mono text-[10px] uppercase tracking-[0.1em] text-[var(--text-dim)] sm:gap-4"
  >
    {/* lead spacer = MarketLogo size "sm" (24px) so "Market" aligns to the symbol */}
    <div className="shrink-0" style={{ width: 24 }} />
    <div className="min-w-0 flex-1">Market</div>
    <div className="hidden shrink-0 text-right sm:block" style={{ minWidth: 28 }}>
      Lev
    </div>
    <div className="hidden shrink-0 text-right md:block" style={{ minWidth: 68 }}>
      24h Vol
    </div>
    <div className="shrink-0 text-right" style={{ minWidth: 84 }}>
      Price
    </div>
    {/* trailing spacer = the row's hover arrow (h-3.5 w-3.5, sm+ only) */}
    <div className="hidden h-3.5 w-3.5 shrink-0 sm:block" />
  </div>
);

/**
 * The landing page's live market rail — real devnet markets, real ticking
 * prices, zero decoration.
 *
 * Rows come from /api/markets (on-chain discovery + the registration Blob), the
 * same source as /markets. They used to come from PLAYGROUND_SLAB_META, which
 * the 2026-10-01 relaunch emptied, so the rail rendered a header and no rows.
 * The API already drops incomplete markets. Zombies are dropped here with the
 * same isZombieMarket() check /markets applies, since this fetch opts into them
 * (include_zombie=true). Busiest first, top RAIL_LIMIT. Each row subscribes to
 * `priceStore` for its live price.
 */
export function LiveMarketRail() {
  const { statsMap, loading, error } = useAllMarketStats();

  const rows = useMemo(
    () =>
      [...statsMap.values()]
        .filter((m) => m.slab_address && !isZombieMarket(zombieInputs(m)))
        // Slab tiebreak: with no volume anywhere the API order is discovery
        // order, which can change between the 30s refetches.
        .sort(
          (a, b) =>
            (rowVolumeUsd(b) ?? 0) - (rowVolumeUsd(a) ?? 0) ||
            (a.slab_address as string).localeCompare(b.slab_address as string),
        )
        .slice(0, RAIL_LIMIT),
    [statsMap],
  );

  return (
    <GlassCard padding="none" elevation="md" className="overflow-hidden" hover={false}>
      <RailHeader />
      {rows.map((m, i) => {
        const slab = m.slab_address as string;
        return (
          <RailRow
            key={slab}
            slab={slab}
            symbol={m.symbol || `${slab.slice(0, 4)}…${slab.slice(-4)}`}
            name={m.name ?? ""}
            mainnetCa={m.mainnet_ca}
            fallbackPrice={m.last_price ?? null}
            // `|| null` (not `?? null`): a literal 0 here means "trade-tape
            // indexer has no data", not "zero volume" — /markets renders the
            // same state as "—", and this rail showed "$0.00" for it. Map 0
            // to null so formatStatValue renders the same "—" convention.
            volume24h={rowVolumeUsd(m) || null}
            maxLeverage={m.max_leverage ?? null}
            isLast={i === rows.length - 1}
          />
        );
      })}
      {rows.length === 0 && !loading && (
        <div className="px-4 py-6 text-center text-[11px] text-[var(--text-secondary)]">
          {error ? (
            <Link href="/markets" className="hover:text-[var(--accent)]">Couldn&apos;t load markets. Open the market list</Link>
          ) : (
            <Link href="/create" className="hover:text-[var(--accent)]">No markets yet. Create the first one</Link>
          )}
        </div>
      )}
    </GlassCard>
  );
}
