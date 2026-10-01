/**
 * E2E B3: the /api/markets static-directory fallback, derived from config (the curated
 * PLAYGROUND_SLAB_META and the configured wrapper program id) so a re-seed cannot leave it
 * pointing at an abandoned slab.
 */
export interface SlabMetaEntry {
  symbol: string;
  name: string;
  mainnet_ca: string;
  dex_pool_address: string;
}

export function buildMarketDirectoryFallback(
  meta: Record<string, SlabMetaEntry>,
  programId: string,
  template: Record<string, unknown>,
): Record<string, unknown>[] {
  return Object.entries(meta).map(([slab, m]) => ({
    ...template,
    slab_address: slab,
    program_id: programId,
    symbol: m.symbol,
    name: m.name,
    mainnet_ca: m.mainnet_ca,
    dex_pool_address: m.dex_pool_address,
  }));
}
