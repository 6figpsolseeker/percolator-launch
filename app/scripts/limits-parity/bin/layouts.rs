//! Emits fixture bytes for the P1/P3 records using the struct definitions copied VERBATIM
//! (field order + types) from feat/p1-safety-release@e74809b1 `AssetRiskLimitsV17` and
//! feat/p3-vault-owned-lp@0be66041 `AssetVaultLpV18` / `VaultLpStateV18` — re-checked field by
//! field IDENTICAL at the FINAL combined head 07a1d0eb (P1 3acb34ae), with offset_of! asserts
//! so the TS offsets are checked by rustc's repr(C) layout, not by hand.
use core::mem::{offset_of, size_of};
#[path = "../p3_vault.rs"]
#[allow(dead_code)]
mod p3;
/// Verbatim field order/types from feat/p3-vault-owned-lp@8dffb534 `LpVaultRegistryV16` (160 B).
#[repr(C)] #[derive(Clone, Copy, Default)]
pub struct LpVaultRegistryV16 { pub market_group: [u8; 32], pub lp_mint: [u8; 32], pub total_lp_shares_outstanding: u128, pub insurance_fee_snapshot_atoms: u128, pub fee_distribution_total_atoms: u128, pub epoch: u64, pub redemption_cooldown_slots: u64, pub fee_share_bps: u16, pub oi_reservation_threshold_bps: u16, pub domain: u16, pub paused: u8, pub version: u8, pub bump: u8, pub mint_bump: u8, pub _padding: [u8; 6], pub _reserved: [u8; 16] }
#[repr(C)] #[derive(Clone, Copy, Default)]
pub struct AssetRiskLimitsV17 { pub side_oi_cap_q: u128, pub lp_floor_atoms: u128, pub lp_exposure_k_bps: u32, pub exec_band_bps: u16, pub matcher_ext_mode: u8, pub _reserved0: u8, pub max_requested_fee_bps: u16, pub _reserved: [u8; 22] }
#[repr(C)] #[derive(Clone, Copy, Default)]
pub struct AssetVaultLpV18 { pub vault_lp_portfolio: [u8; 32], pub lp_net_q: i128, pub lev_cap_q: u128, pub lp_net_slot: u64, pub skew_slope_e9: u64, pub skew_max_e9: u64, pub lev_max_imr_bps: u16, pub flags: u8, pub _reserved0: u8, pub vault_lp_max_lev_bps: u32, pub approved_matcher_program: [u8; 32] }
#[repr(C)] #[derive(Clone, Copy, Default)]
pub struct VaultLpStateV18 { pub market_group: [u8; 32], pub registry: [u8; 32], pub lp_portfolio: [u8; 32], pub junior_owner: [u8; 32], pub senior_claim_atoms: u128, pub junior_deposited_atoms: u128, pub junior_withdrawn_atoms: u128, pub senior_fee_credited_atoms: u128, pub recalled_atoms: u128, pub asset_index: u16, pub junior_floor_bps: u16, pub senior_fee_share_bps: u16, pub version: u8, pub bump: u8, pub _padding: [u8; 8], pub _reserved: [u8; 32] }
fn bytes<T: Copy>(t: &T) -> Vec<u8> { unsafe { core::slice::from_raw_parts(t as *const T as *const u8, size_of::<T>()).to_vec() } }
fn hex(b: &[u8]) -> String { b.iter().map(|x| format!("{x:02x}")).collect() }
fn main() {
    assert_eq!(size_of::<AssetRiskLimitsV17>(), 64);
    assert_eq!(size_of::<AssetVaultLpV18>(), 128);
    assert_eq!(size_of::<VaultLpStateV18>(), 256);
    assert_eq!(size_of::<LpVaultRegistryV16>(), 160);
    let offs = [
        ("rl.side_oi_cap_q", offset_of!(AssetRiskLimitsV17, side_oi_cap_q)), ("rl.lp_floor_atoms", offset_of!(AssetRiskLimitsV17, lp_floor_atoms)),
        ("rl.lp_exposure_k_bps", offset_of!(AssetRiskLimitsV17, lp_exposure_k_bps)), ("rl.exec_band_bps", offset_of!(AssetRiskLimitsV17, exec_band_bps)),
        ("rl.matcher_ext_mode", offset_of!(AssetRiskLimitsV17, matcher_ext_mode)), ("rl._reserved0", offset_of!(AssetRiskLimitsV17, _reserved0)), ("rl.max_requested_fee_bps", offset_of!(AssetRiskLimitsV17, max_requested_fee_bps)), ("rl._reserved", offset_of!(AssetRiskLimitsV17, _reserved)),
        ("av.lp_net_q", offset_of!(AssetVaultLpV18, lp_net_q)), ("av.lev_cap_q", offset_of!(AssetVaultLpV18, lev_cap_q)), ("av.lp_net_slot", offset_of!(AssetVaultLpV18, lp_net_slot)),
        ("av.skew_slope_e9", offset_of!(AssetVaultLpV18, skew_slope_e9)), ("av.skew_max_e9", offset_of!(AssetVaultLpV18, skew_max_e9)), ("av.lev_max_imr_bps", offset_of!(AssetVaultLpV18, lev_max_imr_bps)),
        ("av.flags", offset_of!(AssetVaultLpV18, flags)), ("av._reserved0", offset_of!(AssetVaultLpV18, _reserved0)), ("av.vault_lp_max_lev_bps", offset_of!(AssetVaultLpV18, vault_lp_max_lev_bps)), ("av.approved_matcher_program", offset_of!(AssetVaultLpV18, approved_matcher_program)),
        ("vs.senior_claim_atoms", offset_of!(VaultLpStateV18, senior_claim_atoms)), ("vs.junior_deposited_atoms", offset_of!(VaultLpStateV18, junior_deposited_atoms)),
        ("vs.junior_withdrawn_atoms", offset_of!(VaultLpStateV18, junior_withdrawn_atoms)), ("vs.senior_fee_credited_atoms", offset_of!(VaultLpStateV18, senior_fee_credited_atoms)),
        ("vs.recalled_atoms", offset_of!(VaultLpStateV18, recalled_atoms)), ("vs.asset_index", offset_of!(VaultLpStateV18, asset_index)), ("vs.junior_floor_bps", offset_of!(VaultLpStateV18, junior_floor_bps)),
        ("vs.senior_fee_share_bps", offset_of!(VaultLpStateV18, senior_fee_share_bps)), ("vs.version", offset_of!(VaultLpStateV18, version)),
        ("reg.total_lp_shares_outstanding", offset_of!(LpVaultRegistryV16, total_lp_shares_outstanding)),
    ];
    let rl = AssetRiskLimitsV17 { side_oi_cap_q: 7_000_000_000, lp_floor_atoms: 250_000_000, lp_exposure_k_bps: 50_000, exec_band_bps: 300, matcher_ext_mode: 1, max_requested_fee_bps: 40, ..Default::default() };
    let mut key = [0u8; 32]; key[0] = 0xAB; key[31] = 0xCD;
    let av = AssetVaultLpV18 { vault_lp_portfolio: key, lp_net_q: -12_345_678_901, lev_cap_q: 40_000_000_000, lp_net_slot: 505_580_400, skew_slope_e9: 2_000, skew_max_e9: 900, lev_max_imr_bps: 5_000, flags: 1, vault_lp_max_lev_bps: 20_000, approved_matcher_program: [0x5a; 32], ..Default::default() };
    let mut owner = [0u8; 32]; owner[0] = 7;
    let vs = VaultLpStateV18 { market_group: [1; 32], registry: [2; 32], lp_portfolio: key, junior_owner: owner, senior_claim_atoms: 1_000_000_000_000, junior_deposited_atoms: 150_000_000_000,
        junior_withdrawn_atoms: 10_000_000_000, senior_fee_credited_atoms: 3_210_000_000, recalled_atoms: 5, asset_index: 0, junior_floor_bps: 1_000, senior_fee_share_bps: 10_000, version: 1, bump: 254, ..Default::default() };
    // Registry share count vs LP mint supply: they DIFFER (e.g. shares burned/escrowed in a
    // redemption ticket, dead shares, or a mint not 1:1 with the registry). The program prices
    // with the REGISTRY count; emit the real Rust results for both counts.
    let reg_shares: u128 = 1_000_000_000; let mint_supply: u128 = 1_250_000_000;
    let reg = LpVaultRegistryV16 { market_group: [1; 32], lp_mint: [4; 32], total_lp_shares_outstanding: reg_shares, epoch: 3, fee_share_bps: 10_000, version: 1, bump: 250, mint_bump: 249, ..Default::default() };
    let (amount, c_eff, senior, redeem): (u128, u128, u128, u128) = (7_000_000, 1_002_000_000, 1_002_000_000, 100_000_000);
    let dep_reg = p3::senior_shares_for_deposit(amount, reg_shares, c_eff).unwrap();
    let dep_mint = p3::senior_shares_for_deposit(amount, mint_supply, c_eff).unwrap();
    let red_reg = p3::senior_atoms_for_redemption(redeem, reg_shares, senior).unwrap();
    let red_mint = p3::senior_atoms_for_redemption(redeem, mint_supply, senior).unwrap();
    let dep_genesis_reg = p3::senior_shares_for_deposit(amount, 0, c_eff).unwrap();
    let registry_case = format!("{{\"registryHex\":\"{}\",\"registryShares\":\"{reg_shares}\",\"mintSupply\":\"{mint_supply}\",\"amount\":\"{amount}\",\"cEff\":\"{c_eff}\",\"senior\":\"{senior}\",\"redeemShares\":\"{redeem}\",\"depositSharesRegistry\":\"{dep_reg}\",\"depositSharesMint\":\"{dep_mint}\",\"redeemAtomsRegistry\":\"{red_reg}\",\"redeemAtomsMint\":\"{red_mint}\",\"depositSharesGenesis\":\"{dep_genesis_reg}\"}}", hex(&bytes(&reg)));
    let o: Vec<String> = offs.iter().map(|(n, v)| format!("\"{n}\":{v}")).collect();
    println!("{{\"offsets\":{{{}}},\"riskLimitsHex\":\"{}\",\"assetVaultLpHex\":\"{}\",\"vaultLpStateHex\":\"{}\",\"registryVsMint\":{}}}", o.join(","), hex(&bytes(&rl)), hex(&bytes(&av)), hex(&bytes(&vs)), registry_case);
}
