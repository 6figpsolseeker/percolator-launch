/**
 * Earn withdrawals on a NON-bound (legacy, two-pot) vault: the split-pot repair.
 *
 * WHY (live investigation 2026-10-01b, SI "Payout not sent"): ExecuteRedemption (77) prices the
 * payout on BOTH pots combined (`lp_vault_combined_available_principal_atoms`) but draws the
 * principal from ONE (`principal_portion > ledger.total_principal_atoms` -> Custom 25
 * EngineCounterUnderflow). The wizard seeded 1,000 USDC into each domain, so every wizard market
 * hits it as soon as one LP's claim exceeds one pot. The program's own remedy (#419) is the
 * permissionless RebalanceLpVaultBacking (91): move the sibling pot's movable principal into the
 * payout pot, in the user's own transaction, in front of 77. No tokens move; same vault.
 *
 * A 100% exit can still fail 77's stay-fully-backed gate (Custom 21: the pot's source credit rate
 * must stay at scale while traders hold positive claims against it). The cap below is that gate
 * solved for shares, so the app can offer "Withdraw max available now" instead of a failure.
 *
 * Every formula mirrors the deployed wrapper (percolator-prog feat/p3-vault-owned-lp @ bd4fe5f8,
 * engine 35ddd692):
 *   - sync_backing_domain_ledger / lp_vault_domain_available_principal_atoms / lp_vault_nav_atoms
 *   - handle_rebalance_lp_vault_backing (source gates + post-move credit rate)
 *   - handle_execute_redemption (ledger gate, fresh-unliened gate, credit-rate gate)
 * Pure; the hook reads the accounts. Layouts are the ones the investigation decoded live.
 */
import { SystemProgram, type Connection, type PublicKey, type TransactionInstruction } from "@solana/web3.js";
import {
  ACCOUNTS_REBALANCE_LP_VAULT_BACKING,
  WELL_KNOWN,
  buildAccountMetas,
  buildIx,
  deriveLpBackingLedger,
  deriveLpVaultRegistry,
  encodeRebalanceLpVaultBacking,
  parseLpVaultRegistry,
} from "@percolatorct/sdk";
import * as C from "./constants";
import { decodeLpVaultRegistryBound, u128 } from "./decode";

const BS = C.BOUND_SCALE;

/** `BackingBucketStatusV16::Fresh`. */
export const BUCKET_STATUS_FRESH = 1;
/** CancelRedemption (tag 81): data is the tag alone. */
export const TAG_CANCEL_REDEMPTION = 81;
/** Headroom kept below the exact cap: claims can grow between the request and the payout. */
export const SPLIT_POT_CAP_SAFETY_BPS = 10n; // 0.1%

export interface BackingBucket {
  freshUnliened: bigint;
  validLiened: bigint;
  consumed: bigint;
  impaired: bigint;
  utilFeeEarnings: bigint;
  status: number;
}

export interface SourceCredit {
  positiveClaimBound: bigint;
  freshReserved: bigint;
  validLienedBacking: bigint;
  insuranceCreditReserved: bigint;
  validLienedInsurance: bigint;
  impairedLienedInsurance: bigint;
}

export interface DomainLedger {
  totalPrincipal: bigint;
  totalEarnings: bigint;
  totalEarningsWithdrawn: bigint;
  lastObsBucketEarnings: bigint;
  cumulativeLoss: bigint;
  cumulativeRecovery: bigint;
  lastObsUnavailable: bigint;
}

export interface DomainState {
  bucket: BackingBucket;
  source: SourceCredit;
  /** null = the ledger account does not exist yet (the program seeds it from the bucket). */
  ledger: DomainLedger | null;
}

// ── Decoders (asset 0; domain even = long, odd = short) ─────────────────────────────────────

const SOURCE_LONG = C.SLOT_BACKING_LONG - 368;
const SOURCE_SHORT = C.SLOT_BACKING_LONG - 184;

export function decodeBackingBucket(d: Uint8Array, domain: number): BackingBucket | null {
  const b = C.assetEngineOff(Math.floor(domain / 2)) + (domain % 2 === 0 ? C.SLOT_BACKING_LONG : C.SLOT_BACKING_SHORT);
  if (d.length < b + 97) return null;
  return {
    freshUnliened: u128(d, b + 8),
    validLiened: u128(d, b + 24),
    consumed: u128(d, b + 40),
    impaired: u128(d, b + 56),
    utilFeeEarnings: u128(d, b + 72),
    status: d[b + 96],
  };
}

export function decodeSourceCredit(d: Uint8Array, domain: number): SourceCredit | null {
  const s = C.assetEngineOff(Math.floor(domain / 2)) + (domain % 2 === 0 ? SOURCE_LONG : SOURCE_SHORT);
  if (d.length < s + 16 * 10) return null;
  const f = (i: number) => u128(d, s + i * 16);
  return {
    positiveClaimBound: f(0),
    freshReserved: f(2),
    validLienedBacking: f(5),
    insuranceCreditReserved: f(7),
    validLienedInsurance: f(8),
    impairedLienedInsurance: f(9),
  };
}

/** `BackingDomainLedgerAccountV16` (16 B discriminator/version + 64 B keys, then u128 fields). */
export function decodeDomainLedger(d: Uint8Array | null): DomainLedger | null {
  if (!d || d.length < 80 + 16 * 9) return null;
  const f = (i: number) => u128(d, 80 + i * 16);
  return {
    totalPrincipal: f(0),
    totalEarnings: f(3),
    totalEarningsWithdrawn: f(4),
    lastObsBucketEarnings: f(5),
    cumulativeLoss: f(6),
    cumulativeRecovery: f(7),
    lastObsUnavailable: f(8),
  };
}

// ── Program math ─────────────────────────────────────────────────────────────────────────────

/** `backing_unavailable_principal_atoms`. */
function unavailableAtoms(b: BackingBucket): bigint {
  return (b.consumed + b.impaired) / BS;
}

/** `read_or_new_backing_domain_ledger` + `sync_backing_domain_ledger`, as every handler runs it. */
export function syncedLedger(dom: DomainState): DomainLedger {
  const b = dom.bucket;
  if (!dom.ledger) {
    // new_backing_domain_ledger (what 77 / 91 read for a ledger that does not exist yet): zero
    // principal, watermarks pinned to the bucket, so the sync below books nothing.
    return {
      totalPrincipal: 0n,
      totalEarnings: 0n,
      totalEarningsWithdrawn: 0n,
      lastObsBucketEarnings: b.utilFeeEarnings,
      cumulativeLoss: 0n,
      cumulativeRecovery: 0n,
      lastObsUnavailable: unavailableAtoms(b),
    };
  }
  const l = { ...dom.ledger };
  if (b.utilFeeEarnings >= l.lastObsBucketEarnings) l.totalEarnings += b.utilFeeEarnings - l.lastObsBucketEarnings;
  l.lastObsBucketEarnings = b.utilFeeEarnings;
  const unavailable = unavailableAtoms(b);
  if (unavailable >= l.lastObsUnavailable) l.cumulativeLoss += unavailable - l.lastObsUnavailable;
  else l.cumulativeRecovery += l.lastObsUnavailable - unavailable;
  l.lastObsUnavailable = unavailable;
  return l;
}

/** `lp_vault_domain_available_principal_atoms` (null = the program would underflow). */
export function availablePrincipal(l: DomainLedger): bigint | null {
  const net = l.cumulativeLoss - l.cumulativeRecovery;
  if (net < 0n || l.totalPrincipal < net) return null;
  return l.totalPrincipal - net;
}

/** `lp_vault_nav_atoms`. */
export function domainNav(l: DomainLedger, feeShareBps: number): bigint | null {
  const avail = availablePrincipal(l);
  if (avail === null) return null;
  const netEarnings = l.totalEarnings - l.totalEarningsWithdrawn;
  if (netEarnings < 0n) return null;
  return avail + (netEarnings * BigInt(feeShareBps)) / 10_000n;
}

/** Source backing still available to cover claims (`source_credit_available_backing_num`). */
function sourceAvailableNum(s: SourceCredit): bigint {
  const insuranceFree = s.insuranceCreditReserved - (s.validLienedInsurance + s.impairedLienedInsurance);
  return s.freshReserved - s.validLienedBacking + (insuranceFree > 0n ? insuranceFree : 0n);
}

/** Most backing (atoms) that can leave this source while its credit rate stays at scale. */
function creditRoomAtoms(s: SourceCredit): bigint {
  const avail = sourceAvailableNum(s);
  if (s.positiveClaimBound === 0n) return s.freshReserved / BS;
  const room = avail - s.positiveClaimBound;
  if (room <= 0n) return 0n;
  const r = room / BS;
  const cap = s.freshReserved / BS;
  return r < cap ? r : cap;
}

const min = (...xs: bigint[]) => xs.reduce((a, b) => (b < a ? b : a));
const pos = (x: bigint) => (x > 0n ? x : 0n);

/** Combined NAV and available principal of the two pots, as 77 prices them. */
export function combinedVault(own: DomainState, sib: DomainState, feeShareBps: number): { nav: bigint; available: bigint } | null {
  const lo = syncedLedger(own);
  const ls = syncedLedger(sib);
  const ao = availablePrincipal(lo);
  const as = availablePrincipal(ls);
  const no = domainNav(lo, feeShareBps);
  const ns = domainNav(ls, feeShareBps);
  if (ao === null || as === null || no === null || ns === null) return null;
  return { nav: no + ns, available: ao + as };
}

/** The most principal 91 can move out of `sib` (0 when nothing can move). */
export function movablePrincipal(sib: DomainState): bigint {
  if (sib.bucket.status !== BUCKET_STATUS_FRESH) return 0n;
  const ls = syncedLedger(sib);
  const avail = availablePrincipal(ls);
  if (avail === null) return 0n;
  return pos(min(avail, ls.totalPrincipal, sib.bucket.freshUnliened / BS, creditRoomAtoms(sib.source)));
}

export interface SplitPotPlan {
  /** Principal 91 moves sibling -> payout pot in front of 77 (0n = 77 needs no help). */
  rebalance: bigint;
  /** What 77 pays for `shares`, and its principal part. */
  atoms: bigint;
  principal: bigint;
  /** Largest share count 77 can pay right now (after the rebalance), before the safety margin. */
  maxShares: bigint;
  /** `shares <= maxShares`. */
  payable: boolean;
}

/**
 * Plan a non-bound 77 that pays `shares` out of `own` (the registry's domain).
 * null = the vault's counters could not be priced (the program would refuse too).
 */
export function planSplitPotRedemption(p: {
  own: DomainState;
  sib: DomainState;
  totalShares: bigint;
  shares: bigint;
  feeShareBps: number;
}): SplitPotPlan | null {
  if (p.totalShares <= 0n) return null;
  const v = combinedVault(p.own, p.sib, p.feeShareBps);
  if (!v) return null;
  const lo = syncedLedger(p.own);
  const principalFor = (s: bigint) => (s * v.available) / p.totalShares;
  const atomsFor = (s: bigint) => (s * v.nav) / p.totalShares;
  const atoms = atomsFor(p.shares);
  const principal = principalFor(p.shares);

  // Most principal the payout pot can release, with `r` moved in by 91. Every term grows by r.
  const ownCap = (r: bigint) =>
    pos(min(lo.totalPrincipal + r, (p.own.bucket.freshUnliened + r * BS) / BS, creditRoomAtoms({ ...p.own.source, freshReserved: p.own.source.freshReserved + r * BS })));
  // 77's earnings gate: the LP earnings slice is drawn from the PAYOUT pot's bucket only
  // (gross_consumed = ceil(earnings * 10_000 / fee_share_bps) <= utilization_fee_earnings). 91 moves
  // principal, never earnings, so this cannot be repaired here; it only lowers the cap.
  const earningsOk = (s: bigint) => {
    const earnings = atomsFor(s) - principalFor(s);
    if (earnings <= 0n) return true;
    if (p.feeShareBps <= 0) return false;
    const fee = BigInt(p.feeShareBps);
    const gross = (earnings * 10_000n + fee - 1n) / fee;
    return gross <= p.own.bucket.utilFeeEarnings;
  };

  const movable = movablePrincipal(p.sib);
  const capMax = ownCap(movable);
  const payableFor = (s: bigint) => principalFor(s) <= capMax && earningsOk(s);
  // Move only what this payout needs (the sibling keeps the rest of its headroom).
  const need = principal - ownCap(0n);
  const rebalance = need > 0n ? (need < movable ? need : movable) : 0n;

  // Largest payable share count (both gates are monotone in s, up to floor wobble): binary search.
  let lo_ = 0n;
  let hi = p.totalShares;
  while (lo_ < hi) {
    const mid = (lo_ + hi + 1n) / 2n;
    if (payableFor(mid)) lo_ = mid;
    else hi = mid - 1n;
  }
  return { rebalance, atoms, principal, maxShares: lo_, payable: payableFor(p.shares) && principal <= ownCap(rebalance) };
}

/** The share count to re-request when the full amount cannot pay: the cap less the safety margin. */
export function cappedShares(maxShares: bigint, held: bigint): bigint {
  const s = (maxShares * (10_000n - SPLIT_POT_CAP_SAFETY_BPS)) / 10_000n;
  return s < held ? s : held;
}

// ── Instructions ─────────────────────────────────────────────────────────────────────────────

/** RebalanceLpVaultBacking (91): [cranker (s,w), market (w), registry, fromLedger (w), toLedger (w), system]. */
export function buildRebalanceBackingIx(p: {
  programId: PublicKey;
  cranker: PublicKey;
  market: PublicKey;
  registry: PublicKey;
  fromLedger: PublicKey;
  toLedger: PublicKey;
  fromDomain: number;
  toDomain: number;
  amount: bigint;
}): TransactionInstruction {
  return buildIx({
    programId: p.programId,
    keys: buildAccountMetas(ACCOUNTS_REBALANCE_LP_VAULT_BACKING, [p.cranker, p.market, p.registry, p.fromLedger, p.toLedger, SystemProgram.programId]),
    data: encodeRebalanceLpVaultBacking({ fromDomain: p.fromDomain, toDomain: p.toDomain, amount: p.amount.toString() }),
  });
}

/** CancelRedemption (81): [redeemer (s,w), registry, redemption (w), lpMint, redeemerLpAta (w), escrow (w), tokenProgram]. */
export function buildCancelRedemptionIx(p: {
  programId: PublicKey;
  redeemer: PublicKey;
  registry: PublicKey;
  redemption: PublicKey;
  lpMint: PublicKey;
  redeemerLpAta: PublicKey;
  escrow: PublicKey;
}): TransactionInstruction {
  return buildIx({
    programId: p.programId,
    keys: [
      { pubkey: p.redeemer, isSigner: true, isWritable: true },
      { pubkey: p.registry, isSigner: false, isWritable: false },
      { pubkey: p.redemption, isSigner: false, isWritable: true },
      { pubkey: p.lpMint, isSigner: false, isWritable: false },
      { pubkey: p.redeemerLpAta, isSigner: false, isWritable: true },
      { pubkey: p.escrow, isSigner: false, isWritable: true },
      { pubkey: WELL_KNOWN.tokenProgram, isSigner: false, isWritable: false },
    ],
    data: new Uint8Array([TAG_CANCEL_REDEMPTION]),
  });
}

/**
 * Thrown before the wallet opens when the pending (or requested) redemption is larger than the
 * vault can pay right now. The UI turns it into "Withdraw max available now: X".
 */
export class EarnPayoutCapError extends Error {
  constructor(public readonly maxShares: bigint, public readonly maxAtoms: bigint) {
    super("Earn payout above what the vault can pay now");
    this.name = "EarnPayoutCapError";
  }
}

// ── Read (one round trip) ────────────────────────────────────────────────────────────────────

export interface SplitPotState {
  own: DomainState;
  sib: DomainState;
  ownDomain: number;
  totalShares: bigint;
  feeShareBps: number;
  ownLedger: PublicKey;
  sibLedger: PublicKey;
}

/**
 * Market + registry + both pot ledgers. null = a BOUND (P3) vault (its 77 tops the pot up from
 * the sibling by itself), or anything unreadable (the caller then sends the plain 77).
 */
export async function readSplitPotState(
  connection: Connection,
  programId: PublicKey,
  market: PublicKey,
): Promise<SplitPotState | null> {
  try {
    const [registry] = deriveLpVaultRegistry(programId, market);
    const r = await connection.getAccountInfo(registry, "confirmed");
    if (!r || !r.owner.equals(programId)) return null;
    const rd = new Uint8Array(r.data);
    if (decodeLpVaultRegistryBound(rd) !== false) return null;
    const reg = parseLpVaultRegistry(rd);
    const ownDomain = Number(reg.domain);
    const [ownLedger] = deriveLpBackingLedger(programId, market, ownDomain);
    const [sibLedger] = deriveLpBackingLedger(programId, market, ownDomain ^ 1);
    const [m, lo, ls] = await connection.getMultipleAccountsInfo([market, ownLedger, sibLedger], "confirmed");
    if (!m) return null;
    const md = new Uint8Array(m.data);
    const dom = (i: number, a: { data: Uint8Array | Buffer } | null): DomainState | null => {
      const bucket = decodeBackingBucket(md, i);
      const source = decodeSourceCredit(md, i);
      return bucket && source ? { bucket, source, ledger: decodeDomainLedger(a ? new Uint8Array(a.data) : null) } : null;
    };
    const own = dom(ownDomain, lo);
    const sib = dom(ownDomain ^ 1, ls);
    if (!own || !sib) return null;
    return { own, sib, ownDomain, totalShares: BigInt(reg.totalLpSharesOutstanding), feeShareBps: Number(reg.feeShareBps), ownLedger, sibLedger };
  } catch {
    return null;
  }
}
