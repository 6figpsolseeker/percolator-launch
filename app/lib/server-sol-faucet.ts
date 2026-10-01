/**
 * UX WP-10 (audit FA-1, S0): the playground faucet grants SOL from a SERVER wallet, so a new user
 * can pay network fees even when the public devnet airdrop is rate-limited or down. Enabled by an
 * env check only (`PLAYGROUND_SOL_FAUCET_KEYPAIR`); without it the routes keep their public path.
 * The key is never exposed; only a transfer is signed.
 *
 * Security review 2026-09-30 (WP-8..10, FIX-FIRST) hardening, all in `grantServerSol`:
 *  - M-1: balance-aware (top the wallet up to SERVER_SOL_TARGET_LAMPORTS, never a blind amount;
 *    a wallet already at the target gets nothing); ONE server send per wallet per day and a GLOBAL
 *    daily budget, both persisted in Supabase `faucet_claims` (fund_type "server-sol"), so they hold
 *    across serverless instances; a tighter per-IP limit (3 per hour) on this branch. Budget spent,
 *    limit hit, or no database: the caller falls back to the public airdrop.
 *  - L-1: once broadcast, anything but a definite on-chain failure (ServerSignatureExecutionError)
 *    counts as SPENT: the reservation is kept and the caller answers "pending".
 *  - L-2: the connection's genesis hash must be devnet's before anything is sent.
 *  - I-1: a malformed key logs a fixed string (a JSON.parse message would quote the secret).
 */
import { Keypair, PublicKey, SendTransactionError, SystemProgram, Transaction, type Connection } from "@solana/web3.js";
import bs58 from "bs58";
import { confirmServerSignature, ServerSignatureExecutionError } from "@/lib/server-rpc";
import { createUpstashRateLimiter } from "@/lib/upstash-rate-limit";

export const SOL_FAUCET_ENV = "PLAYGROUND_SOL_FAUCET_KEYPAIR";
/** Devnet's genesis hash (L-2): the server wallet never sends on any other cluster. */
export const DEVNET_GENESIS_HASH = "EtWTRABZaYq6iMfeYKouRu166VU2xqa1wcaWoxPkrZBG";
/** A wallet is topped up to this (enough for many devnet transactions). */
export const SERVER_SOL_TARGET_LAMPORTS = 50_000_000; // 0.05 SOL
/** Global daily budget of the server wallet (M-1), default 2 SOL; env override in whole SOL. */
export const DEFAULT_SERVER_SOL_DAILY_BUDGET_LAMPORTS = 2_000_000_000;
export const SERVER_SOL_FUND_TYPE = "server-sol";
const DAY_MS = 24 * 60 * 60 * 1000;

export interface SolFaucetSigner {
  publicKey: PublicKey;
  sign(tx: Transaction): void;
}

let cached: SolFaucetSigner | null | undefined;

/** null when the env is unset or unreadable (a FIXED string is logged, never the parse error). */
export function getSolFaucetSigner(env: NodeJS.ProcessEnv = process.env): SolFaucetSigner | null {
  if (env === process.env && cached !== undefined) return cached;
  const raw = env[SOL_FAUCET_ENV]?.trim();
  let signer: SolFaucetSigner | null = null;
  if (raw) {
    try {
      const bytes = raw.startsWith("[") ? Uint8Array.from(JSON.parse(raw) as number[]) : bs58.decode(raw);
      if (bytes.length !== 64) throw new Error("length");
      const kp = Keypair.fromSecretKey(bytes);
      signer = { publicKey: kp.publicKey, sign: (tx) => tx.partialSign(kp) };
    } catch {
      console.error("[server-sol-faucet] the SOL faucet key could not be read; the server SOL path is disabled");
      signer = null;
    }
  }
  if (env === process.env) cached = signer;
  return signer;
}

/** The send never left this server (safe to release the reservation). */
export class ServerSolNotSentError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ServerSolNotSentError";
  }
}
/** Broadcast, outcome unknown (L-1: treat as spent). */
export class ServerSolPendingError extends Error {
  constructor(readonly signature: string, message: string) {
    super(message);
    this.name = "ServerSolPendingError";
  }
}

/**
 * Transfer `lamports` from the server wallet and wait for confirmation. Checks the cluster first
 * (L-2). Throws ServerSolNotSentError before broadcast, ServerSignatureExecutionError on a definite
 * on-chain failure, and ServerSolPendingError for any other post-broadcast outcome.
 */
export async function sendServerSol(p: { connection: Connection; signer: SolFaucetSigner; to: PublicKey; lamports: number }): Promise<string> {
  let genesis: string;
  try {
    genesis = await p.connection.getGenesisHash();
  } catch {
    throw new ServerSolNotSentError("cluster check failed");
  }
  if (genesis !== DEVNET_GENESIS_HASH) throw new ServerSolNotSentError("not devnet");
  const { blockhash } = await p.connection.getLatestBlockhash("finalized");
  const tx = new Transaction({ feePayer: p.signer.publicKey, recentBlockhash: blockhash }).add(
    SystemProgram.transfer({ fromPubkey: p.signer.publicKey, toPubkey: p.to, lamports: p.lamports }),
  );
  p.signer.sign(tx);
  const preSig = tx.signature ? bs58.encode(tx.signature) : "";
  let sig: string;
  try {
    sig = await p.connection.sendRawTransaction(tx.serialize(), { skipPreflight: false });
  } catch (e) {
    // A JSON-RPC refusal (preflight / bad blockhash) means nothing was broadcast; anything else may
    // have reached the leader before the response was lost.
    if (e instanceof SendTransactionError) throw new ServerSolNotSentError("refused before broadcast");
    throw new ServerSolPendingError(preSig, "broadcast outcome unknown");
  }
  try {
    await confirmServerSignature(p.connection, sig, { timeoutMs: 30_000 });
  } catch (e) {
    if (e instanceof ServerSignatureExecutionError) throw e;
    throw new ServerSolPendingError(sig, "confirmation pending");
  }
  return sig;
}

/** M-1: at most 3 server-SOL grants per IP per hour (on top of the shared fund limit). */
const serverSolIpLimiter = createUpstashRateLimiter({ limit: 3, windowMs: 60 * 60 * 1000, prefix: "rl:server-sol" });

export type ServerSolGrant =
  | { status: "sent"; signature: string; lamports: number }
  | { status: "funded"; lamports: 0 }
  | { status: "pending"; signature: string }
  | { status: "skipped"; reason: "disabled" | "no-db" | "ip-limit" | "wallet-limit" | "budget" | "failed" };

/** Minimal Supabase surface used here (faucet_claims). */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Db = any;

export function dailyBudgetLamports(env: NodeJS.ProcessEnv = process.env): number {
  const raw = Number(env.PLAYGROUND_SOL_FAUCET_DAILY_SOL);
  return Number.isFinite(raw) && raw > 0 ? Math.floor(raw * 1_000_000_000) : DEFAULT_SERVER_SOL_DAILY_BUDGET_LAMPORTS;
}

/**
 * Reserve one server send for `wallet` (M-1): one per wallet per day (UNIQUE(wallet, fund_type)),
 * and at most budget / target sends per day across ALL wallets and instances: the reservation is
 * inserted first, then the rows at or before it in the window are counted; over the cap it is
 * deleted again. Returns the reservation id, or why not.
 */
export async function reserveServerSol(db: Db, wallet: string, now = Date.now(), env: NodeJS.ProcessEnv = process.env): Promise<{ id: number } | { reason: "no-db" | "wallet-limit" | "budget" }> {
  const windowStart = new Date(now - DAY_MS).toISOString();
  try {
    await db.from("faucet_claims").delete().eq("wallet", wallet).eq("fund_type", SERVER_SOL_FUND_TYPE).lt("claimed_at", windowStart);
    const { data, error } = await db
      .from("faucet_claims")
      .insert({ wallet, fund_type: SERVER_SOL_FUND_TYPE, claimed_at: new Date(now).toISOString() })
      .select("id")
      .maybeSingle();
    if (error) return { reason: error.code === "23505" ? "wallet-limit" : "no-db" };
    const id = (data as { id?: number } | null)?.id;
    if (typeof id !== "number") return { reason: "no-db" };
    const { count, error: cErr } = await db
      .from("faucet_claims")
      .select("id", { count: "exact", head: true })
      .eq("fund_type", SERVER_SOL_FUND_TYPE)
      .gte("claimed_at", windowStart)
      .lte("id", id);
    const maxSends = Math.floor(dailyBudgetLamports(env) / SERVER_SOL_TARGET_LAMPORTS);
    if (cErr || typeof count !== "number" || count > maxSends) {
      await db.from("faucet_claims").delete().eq("id", id);
      return { reason: cErr || typeof count !== "number" ? "no-db" : "budget" };
    }
    return { id };
  } catch {
    return { reason: "no-db" };
  }
}

async function releaseReservation(db: Db, id: number): Promise<void> {
  try {
    await db.from("faucet_claims").delete().eq("id", id);
  } catch {
    /* best-effort */
  }
}

/**
 * The one entry both faucet routes use. Tops `to` up to SERVER_SOL_TARGET_LAMPORTS from the server
 * wallet within every limit above, or says why it did not (the caller then uses the public path).
 */
export async function grantServerSol(p: { connection: Connection; db: Db | null; to: PublicKey; ip: string; env?: NodeJS.ProcessEnv }): Promise<ServerSolGrant> {
  const signer = getSolFaucetSigner(p.env);
  if (!signer) return { status: "skipped", reason: "disabled" };
  if (!p.db) return { status: "skipped", reason: "no-db" };
  // Re-review I-D: a failed read never throws out of here (the playground route calls this
  // after the USDC has landed); the caller falls back to the public airdrop.
  let balance: number;
  try {
    balance = await p.connection.getBalance(p.to, "confirmed");
  } catch {
    return { status: "skipped", reason: "failed" };
  }
  if (balance >= SERVER_SOL_TARGET_LAMPORTS) return { status: "funded", lamports: 0 };
  let ipAllowed = false;
  try {
    ipAllowed = (await serverSolIpLimiter.check(p.ip)).allowed;
  } catch {
    ipAllowed = false;
  }
  if (!ipAllowed) return { status: "skipped", reason: "ip-limit" };
  const r = await reserveServerSol(p.db, p.to.toBase58(), Date.now(), p.env);
  if (!("id" in r)) return { status: "skipped", reason: r.reason };
  const lamports = SERVER_SOL_TARGET_LAMPORTS - balance;
  try {
    const signature = await sendServerSol({ connection: p.connection, signer, to: p.to, lamports });
    return { status: "sent", signature, lamports };
  } catch (e) {
    if (e instanceof ServerSolPendingError) return { status: "pending", signature: e.signature };
    // Not sent, or a definite on-chain failure: nothing moved, give the reservation back.
    await releaseReservation(p.db, r.id);
    console.error("[server-sol-faucet] server SOL send did not go through:", e instanceof ServerSolNotSentError ? e.message : "on-chain failure");
    return { status: "skipped", reason: "failed" };
  }
}

/** For tests only. */
export function __resetSolFaucetSignerForTest(): void {
  cached = undefined;
}
