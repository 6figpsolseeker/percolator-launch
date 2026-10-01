import { PublicKey } from "@solana/web3.js";
import { NextRequest, NextResponse } from "next/server";

import { BoundedTtlCache } from "@/lib/bounded-ttl-cache";

const ORACLE_BRIDGE_URL =
  process.env.ORACLE_BRIDGE_URL || "http://127.0.0.1:18802";

/*
 * NO PYTH: this route used to have a `pyth-pinned` mode that read the feed's
 * price account off Pythnet RPC and listed Pyth's publishers. It is gone. The
 * relaunch markets are DEX-priced (hyperp), so the only sources left are the
 * DEX sources behind the oracle bridge (hyperp) and a single oracle authority
 * (admin). Any other mode — `pyth-pinned` included — is a 400.
 */

/** Max age for cached publisher data (5 minutes). */
const CACHE_TTL_MS = 5 * 60 * 1000;

/**
 * Publisher responses have a small expected key space.
 * Keep the process-local cache strictly bounded so request-controlled
 * inputs cannot create persistent unbounded memory retention.
 */
const MAX_CACHE_ENTRIES = 128;

const cache = new BoundedTtlCache<string, PublishersResponse>({
  maxEntries: MAX_CACHE_ENTRIES,
  ttlMs: CACHE_TTL_MS,
});

interface PublisherInfo {
  key: string;
  name: string;
  status: "active" | "degraded" | "offline";
}

interface PublishersResponse {
  mode: string;
  publisherCount: number | null;
  publisherTotal: number | null;
  publishers: PublisherInfo[];
}

/**
 * GET /api/oracle/publishers
 *
 * Dynamically fetch oracle publisher data for a given mode.
 *
 * Query params:
 *   mode=hyperp                     — queries oracle bridge (DEX sources)
 *   mode=admin&authority=<base58>   — returns single authority
 */
export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const mode = searchParams.get("mode");
  const authority = searchParams.get("authority");

  if (!mode) {
    return NextResponse.json({ error: "Missing mode parameter" }, { status: 400 });
  }

  /*
   * Admin output is generated locally and is intentionally excluded
   * from the shared cache. This prevents attacker-controlled authority
   * values from increasing cache cardinality.
   */
  if (mode === "admin") {
    const validation = validateAdminAuthority(authority);

    if (!validation.ok) {
      return NextResponse.json(
        { error: validation.error },
        { status: 400 },
      );
    }

    return NextResponse.json(
      getAdminPublishers(validation.authority),
      {
        headers: { "Cache-Control": "no-store" },
      },
    );
  }

  if (mode !== "hyperp") {
    return NextResponse.json({ error: `Unknown mode: ${mode}` }, { status: 400 });
  }

  // Check the bounded cache. Only the fixed `hyperp` key can reach it, so
  // request input cannot grow its cardinality.
  const cacheKey = mode;
  const cached = cache.get(cacheKey);

  if (cached) {
    return NextResponse.json(cached, {
      headers: { "Cache-Control": "public, max-age=300" },
    });
  }

  try {
    const result = await fetchHyperpPublishers();

    // Error-sentinel results (publisherCount === null: the oracle bridge
    // being down) are NOT cached —
    // caching one would pin a transient upstream blip as "no publishers" for
    // the full 5-minute TTL. Return it uncached so the next request retries.
    if (result.publisherCount === null) {
      return NextResponse.json(result, {
        headers: { "Cache-Control": "no-store" },
      });
    }

    // Store only successfully resolved external modes in the bounded cache.
    cache.set(cacheKey, result);

    return NextResponse.json(result, {
      headers: { "Cache-Control": "public, max-age=300" },
    });
  } catch (err) {
    console.error("[oracle/publishers] Error:", err);
    return NextResponse.json(
      { error: "Failed to fetch publisher data" },
      { status: 500 },
    );
  }
}

// ---------------------------------------------------------------------------
// HyperP: Query oracle bridge for DEX price sources
// ---------------------------------------------------------------------------

async function fetchHyperpPublishers(): Promise<PublishersResponse> {
  try {
    const resp = await fetch(`${ORACLE_BRIDGE_URL}/oracle/markets`, {
      signal: AbortSignal.timeout(5000),
    });

    if (resp.ok) {
      const data = await resp.json();
      const markets = Array.isArray(data) ? data : data.markets || [];
      const sources = markets.map(
        (m: { address?: string; market?: string; symbol?: string; name?: string }) => ({
          key: m.address || m.market || "unknown",
          name: m.symbol || m.name || "DEX Source",
          status: "active" as const,
        }),
      );

      return {
        mode: "hyperp",
        publisherCount: sources.length,
        publisherTotal: sources.length,
        publishers: sources.slice(0, 10),
      };
    }
  } catch {
    // Oracle bridge not available
  }

  // HyperP uses on-chain DEX liquidity — no traditional publishers.
  // Return null (not 0) so the UI knows to suppress "0 publishers" text.
  return {
    mode: "hyperp",
    publisherCount: null,
    publisherTotal: null,
    publishers: [],
  };
}

// ---------------------------------------------------------------------------
// Admin: Single oracle authority
// ---------------------------------------------------------------------------

const SYSTEM_PROGRAM_ID = "11111111111111111111111111111111";

type AdminAuthorityValidation =
  | { ok: true; authority: string | null }
  | { ok: false; error: string };

function validateAdminAuthority(
  authority: string | null,
): AdminAuthorityValidation {
  /*
   * Preserve the existing empty-state behavior when no authority is
   * configured or the system-program placeholder is supplied.
   */
  if (!authority || authority === SYSTEM_PROGRAM_ID) {
    return { ok: true, authority };
  }

  if (authority.length < 32 || authority.length > 44) {
    return { ok: false, error: "Invalid admin authority" };
  }

  try {
    const canonicalAuthority = new PublicKey(authority).toBase58();

    if (canonicalAuthority !== authority) {
      return { ok: false, error: "Invalid admin authority" };
    }

    return {
      ok: true,
      authority: canonicalAuthority,
    };
  } catch {
    return { ok: false, error: "Invalid admin authority" };
  }
}

function getAdminPublishers(authority: string | null): PublishersResponse {
  if (!authority || authority === SYSTEM_PROGRAM_ID) {
    return {
      mode: "admin",
      publisherCount: 0,
      publisherTotal: 0,
      publishers: [],
    };
  }

  return {
    mode: "admin",
    publisherCount: 1,
    publisherTotal: 1,
    publishers: [
      {
        key: authority,
        name: `Authority ${authority.slice(0, 4)}…${authority.slice(-4)}`,
        status: "active",
      },
    ],
  };
}
