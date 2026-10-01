// @vitest-environment node
/**
 * Earn share count (coordinator round 3 #1): the program prices deposits and redemptions
 * against `LpVaultRegistryV16.total_lp_shares_outstanding` (P3 tags 75/77), NOT the LP mint
 * supply. Parity case emitted by Rust (scripts/limits-parity/bin/layouts.rs `registryVsMint`):
 * a registry with 1.0e9 shares while the mint supply is 1.25e9 — the two DIFFER, and the Rust
 * results for each are recorded. The app must match the REGISTRY results.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import * as C from "@/lib/limits/constants";
import { decodeLpVaultRegistryShares } from "@/lib/limits/decode";
import { earnDepositBlock, seniorAtomsForRedemption, seniorSharesForDeposit } from "@/lib/limits/vault-tranche";
import { earnGateShares, earnViewFromLimits } from "@/lib/limits/earn";
import { marketLimits } from "./fixtures";

const layouts = JSON.parse(readFileSync(join(__dirname, "..", "..", "fixtures", "limits", "rust-layouts.json"), "utf8"));
const R = layouts.registryVsMint as Record<string, string>;
const B = (x: string) => BigInt(x);

function registryAccount(): Uint8Array {
  const d = new Uint8Array(C.LP_VAULT_REGISTRY_ACCOUNT_LEN);
  d[C.HEADER_KIND_OFF] = 5; // wrapper KIND_LP_VAULT_REGISTRY (literal, not the constant under test)
  d.set(Buffer.from(R.registryHex, "hex"), 16);
  return d;
}

describe("registry share count", () => {
  it("offset from rustc; decodes the Rust-laid-out registry", () => {
    expect(C.REG_TOTAL_LP_SHARES_OUTSTANDING).toBe(C.HEADER_LEN + layouts.offsets["reg.total_lp_shares_outstanding"]);
    expect(decodeLpVaultRegistryShares(registryAccount())).toBe(B(R.registryShares));
    const wrongKind = registryAccount();
    wrongKind[10] = 9;
    expect(decodeLpVaultRegistryShares(wrongKind)).toBeNull();
  });

  it("parity: deposit/redeem priced on the REGISTRY count equal Rust; the mint count gives different numbers", () => {
    const reg = B(R.registryShares);
    const mint = B(R.mintSupply);
    expect(reg).not.toBe(mint);
    expect(seniorSharesForDeposit(B(R.amount), reg, B(R.cEff))).toBe(B(R.depositSharesRegistry));
    expect(seniorAtomsForRedemption(B(R.redeemShares), reg, B(R.senior))).toBe(B(R.redeemAtomsRegistry));
    // the same Rust fns fed the mint supply give OTHER answers — using it would misprice both ways
    expect(B(R.depositSharesMint)).not.toBe(B(R.depositSharesRegistry));
    expect(B(R.redeemAtomsMint)).not.toBe(B(R.redeemAtomsRegistry));
  });

  it("earnViewFromLimits prices the withdrawal on the registry count (== Rust)", () => {
    // fixture: C 1e9 + harvestable 2e6 => C_eff = senior = 1_002_000_000 (the parity case's senior)
    const L = marketLimits({ registryShares: B(R.registryShares) });
    const v = earnViewFromLimits(L, 1_000_000_000n, B(R.redeemShares))!;
    expect(v.senior).toBe(B(R.senior));
    expect(v.withdrawAtoms).toBe(B(R.redeemAtomsRegistry));
  });

  it("no registry read => no view and no gate guess (never falls back to the mint)", () => {
    const L = marketLimits({ registryShares: null });
    expect(earnViewFromLimits(L, 1_000_000_000n, 0n)).toBeNull();
    expect(earnGateShares(L)).toBeNull();
  });

  it("genesis gate keys on the REGISTRY count: registry 0 + pending fees => harvest-pending even with mint supply > 0", () => {
    const L = marketLimits({ registryShares: 0n });
    const v = earnViewFromLimits(L, 1_000_000_000n, 0n)!;
    expect(earnDepositBlock(v, earnGateShares(L)!)).toBe("harvest-pending");
    const L2 = marketLimits({ registryShares: 1_000_000_000n });
    expect(earnDepositBlock(earnViewFromLimits(L2, 1_000_000_000n, 0n), earnGateShares(L2)!)).toBeNull();
  });
});
