/**
 * UX WP-7 (audit §3.15, WZ-1/WZ-2): keeper registration WITHOUT a signMessage prompt.
 *
 * The creator's launch batch carries an SPL Memo in the SAME transaction as the market's
 * InitMarket: `percolator:keeper-register:v2:<sha256(canonical params), base64url>`, signed by the
 * creator. `/api/playground/keeper-register` then verifies, from the landed transaction alone:
 *   1. it succeeded;
 *   2. it contains EXACTLY ONE registration memo, and that memo is the one for this request: the
 *      pool / CA / dex type / symbol / label AND a digest of the full markets-row payload
 *      (name, symbol, mint, decimals, oracle mode and authority, initial price, LP collateral,
 *      max leverage, trading fee) are the ones the creator signed;
 *   3. the same transaction contains the WRAPPER's InitMarket for this exact slab, and its admin
 *      (a signer) is the memo's signer.
 * The proof is a landed transaction and so is public forever: anyone can replay it, but only to
 * submit the exact registration the creator signed. What an accepted proof may WRITE is limited
 * by the route (it never overwrites an existing creator-registered row; see
 * lib/market-registration.ts). There is no other user proof: the P3 junior-owner path was
 * removed (security review 2026-09-30, M-2).
 */
import { PublicKey, TransactionInstruction, type VersionedTransactionResponse } from "@solana/web3.js";
import bs58 from "bs58";
import { canonicalizeKeeperRegisterParams, type KeeperRegisterProofParams } from "@/lib/keeper-register-proof";
import { KEEPER_DEX_TYPES } from "@/lib/dex-type";
import { checkName, checkSymbol } from "@/lib/market-metadata-validation";

export const MEMO_PROGRAM_ID = new PublicKey("MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr");
/** Any registration memo, whatever its version (at most one per creation tx). */
export const KEEPER_REGISTER_MEMO_FAMILY = "percolator:keeper-register:";
export const KEEPER_REGISTER_MEMO_PREFIX = "percolator:keeper-register:v2:";
/** SDK IX_TAG.InitMarket. */
export const INIT_MARKET_TAG = 0;

function b64url(bytes: Uint8Array): string {
  return Buffer.from(bytes).toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

/** SHA-256 via WebCrypto (`globalThis.crypto.subtle`): browser-safe and native in Node 20. */
async function sha256b64url(text: string): Promise<string> {
  const data = Uint8Array.from(new TextEncoder().encode(text));
  return b64url(new Uint8Array(await globalThis.crypto.subtle.digest("SHA-256", data)));
}

// ── The markets-row payload the memo binds ───────────────────────────────────

/** Every payload field the route writes into the markets row (and nothing else is read). */
export const BOUND_PAYLOAD_FIELDS = [
  "decimals",
  "initial_price_e6",
  "lp_collateral",
  "max_leverage",
  "mint_address",
  "name",
  "oracle_authority",
  "oracle_mode",
  "symbol",
  "trading_fee_bps",
] as const;
export type BoundPayloadField = (typeof BOUND_PAYLOAD_FIELDS)[number];
export type BoundRegistrationPayload = Partial<Record<BoundPayloadField, string | number | null>>;

const ORACLE_MODES = ["pyth", "hyperp", "admin", "keeper"] as const;
const U128_STR = /^\d{1,39}$/;

const isPubkey = (v: string): boolean => {
  try {
    new PublicKey(v);
    return true;
  } catch {
    return false;
  }
};

/**
 * Strict shape check of the payload fields the route writes (security review M-1: they used to be
 * `str()`/`num()` only). Returns the bound subset, or the first problem. `null` in = no payload.
 */
export function validateRegistrationPayload(
  raw: unknown,
): { ok: true; payload: BoundRegistrationPayload | null } | { ok: false; error: string } {
  if (raw === null || raw === undefined) return { ok: true, payload: null };
  if (typeof raw !== "object" || Array.isArray(raw)) return { ok: false, error: "Invalid payload" };
  const r = raw as Record<string, unknown>;
  const out: BoundRegistrationPayload = {};
  const bad = (f: string) => ({ ok: false as const, error: `Invalid payload.${f}` });
  for (const f of BOUND_PAYLOAD_FIELDS) {
    const v = r[f];
    if (v === null || v === undefined) continue;
    switch (f) {
      case "mint_address":
      case "oracle_authority":
        if (typeof v !== "string" || !isPubkey(v)) return bad(f);
        break;
      case "symbol":
        if (typeof v !== "string" || !checkSymbol(v).ok) return bad(f);
        break;
      case "name":
        if (typeof v !== "string" || !checkName(v).ok) return bad(f);
        break;
      case "oracle_mode":
        if (typeof v !== "string" || !(ORACLE_MODES as readonly string[]).includes(v)) return bad(f);
        break;
      case "initial_price_e6":
      case "lp_collateral":
        if (typeof v !== "string" || !U128_STR.test(v)) return bad(f);
        break;
      case "decimals":
        if (typeof v !== "number" || !Number.isInteger(v) || v < 0 || v > 18) return bad(f);
        break;
      case "max_leverage":
        if (typeof v !== "number" || !Number.isFinite(v) || v <= 0 || v > 1000) return bad(f);
        break;
      case "trading_fee_bps":
        if (typeof v !== "number" || !Number.isInteger(v) || v < 0 || v > 10_000) return bad(f);
        break;
    }
    out[f] = v as string | number;
  }
  return { ok: true, payload: out };
}

/**
 * Digest of the bound payload fields. Keys sorted, 0x1F-separated `k=v`, absent = empty; the
 * values are shape-checked first (no 0x1F can occur in any of them), so the encoding is
 * unambiguous. `null` (no payload) digests to the empty string.
 */
export async function registrationPayloadDigest(p: BoundRegistrationPayload | null): Promise<string> {
  if (!p) return "";
  const text = BOUND_PAYLOAD_FIELDS.map((k) => `${k}=${p[k] === null || p[k] === undefined ? "" : String(p[k])}`).join("\u001F");
  return sha256b64url(text);
}

/** The exact memo text for these registration parameters. */
export async function keeperRegisterMemoText(p: KeeperRegisterProofParams): Promise<string> {
  return KEEPER_REGISTER_MEMO_PREFIX + (await sha256b64url(canonicalizeKeeperRegisterParams(p)));
}

/** The memo instruction (creator = signer), placed in the InitMarket transaction. */
export async function buildKeeperRegisterMemoIx(creator: PublicKey, p: KeeperRegisterProofParams): Promise<TransactionInstruction> {
  return new TransactionInstruction({
    programId: MEMO_PROGRAM_ID,
    keys: [{ pubkey: creator, isSigner: true, isWritable: false }],
    data: Buffer.from(await keeperRegisterMemoText(p), "utf8"),
  });
}

export type MemoProofVerdict = { ok: true; creator: string } | { ok: false; reason: string };

/**
 * Verify a landed transaction proves the creator registered exactly these parameters.
 * `wrapperProgramId`: the ONE percolator wrapper this deployment runs (security review L-1: a
 * tag-0 instruction of a sibling program is not an InitMarket).
 */
export async function verifyKeeperRegisterProofTx(
  tx: Pick<VersionedTransactionResponse, "meta" | "transaction"> | null,
  p: KeeperRegisterProofParams,
  wrapperProgramId: string,
): Promise<MemoProofVerdict> {
  if (!tx) return { ok: false, reason: "proof transaction not found" };
  if (!tx.meta || tx.meta.err !== null) return { ok: false, reason: "proof transaction did not succeed" };
  const msg = tx.transaction.message;
  const keys = msg.staticAccountKeys.map((k) => k.toBase58());
  const nSigners = msg.header.numRequiredSignatures;
  const expected = await keeperRegisterMemoText(p);
  let registrationMemos = 0;
  let memoSigner: string | null = null;
  let initAdmin: string | null = null;
  for (const ix of msg.compiledInstructions) {
    const prog = keys[ix.programIdIndex];
    if (prog === MEMO_PROGRAM_ID.toBase58()) {
      const text = Buffer.from(ix.data).toString("utf8");
      if (!text.startsWith(KEEPER_REGISTER_MEMO_FAMILY)) continue;
      registrationMemos++;
      const signerIdx = ix.accountKeyIndexes[0];
      if (text === expected && signerIdx !== undefined && signerIdx < nSigners) memoSigner = keys[signerIdx] ?? null;
    } else if (prog === wrapperProgramId && ix.data[0] === INIT_MARKET_TAG) {
      const accts = ix.accountKeyIndexes.map((i) => keys[i]);
      const adminIdx = ix.accountKeyIndexes[0];
      // ACCOUNTS_INIT_MARKET: [admin(signer), slab, mint]
      if (accts[1] === p.slabAddress && adminIdx !== undefined && adminIdx < nSigners) initAdmin = accts[0] ?? null;
    }
  }
  if (registrationMemos > 1) return { ok: false, reason: "more than one registration memo in the proof transaction" };
  if (!memoSigner) return { ok: false, reason: "no matching registration memo signed in the proof transaction" };
  if (!initAdmin) return { ok: false, reason: "the proof transaction does not create this market" };
  if (initAdmin !== memoSigner) return { ok: false, reason: "the memo's signer is not this market's creator" };
  return { ok: true, creator: memoSigner };
}

/** A transaction signature: base58 of exactly 64 bytes (checked before any RPC, review L-2). */
export function isTxSignature(v: unknown): v is string {
  if (typeof v !== "string" || v.length < 64 || v.length > 88) return false;
  try {
    return bs58.decode(v).length === 64;
  } catch {
    return false;
  }
}

/** Only the keeper's own dex vocabulary is hashed (review Info I-1); anything else is refused. */
export function isKeeperDexTypeOrEmpty(v: unknown): boolean {
  return v === null || v === undefined || v === "" || (typeof v === "string" && (KEEPER_DEX_TYPES as readonly string[]).includes(v));
}

/** The bound fields of a payload, as sent (the route digests its VALIDATED subset: equal for any payload it accepts). */
export function boundPayloadSubset(raw: Record<string, unknown> | null | undefined): BoundRegistrationPayload | null {
  if (!raw) return null;
  const out: BoundRegistrationPayload = {};
  for (const f of BOUND_PAYLOAD_FIELDS) {
    const v = raw[f];
    if (typeof v === "string" || typeof v === "number") out[f] = v;
  }
  return out;
}

/**
 * The params the memo binds, from the exact fields the client POSTs (the route canonicalizes the
 * body the same way). A payload the route would refuse is not rejected here: the route answers it
 * with a 400, exactly as before the memo bound it.
 */
export async function keeperMemoParams(r: {
  slabAddress: string;
  dexPoolAddress: string;
  mainnetCA?: string | null;
  dexType?: string | null;
  symbol?: string | null;
  label?: string | null;
  payload?: Record<string, unknown> | null;
}): Promise<KeeperRegisterProofParams> {
  return {
    slabAddress: r.slabAddress,
    dexPoolAddress: r.dexPoolAddress,
    mainnetCA: r.mainnetCA ?? "",
    dexType: r.dexType ?? "",
    symbol: r.symbol ?? undefined,
    label: r.label ?? undefined,
    payloadDigest: await registrationPayloadDigest(boundPayloadSubset(r.payload)),
  };
}
