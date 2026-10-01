import { NextResponse } from "next/server";
import { validateSlabParam } from "@/lib/route-validators";

export const dynamic = "force-dynamic";

/**
 * GET /api/markets/[slab]/prices — oracle price history.
 *
 * This was a proxy to percolator-api `/prices/:slab`. That service is retired ("Application not
 * found"), and nothing else records an oracle price series: the indexer DB keeps trades only
 * (lib/indexer-db.ts), and the chain holds the current mark, not its history. So the route says
 * so with a 404 instead of an empty-but-200 series that would read as "no prices yet".
 *
 * The one caller (TradingChart's oracle fallback series) maps `prices ?? []`, so it already
 * degrades to its live-tick series on this answer.
 */
export async function GET(_req: Request, { params }: { params: Promise<{ slab: string }> }) {
  const { slab } = await params;
  const validation = validateSlabParam(slab);
  if (!validation.valid) return validation.response;
  return NextResponse.json(
    { error: "Price history is not recorded for this market" },
    { status: 404, headers: { "Cache-Control": "public, s-maxage=300" } },
  );
}
