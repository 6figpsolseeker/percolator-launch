/**
 * Jupiter USD price for a mainnet mint (Price API v3, keyless lite host).
 *
 * The app's previous Jupiter reader called `api.jup.ag/price/v2`, which now answers 404, so the
 * "Jupiter fallback" in /api/oracle/resolve had silently stopped working. Shape (2026-10-01):
 *   GET https://lite-api.jup.ag/price/v3?ids=<mint>
 *   -> { "<mint>": { "usdPrice": 118.0, "decimals": 9, "liquidity": ..., ... } }
 * A mint Jupiter does not price is simply absent. Returns null on any failure; never throws.
 * Plain module (no Next / server-only imports): also used by scripts/local-price-ws-server.ts.
 */
export const JUPITER_PRICE_URL = "https://lite-api.jup.ag/price/v3";

export function parseJupiterUsdPrice(body: unknown, mint: string): number | null {
  if (!body || typeof body !== "object") return null;
  const entry = (body as Record<string, unknown>)[mint];
  if (!entry || typeof entry !== "object") return null;
  const raw = (entry as Record<string, unknown>).usdPrice;
  const price = typeof raw === "number" ? raw : typeof raw === "string" ? Number(raw) : NaN;
  return Number.isFinite(price) && price > 0 ? price : null;
}

export async function fetchJupiterUsdPrice(
  mint: string,
  fetchImpl: typeof fetch = fetch,
  timeoutMs = 6000,
): Promise<number | null> {
  try {
    const resp = await fetchImpl(`${JUPITER_PRICE_URL}?ids=${encodeURIComponent(mint)}`, {
      signal: AbortSignal.timeout(timeoutMs),
      headers: { "User-Agent": "percolator/1.0" },
    });
    if (!resp.ok) return null;
    return parseJupiterUsdPrice(await resp.json(), mint);
  } catch {
    return null;
  }
}

export const WSOL_MINT = "So11111111111111111111111111111111111111112";

/** SOL/USD as an e6 integer, from Jupiter. */
export async function fetchJupiterSolUsdE6(fetchImpl: typeof fetch = fetch): Promise<bigint | null> {
  const p = await fetchJupiterUsdPrice(WSOL_MINT, fetchImpl);
  return p === null ? null : BigInt(Math.round(p * 1_000_000));
}
