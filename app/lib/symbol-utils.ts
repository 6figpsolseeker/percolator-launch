/**
 * Shared utilities for token symbol resolution.
 * Prevents truncated on-chain addresses from leaking into UI labels.
 */

/**
 * Well-known slug aliases mapping human-friendly token tickers to canonical Solana mint addresses.
 * 
 * Used for URL slug resolution (e.g. /trade/SOL-PERP) when market database contains
 * truncated addresses instead of recognizable token names. Provides a single source of truth
 * for canonical addresses across the application.
 * 
 * Supported tokens:
 * - SOL/WSOL: Native Solana vs Wrapped SOL (both resolve to same address)
 * - USDC: USD Coin (USDC bridged)
 * - USDT: USDTether (Ethereum-bridged)
 * - BONK: Bonk community token
 */
export const SLUG_ALIASES: Record<string, string> = {
  SOL: "So11111111111111111111111111111111111111112",
  WSOL: "So11111111111111111111111111111111111111112",
  USDC: "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v",
  USDT: "Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB",
  BONK: "DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263",
};

/**
 * Detect if a token symbol looks like a placeholder or truncated address rather than a real name.
 * 
 * Patterns considered placeholder:
 * - Empty string or null/undefined
 * - Prefix of the actual mint address (e.g. "So11111" for SOL's mint)
 * - Pure hex string (8 characters) - likely truncated base58
 * - Truncated address pattern with ellipsis (e.g. "So11...1112")
 * 
 * Useful for filtering out on-chain garbage data before display.
 * 
 * @param sym - Token symbol to check, or null/undefined
 * @param mint - Full mint address (used to detect if symbol is a prefix)
 * @returns True if symbol appears to be placeholder/truncated, false if it looks like a real token name
 * 
 * @example
 * isPlaceholderSymbol("SOL", "So11111111111111111111111111111111111111112") // -> false (real name)
 * isPlaceholderSymbol("So11111", "So11111111111111111111111111111111111111112") // -> true (is prefix of mint)
 * isPlaceholderSymbol("A1b2c3d4", "EPj...") // -> true (looks like hex)
 * isPlaceholderSymbol(null, "EPj...") // -> true (empty)
 */
export function isPlaceholderSymbol(sym: string | null | undefined, mint: string): boolean {
  if (!sym) return true;
  // Reject if it's the first N chars of the mint address (StatsCollector default)
  if (mint.startsWith(sym)) return true;
  // Reject pure hex-like strings (8 chars)
  if (/^[0-9a-fA-F]{8}$/.test(sym)) return true;
  // Reject if it looks like a truncated address with ellipsis
  if (/^[A-Za-z0-9]{3,6}[\u2026.]{1,3}[A-Za-z0-9]{3,6}$/.test(sym)) return true;
  return false;
}

/**
 * Clean a token symbol for safe display, falling back to "Token" for suspicious values.
 * 
 * Validation logic:
 * - Returns "Token" if symbol is null/empty/falsy
 * - Returns "Token" if symbol looks like placeholder/truncated address (uses isPlaceholderSymbol)
 * - Otherwise returns the symbol as-is
 * 
 * Useful for safe rendering in UI components where on-chain data might be garbage.
 * 
 * @param sym - Token symbol from on-chain or database, or null/undefined
 * @param mintAddress - Optional mint address for placeholder detection. If provided, validates symbol isn't a prefix.
 * @returns Sanitized symbol string suitable for display ("Token" if suspicious, otherwise the symbol)
 * 
 * @example
 * sanitizeSymbol("USDC") // -> "USDC" (valid name)
 * sanitizeSymbol("So11111", "So11111111111111111111111111111111111111112") // -> "Token" (is prefix)
 * sanitizeSymbol(null) // -> "Token" (empty)
 * sanitizeSymbol("") // -> "Token" (empty)
 */
export function sanitizeSymbol(sym: string | null | undefined, mintAddress?: string): string {
  if (!sym) return "Token";
  if (mintAddress && isPlaceholderSymbol(sym, mintAddress)) return "Token";
  return sym;
}

/** UX WP-10 (audit §4.2 unit rule): the base symbol is the token ("SOL"), never "SOL-PERP". */
export function baseSymbol(sym: string | null | undefined): string {
  const s = (sym ?? "").trim();
  return s.replace(/[-_ ]?PERP$/i, "").replace(/\/USDC?$/i, "") || s;
}
