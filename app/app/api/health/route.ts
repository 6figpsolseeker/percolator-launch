import { NextResponse } from "next/server";
import { getServerConnection } from "@/lib/server-rpc";
import { hasIndexerDb, pingIndexerDb } from "@/lib/indexer-db";

export const dynamic = "force-dynamic";

/**
 * GET /api/health — liveness of what the app itself depends on.
 *
 * It used to probe the retired percolator-api (`${API_URL}/health`) and the raw RPC endpoint
 * (getRpcEndpoint: the exhausted Helius key on devnet), so it reported `offline` / 503 while
 * the app worked. Now:
 *   rpc      getSlot through getServerConnection (DEVNET_RPC_URL + Origin, as every route uses);
 *   indexer  `select 1` on INDEXER_DATABASE_URL, or null when the indexer DB isn't configured.
 * 200 when rpc is up and the indexer is up or not configured; otherwise 503.
 */
async function rpcOk(timeoutMs = 3000): Promise<boolean> {
  try {
    await Promise.race([
      getServerConnection("confirmed").getSlot("confirmed"),
      new Promise((_, rej) => setTimeout(() => rej(new Error("timeout")), timeoutMs)),
    ]);
    return true;
  } catch {
    return false;
  }
}

export async function GET() {
  const [rpc, indexer] = await Promise.all([rpcOk(), hasIndexerDb() ? pingIndexerDb() : Promise.resolve(null)]);
  const healthy = rpc && indexer !== false;
  const status = healthy ? "online" : rpc ? "degraded" : "offline";
  return NextResponse.json(
    { status, rpc, indexer, ts: Date.now() },
    { status: healthy ? 200 : 503, headers: { "Cache-Control": "no-store, max-age=0" } },
  );
}
