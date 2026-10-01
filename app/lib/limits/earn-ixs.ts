/**
 * P3 Earn transaction plan (tags 75 / 76 / 77 on a vault-owned-LP market), from the handler
 * bodies at feat/p3-vault-owned-lp@424fe7e4:
 *
 *   - a BOUND registry (`_reserved[0] == 1`) makes the vault-LP tail REQUIRED, fail closed:
 *     75 [11] vault_lp_state (w) + [12] lp, 77 [13] + [14]; 76 takes none;
 *   - 77 (bound) refuses VaultLpHarvestPending (84) while LP fees are harvestable (P3-K1): bundle
 *     78 in front, in the same tx. Since 07a1d0eb 78 also runs on a Resolved bound vault once
 *     terminal-flat (the only state a Resolved 77 is allowed in), so the same bundle works there;
 *   - 75 (bound) refuses 84 at GENESIS (no shares yet) while fees are harvestable (P3-L1): bundle
 *     78 first (on a bound vault with no seniors it credits the junior);
 *   - registry flag other than 0/1 => the program refuses every Earn op (InvalidAccountData).
 * Pure; the hook reads the accounts and executes.
 */
import type { PublicKey, TransactionInstruction } from "@solana/web3.js";
import { ACCOUNTS_LP_VAULT_DEPOSIT, ACCOUNTS_REBALANCE_LP_VAULT_BACKING, buildAccountMetas, buildIx, encodeDepositToLpVault, encodeExecuteRedemption, encodeRebalanceLpVaultBacking, encodeRequestRedeemLpShares, WELL_KNOWN } from "@percolatorct/sdk";
import { buildLpVaultCrankFeesIx, withBoundVaultLpTail } from "./p3-ix";
import { MARKET_MODE_LIVE, TAG_DEPOSIT_TO_LP_VAULT, TAG_EXECUTE_REDEMPTION, TAG_REQUEST_REDEEM_LP_SHARES } from "./constants";

export type EarnOp = typeof TAG_DEPOSIT_TO_LP_VAULT | typeof TAG_REQUEST_REDEEM_LP_SHARES | typeof TAG_EXECUTE_REDEMPTION;

export interface EarnP3Context {
  /** decodeLpVaultRegistryBound: false (legacy vault), true (P3 bound), "invalid", null (unreadable). */
  bound: boolean | "invalid" | null;
  vaultLpState: PublicKey;
  /** VaultLpStateV18.lp_portfolio (null = the state account could not be decoded). */
  lpPortfolio: PublicKey | null;
  /** lp_vault_harvestable_fee_atoms (null = unreadable). */
  harvestable: bigint | null;
  registryShares: bigint | null;
  mode: number;
  /** F-14: Resolved + no materialized portfolio + c_tot 0. */
  terminalFlat?: boolean;
  /** F-14 claim-free residual (decodeTerminalBacking); null = unreadable. */
  terminalResidual?: bigint | null;
}

export type EarnTxPlan =
  | { ok: true; tail: { vaultLpState: PublicKey; lpPortfolio: PublicKey } | null; prependHarvest: boolean }
  | { ok: false; reason: "registry-invalid" | "vault-lp-unreadable" };

export function earnTxPlan(op: EarnOp, c: EarnP3Context): EarnTxPlan {
  if (op === TAG_REQUEST_REDEEM_LP_SHARES) return { ok: true, tail: null, prependHarvest: false };
  if (c.bound === "invalid") return { ok: false, reason: "registry-invalid" };
  // Unreadable registry: send the legacy shape; a bound vault then fails closed on-chain
  // (NotEnoughAccountKeys) rather than being priced off backing alone.
  if (c.bound !== true) return { ok: true, tail: null, prependHarvest: false };
  if (!c.lpPortfolio) return { ok: false, reason: "vault-lp-unreadable" };
  const tail = { vaultLpState: c.vaultLpState, lpPortfolio: c.lpPortfolio };
  const pending = c.harvestable !== null && c.harvestable > 0n;
  const live = c.mode === MARKET_MODE_LIVE;
  if (op === TAG_EXECUTE_REDEMPTION) {
    // F-14: at terminal-flat a residual also makes 77 refuse 84 until 78 absorbed it.
    const residual = !live && c.terminalFlat === true && (c.terminalResidual ?? 0n) > 0n;
    return { ok: true, tail, prependHarvest: pending || residual };
  }
  // 75
  const genesis = c.registryShares === 0n;
  return { ok: true, tail, prependHarvest: pending && genesis && live };
}

// ── Assembly (shared by useInsuranceLP and the LiteSVM bridge, so the sim runs THIS code) ──

type OkPlan = Extract<EarnTxPlan, { ok: true }>;

function harvestIx(p: { programId: PublicKey; cranker: PublicKey; market: PublicKey; registry: PublicKey; ledger: PublicKey; siblingLedger: PublicKey; domain: number }, plan: OkPlan): TransactionInstruction[] {
  if (!plan.prependHarvest || !plan.tail) return [];
  return [buildLpVaultCrankFeesIx({ ...p, bound: { vaultLpState: plan.tail.vaultLpState } })];
}

/**
 * [78 if the plan says so, 75]. 75 accounts (`handle_deposit_to_lp_vault`): [depositor (s,w),
 * market (w), registry (w), lpMint (w), depositorLpAta (w), sourceToken (w), vaultToken (w),
 * ledger (w), tokenProgram, systemProgram, siblingLedger (w)] (+ bound tail [11], [12]).
 */
export function buildEarnDepositIxs(p: {
  programId: PublicKey;
  depositor: PublicKey;
  market: PublicKey;
  registry: PublicKey;
  lpMint: PublicKey;
  depositorLpAta: PublicKey;
  sourceToken: PublicKey;
  vaultToken: PublicKey;
  ledger: PublicKey;
  siblingLedger: PublicKey;
  domain: number;
  amount: bigint;
  plan: OkPlan;
}): TransactionInstruction[] {
  const base = buildAccountMetas(ACCOUNTS_LP_VAULT_DEPOSIT, [
    p.depositor,
    p.market,
    p.registry,
    p.lpMint,
    p.depositorLpAta,
    p.sourceToken,
    p.vaultToken,
    p.ledger,
    WELL_KNOWN.tokenProgram,
    WELL_KNOWN.systemProgram,
    p.siblingLedger,
  ]);
  const keys = p.plan.tail ? withBoundVaultLpTail(TAG_DEPOSIT_TO_LP_VAULT, base, p.plan.tail.vaultLpState, p.plan.tail.lpPortfolio) : base;
  return [
    ...harvestIx({ programId: p.programId, cranker: p.depositor, market: p.market, registry: p.registry, ledger: p.ledger, siblingLedger: p.siblingLedger, domain: p.domain }, p.plan),
    buildIx({ programId: p.programId, keys, data: encodeDepositToLpVault({ amount: p.amount.toString(), domain: p.domain }) }),
  ];
}

/** LP backing ledger `total_principal_atoms`: u128 at 80 (16-byte header + market_group +
 *  authority). 0 when the account is missing or too short. */
export function ledgerPrincipalAtoms(data: Uint8Array | null | undefined): bigint {
  if (!data || data.length < 96) return 0n;
  const v = new DataView(data.buffer, data.byteOffset + 80, 16);
  return v.getBigUint64(0, true) | (v.getBigUint64(8, true) << 64n);
}

/**
 * Atoms an UNBOUND 77 needs moved into its own pot first (GH#419). The program prices the
 * payout on both pots but draws it from one; only a bound vault tops the pot up inside the 77
 * (221cf006), so an unbound claim larger than its own pot refuses EngineCounterUnderflow (25).
 * Capped at what the sibling holds; 0 when the own pot covers it. An estimate on the ledgers'
 * total principal: the program prices after a bucket sync the client does not replicate, so
 * the caller tries a small ladder around it (rebalanceLadder) under the pre-sign simulation.
 */
export function unboundPotShortfall(p: { shares: bigint; totalShares: bigint; own: bigint; sibling: bigint }): bigint {
  if (p.totalShares <= 0n) return 0n;
  const need = (p.shares * (p.own + p.sibling)) / p.totalShares - p.own;
  if (need <= 0n) return 0n;
  return need < p.sibling ? need : p.sibling;
}

/**
 * [78 if the plan says so, 91 if `rebalanceAtoms` (unbound only), 77]. 91 is the permissionless
 * RebalanceLpVaultBacking, sibling pot -> the 77's pot. 77 accounts (`handle_execute_redemption`): [cranker (s,w),
 * market (w), registry (w), redemption (w), lpMint (w), escrow (w), vaultToken (w),
 * vaultAuthority, ledger (w), redeemerDest (w), tokenProgram, siblingLedger (w),
 * redeemerRentDest (w, == the recorded redeemer; #461)] (+ bound tail [13], [14]).
 */
export function buildEarnExecuteIxs(p: {
  programId: PublicKey;
  redeemer: PublicKey;
  market: PublicKey;
  registry: PublicKey;
  redemption: PublicKey;
  lpMint: PublicKey;
  escrow: PublicKey;
  vaultToken: PublicKey;
  vaultAuthority: PublicKey;
  ledger: PublicKey;
  redeemerDest: PublicKey;
  siblingLedger: PublicKey;
  domain: number;
  plan: OkPlan;
  rebalanceAtoms?: bigint;
}): TransactionInstruction[] {
  if (p.rebalanceAtoms && p.plan.tail) throw new Error("a bound vault tops its pot up inside the 77; no 91");
  const rebalance = p.rebalanceAtoms
    ? [buildIx({
        programId: p.programId,
        keys: buildAccountMetas(ACCOUNTS_REBALANCE_LP_VAULT_BACKING, [p.redeemer, p.market, p.registry, p.siblingLedger, p.ledger, WELL_KNOWN.systemProgram]),
        data: encodeRebalanceLpVaultBacking({ fromDomain: p.domain ^ 1, toDomain: p.domain, amount: p.rebalanceAtoms }),
      })]
    : [];
  const base = [
    { pubkey: p.redeemer, isSigner: true, isWritable: true },
    { pubkey: p.market, isSigner: false, isWritable: true },
    { pubkey: p.registry, isSigner: false, isWritable: true },
    { pubkey: p.redemption, isSigner: false, isWritable: true },
    { pubkey: p.lpMint, isSigner: false, isWritable: true },
    { pubkey: p.escrow, isSigner: false, isWritable: true },
    { pubkey: p.vaultToken, isSigner: false, isWritable: true },
    { pubkey: p.vaultAuthority, isSigner: false, isWritable: false },
    { pubkey: p.ledger, isSigner: false, isWritable: true },
    { pubkey: p.redeemerDest, isSigner: false, isWritable: true },
    { pubkey: WELL_KNOWN.tokenProgram, isSigner: false, isWritable: false },
    { pubkey: p.siblingLedger, isSigner: false, isWritable: true },
    { pubkey: p.redeemer, isSigner: false, isWritable: true },
  ];
  const keys = p.plan.tail ? withBoundVaultLpTail(TAG_EXECUTE_REDEMPTION, base, p.plan.tail.vaultLpState, p.plan.tail.lpPortfolio) : base;
  return [
    ...harvestIx({ programId: p.programId, cranker: p.redeemer, market: p.market, registry: p.registry, ledger: p.ledger, siblingLedger: p.siblingLedger, domain: p.domain }, p.plan),
    ...rebalance,
    buildIx({ programId: p.programId, keys, data: encodeExecuteRedemption({ domain: p.domain }) }),
  ];
}

/**
 * RequestRedeemLpShares (tag 76): [redeemer(s,w), registry(w), lpMint, redeemerLpAta(w), escrow(w),
 * redemption(w), tokenProgram, systemProgram] (percolator-prog handle_request_redeem_lp_shares).
 * Shared by useInsuranceLP.withdraw and the resolved "Finish now" batch (UX WP-8).
 */
export function buildRequestRedeemIx(p: {
  programId: PublicKey;
  redeemer: PublicKey;
  registry: PublicKey;
  lpMint: PublicKey;
  redeemerLpAta: PublicKey;
  escrow: PublicKey;
  redemption: PublicKey;
  shares: bigint;
}): TransactionInstruction {
  return buildIx({
    programId: p.programId,
    keys: [
      { pubkey: p.redeemer, isSigner: true, isWritable: true },
      { pubkey: p.registry, isSigner: false, isWritable: true },
      { pubkey: p.lpMint, isSigner: false, isWritable: false },
      { pubkey: p.redeemerLpAta, isSigner: false, isWritable: true },
      { pubkey: p.escrow, isSigner: false, isWritable: true },
      { pubkey: p.redemption, isSigner: false, isWritable: true },
      { pubkey: WELL_KNOWN.tokenProgram, isSigner: false, isWritable: false },
      { pubkey: WELL_KNOWN.systemProgram, isSigner: false, isWritable: false },
    ],
    data: encodeRequestRedeemLpShares({ shares: p.shares.toString() }),
  });
}

/**
 * Wrapper 5544302a: on a Resolved market at terminal-flat, a bound vault's 77 refuses 84
 * (VaultLpHarvestPending) until tag 78 has absorbed the STRAY pot backing (the vault LP's
 * claim-originated payout recycled at 101), which the app does not decode. The simulate-first
 * send answers it: the first attempt is simulated before any prompt; on a pre-sign 84 the same
 * transaction is rebuilt with 78 in front and sent once more (still one wallet prompt).
 */
export async function sendWithHarvestOn84<T>(p: {
  build: (forceHarvest: boolean) => Promise<TransactionInstruction[]>;
  send: (ixs: TransactionInstruction[]) => Promise<T>;
  isHarvestPendingRefusal: (e: unknown) => boolean;
}): Promise<T> {
  try {
    return await p.send(await p.build(false));
  } catch (e) {
    if (!p.isHarvestPendingRefusal(e)) throw e;
    return p.send(await p.build(true));
  }
}

/**
 * The 91 amounts to try, in order, for a shortfall estimate `need` against an own pot of `own`
 * and a sibling of `sibling`: need + 0.1% and + 1% of the payout, then need alone, each capped at
 * the sibling. The estimate leaves out the bucket sync (pending loss, consumed backing a 91
 * repays on arrival), which put devnet SI's real boundary 23,798 atoms above it on 2026-10-01;
 * moving extra between one vault's own pots is value-neutral, so the margins cost nothing.
 */
export function rebalanceLadder(need: bigint, own: bigint, sibling: bigint): bigint[] {
  if (need <= 0n || sibling <= 0n) return [];
  const payout = need + own;
  const cap = (x: bigint) => (x < sibling ? x : sibling);
  return [...new Set([cap(need + payout / 1000n), cap(need + payout / 100n), cap(need)])];
}

/**
 * GH#419: send the payout as-is; only on a pre-sign 25 (an unbound claim larger than its own
 * pot) read the 91 amounts and resend with each in front until one passes the pre-sign
 * simulation (the wallet opens only for that one). Gating on the 25 means a 91 is never added
 * to a payout that passes alone. A failed read, or no amount that passes, rethrows the 25.
 */
export async function sendWithRebalanceOn25<T>(p: {
  send: (rebalanceAtoms: bigint) => Promise<T>;
  readAmounts: () => Promise<bigint[]>;
  isPotShortfallRefusal: (e: unknown) => boolean;
  isPreSignRefusal: (e: unknown) => boolean;
}): Promise<T> {
  try {
    return await p.send(0n);
  } catch (e) {
    if (!p.isPotShortfallRefusal(e)) throw e;
    const amounts = await p.readAmounts().catch(() => [] as bigint[]);
    for (const atoms of amounts) {
      try {
        return await p.send(atoms);
      } catch (next) {
        if (!p.isPreSignRefusal(next)) throw next;
      }
    }
    throw e;
  }
}

/** The plan with 78 forced in front (bound vault only; the tail is needed for 78's accounts). */
export function withForcedHarvest(plan: EarnTxPlan, force: boolean): EarnTxPlan {
  if (!force || !plan.ok || !plan.tail) return plan;
  return { ...plan, prependHarvest: true };
}
