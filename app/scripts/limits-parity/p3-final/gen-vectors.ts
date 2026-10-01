/**
 * Emits `id hex` lines from the app's P3 encoders (app/lib/limits/p3-ix.ts) for the Rust
 * oracle (main.rs), which decodes each with the REAL `ix::Instruction::decode` of
 * percolator-prog feat/p3-vault-owned-lp@4b1a5d30 (FINAL, senior draw, pause code 89). `__short` / `__long` variants must be
 * REFUSED by the decoder (exact wire length).
 *   npx tsx app/scripts/limits-parity/p3-final/gen-vectors.ts > vectors.txt
 */
import * as ix from "../../../lib/limits/p3-ix";
import { ASSET_VAULT_LP_OFF, assetWrapperOff } from "../../../lib/limits/constants";

const hex = (b: Uint8Array): string => Buffer.from(b).toString("hex");
const U64 = (1n << 64n) - 1n;
const U128 = (1n << 128n) - 1n;
const v: [string, Uint8Array][] = [
  ["init_vault_lp_min", ix.encodeInitVaultLp(1_000)],
  ["init_vault_lp_max", ix.encodeInitVaultLp(10_000)],
  ["deposit_junior", ix.encodeDepositJuniorTranche(123_456_789n)],
  ["deposit_junior_u128max", ix.encodeDepositJuniorTranche(U128)],
  ["withdraw_junior", ix.encodeWithdrawJuniorTranche((1n << 70n) + 5n)],
  ["recall", ix.encodeVaultLpRecall(987_654_321n, 3)],
  ["settle_resolved_close", ix.encodeVaultLpSettleResolved(0)],
  ["settle_resolved_topup", ix.encodeVaultLpSettleResolved(1)],
  ["close_portfolio", ix.encodeClosePortfolio(7n, 42n, 3n)],
  ["close_portfolio_max", ix.encodeClosePortfolio(U64, U64 - 1n, 1n << 40n)],
  ["close_resolved", ix.encodeCloseResolved(0n)],
  ["claim_topup", ix.encodeClaimResolvedPayoutTopup()],
  ["crank_fees_d0", ix.encodeLpVaultCrankFees(0)],
  ["crank_fees_d1", ix.encodeLpVaultCrankFees(1)],
  ["release_surplus", ix.encodeVaultLpReleaseSurplus(60_000_000n, 0)],
  ["release_surplus_max", ix.encodeVaultLpReleaseSurplus(U128, 1)],
];
for (const [id, b] of v) {
  console.log(`${id} ${hex(b)}`);
  if (b.length > 1) console.log(`${id}__short ${hex(b.subarray(0, b.length - 1))}`);
  console.log(`${id}__long ${hex(Uint8Array.from([...b, 0]))}`);
}
// The app's per-asset AssetVaultLpV18 offset: the oracle plants a record HERE and reads it back
// with the program's own `read_asset_vault_lp`.
for (let i = 0; i < 4; i++) console.log(`@asset_vault_lp_off_${i} ${assetWrapperOff(i) + ASSET_VAULT_LP_OFF}`);
