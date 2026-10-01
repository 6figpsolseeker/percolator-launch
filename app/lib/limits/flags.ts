/**
 * Phase flags for the limits UI (plan §3). Build-time `NEXT_PUBLIC_*`, inlined
 * by Next — each read must be a literal `process.env.NEXT_PUBLIC_X` access so
 * the bundler can substitute it. Default OFF: the live devnet program (v18.2)
 * enforces none of these rules, and its P1/P3 bytes read all-zero, so showing
 * the panels there would display limits that are not enforced.
 */
export interface LimitsFlags {
  p1: boolean;
  p2: boolean;
  /** The wrapper charges the matcher's requested fee (P2-4). Never implied by p2. */
  p2FeeCharged: boolean;
  p3: boolean;
}

const on = (v: string | undefined): boolean => v === "1" || v === "true";

export function readLimitsFlags(): LimitsFlags {
  return {
    p1: on(process.env.NEXT_PUBLIC_LIMITS_P1),
    p2: on(process.env.NEXT_PUBLIC_LIMITS_P2),
    p2FeeCharged: on(process.env.NEXT_PUBLIC_LIMITS_P2_FEE_CHARGED),
    p3: on(process.env.NEXT_PUBLIC_LIMITS_P3),
  };
}

/** Test/override seam: `null` = read env. */
let override: LimitsFlags | null = null;
export function __setLimitsFlagsForTest(f: LimitsFlags | null): void {
  override = f;
}
export function limitsFlags(): LimitsFlags {
  return override ?? readLimitsFlags();
}

/**
 * The create-market wizard binds new markets the P3 way (vault-owned LP + junior tranche) when
 * P3 is on. Kill switch NEXT_PUBLIC_LIMITS_P3_WIZARD=0 keeps the legacy creator-LP launch while
 * the rest of the P3 UI stays on (e.g. to pause new vault-LP markets while the auto-pinned
 * caps are reviewed).
 */
export function p3WizardEnabled(): boolean {
  if (!limitsFlags().p3) return false;
  const v = process.env.NEXT_PUBLIC_LIMITS_P3_WIZARD?.trim().toLowerCase();
  return !(v === "0" || v === "false" || v === "off");
}
