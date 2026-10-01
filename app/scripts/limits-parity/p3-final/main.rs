//! Round-4 oracle: the app's P3 end-to-end surface against the REAL P3 crate
//! (percolator-prog feat/p3-vault-owned-lp@5544302a RELAUNCH (all-fresh IDs, error 90 since 592286b4; layout = 4b1a5d30) + engine 35ddd692), path deps only —
//! nothing is copied. Build it OUTSIDE both repos (see Cargo.toml.example) and run:
//!   cargo run --quiet -- vectors.txt > app/__tests__/fixtures/limits/rust-p3-final.json
//! Emits: every app encoder's hex decoded by `ix::Instruction::decode` (with __short/__long
//! refusals), error ordinals BY NAME, rustc offset_of! for every field the app reads for the
//! Earn tails / resolved exit, the per-asset AssetVaultLpV18 offset located by the program's
//! own `read_asset_vault_lp`, and `registry_vault_lp_bound` on a planted registry.
use core::mem::{offset_of, size_of};
use percolator::{MarketGroupV16HeaderAccount, PortfolioAccountV16Account, ResolvedPayoutReceiptV16Account};
use percolator_prog::constants as c;
use percolator_prog::error::PercolatorError as E;
use percolator_prog::ix::Instruction as I;
use percolator_prog::state::{self, AssetVaultLpV18, LpVaultRegistryV16, VaultLpStateV18, WrapperConfigV16};

fn hex(b: &[u8]) -> String {
    b.iter().map(|x| format!("{x:02x}")).collect()
}
fn unhex(s: &str) -> Vec<u8> {
    (0..s.len()).step_by(2).map(|i| u8::from_str_radix(&s[i..i + 2], 16).unwrap()).collect()
}
fn decoded(ix: &I) -> Option<String> {
    Some(match ix {
        I::InitVaultLp { junior_floor_bps } => format!("{{\"tag\":94,\"juniorFloorBps\":\"{junior_floor_bps}\"}}"),
        I::DepositJuniorTranche { amount } => format!("{{\"tag\":96,\"amount\":\"{amount}\"}}"),
        I::WithdrawJuniorTranche { amount } => format!("{{\"tag\":97,\"amount\":\"{amount}\"}}"),
        I::VaultLpRecall { amount, target_domain } => format!("{{\"tag\":98,\"amount\":\"{amount}\",\"targetDomain\":\"{target_domain}\"}}"),
        I::VaultLpSettleResolved { topup } => format!("{{\"tag\":101,\"topup\":\"{topup}\"}}"),
        I::VaultLpReleaseSurplus { amount, source_domain } => format!("{{\"tag\":102,\"amount\":\"{amount}\",\"sourceDomain\":\"{source_domain}\"}}"),
        I::ClosePortfolio { portfolio_id, expected_sequence, position_epoch } => format!(
            "{{\"tag\":8,\"portfolioId\":\"{portfolio_id}\",\"expectedSequence\":\"{expected_sequence}\",\"positionEpoch\":\"{position_epoch}\"}}"),
        I::CloseResolved { fee_rate_per_slot } => format!("{{\"tag\":30,\"feeRatePerSlot\":\"{fee_rate_per_slot}\"}}"),
        I::ClaimResolvedPayoutTopup => "{\"tag\":46}".to_string(),
        I::LpVaultCrankFees { domain } => format!("{{\"tag\":78,\"domain\":\"{domain}\"}}"),
        _ => return None,
    })
}

include!("all_errors.rs");

fn main() {
    let path = std::env::args().nth(1).expect("vectors.txt");
    let mut out: Vec<String> = Vec::new();

    let mut vecs = Vec::new();
    let mut app_offs: Vec<usize> = Vec::new();
    for line in std::fs::read_to_string(path).unwrap().lines().filter(|l| !l.trim().is_empty()) {
        let mut it = line.split_whitespace();
        let (id, h) = (it.next().unwrap(), it.next().unwrap());
        if id.starts_with("@asset_vault_lp_off_") {
            app_offs.push(h.parse().unwrap());
            continue;
        }
        let r = match I::decode(&unhex(h)) {
            Ok(ix) => decoded(&ix).map(|d| format!("{{\"ok\":true,\"decoded\":{d}}}")).unwrap_or("{\"ok\":true,\"decoded\":null}".into()),
            Err(e) => format!("{{\"ok\":false,\"err\":\"{e:?}\"}}"),
        };
        vecs.push(format!("\"{id}\":{{\"hex\":\"{h}\",\"rust\":{r}}}"));
    }
    out.push(format!("\"vectors\":{{{}}}", vecs.join(",")));

    let errs: Vec<(&str, u32)> = vec![
        ("Unauthorized", E::Unauthorized as u32), ("ExpectedSigner", E::ExpectedSigner as u32),
        ("EngineStale", E::EngineStale as u32), ("EngineLockActive", E::EngineLockActive as u32),
        ("LpVaultCooldownActive", E::LpVaultCooldownActive as u32), ("NftRegistryNotFound", E::NftRegistryNotFound as u32),
        ("LpExposureCapExceeded", E::LpExposureCapExceeded as u32), ("LpFloorHalt", E::LpFloorHalt as u32),
        ("VaultLpAlreadyBound", E::VaultLpAlreadyBound as u32), ("VaultLpNotBound", E::VaultLpNotBound as u32),
        ("VaultLpSeniorImpaired", E::VaultLpSeniorImpaired as u32), ("VaultLpJuniorWithdrawRefused", E::VaultLpJuniorWithdrawRefused as u32),
        ("VaultLpRecallRefused", E::VaultLpRecallRefused as u32), ("VaultLpExclusiveCounterparty", E::VaultLpExclusiveCounterparty as u32),
        ("VaultLpLeverageStepDown", E::VaultLpLeverageStepDown as u32), ("VaultLpBoundCannotClose", E::VaultLpBoundCannotClose as u32),
        ("VaultLpExposureCapExceeded", E::VaultLpExposureCapExceeded as u32), ("VaultLpMatcherNotApproved", E::VaultLpMatcherNotApproved as u32),
        ("VaultLpUseSettleResolved", E::VaultLpUseSettleResolved as u32), ("VaultLpReleaseRefused", E::VaultLpReleaseRefused as u32),
        ("VaultLpHarvestPending", E::VaultLpHarvestPending as u32), ("VaultLpValuationStale", E::VaultLpValuationStale as u32),
        ("VaultLpMultiAssetMarket", E::VaultLpMultiAssetMarket as u32),
        ("VaultLpSeniorDrawRequired", E::VaultLpSeniorDrawRequired as u32),
        ("VaultLpRedeemNeedsRecall", E::VaultLpRedeemNeedsRecall as u32),
        ("VaultLpPausedForSeniorDraw", E::VaultLpPausedForSeniorDraw as u32),
        ("VaultLpBindRequiresFlatAsset", E::VaultLpBindRequiresFlatAsset as u32),
    ];
    out.push(format!("\"errors\":{{{}}}", errs.iter().map(|(n, v)| format!("\"{n}\":{v}")).collect::<Vec<_>>().join(",")));
    // EVERY PercolatorError variant, by name (all_errors.rs, generated from the enum source by
    // gen-all-errors.py; ordinals by rustc). The app's WRAPPER_ERR is pinned to this map.
    out.push(format!("\"allErrors\":{{{}}}", all_errors().iter().map(|(n, v)| format!("\"{n}\":{v}")).collect::<Vec<_>>().join(",")));

    let h = c::HEADER_LEN;
    let o = |n: &str, v: usize| format!("\"{n}\":{v}");
    let layout = vec![
        // absolute account offsets
        o("marketGroupOff", c::MARKET_GROUP_OFF),
        // F14-Q2: a P3 market is single-asset; the wizard sizes the slab for ONE slot.
        o("marketAccountLen1", state::market_account_len_for_capacity(1).unwrap()),
        o("marketAccountLen14", state::market_account_len_for_capacity(14).unwrap()),
        o("portfolioAccountLen", state::portfolio_account_len_for_market_slots(1).unwrap()),
        o("wcfg.marketauth", h + offset_of!(WrapperConfigV16, marketauth)),
        o("wcfg.force_close_delay_slots", h + offset_of!(WrapperConfigV16, force_close_delay_slots)),
        // engine header, RELATIVE to MARKET_GROUP_OFF (the app's H_* convention)
        o("hdr.c_tot", offset_of!(MarketGroupV16HeaderAccount, c_tot)),
        o("hdr.materialized_portfolio_count", offset_of!(MarketGroupV16HeaderAccount, materialized_portfolio_count)),
        o("hdr.mode", offset_of!(MarketGroupV16HeaderAccount, mode)),
        o("hdr.resolved_slot", offset_of!(MarketGroupV16HeaderAccount, resolved_slot)),
        // F-14 terminal residual + physical idle backing (engine 35ddd692)
        o("hdr.backing_provider_earnings_total", offset_of!(MarketGroupV16HeaderAccount, backing_provider_earnings_total)),
        o("hdr.source_fresh_backing_total_num", offset_of!(MarketGroupV16HeaderAccount, source_fresh_backing_total_num)),
        o("slot.backing_long", offset_of!(percolator::EngineAssetSlotV16Account, backing_long)),
        o("slot.backing_short", offset_of!(percolator::EngineAssetSlotV16Account, backing_short)),
        o("bucket.fresh_unliened_backing_num", offset_of!(percolator::BackingBucketV16Account, fresh_unliened_backing_num)),
        o("boundScaleLog10", (percolator::BOUND_SCALE as f64).log10() as usize),
        // portfolio, RELATIVE to HEADER_LEN (the app's PF_* = HEADER_LEN + field)
        // UX WP-6: InitPortfolio assigns portfolio_id = allocate_portfolio_id(asset 0's
        // AssetOracleProfileV16.next_portfolio_id) (handle_init_portfolio reads profile0, NOT
        // WrapperConfigV16); the profile sits at the start of the asset wrapper.
        o("op.next_portfolio_id", offset_of!(state::AssetOracleProfileV16, next_portfolio_id)),
        o("op.len", c::ASSET_ORACLE_PROFILE_LEN),
        o("pf.owner", offset_of!(PortfolioAccountV16Account, owner)),
        o("pf.capital", offset_of!(PortfolioAccountV16Account, capital)),
        o("pf.pnl", offset_of!(PortfolioAccountV16Account, pnl)),
        o("pf.reserved_pnl", offset_of!(PortfolioAccountV16Account, reserved_pnl)),
        o("pf.fee_credits", offset_of!(PortfolioAccountV16Account, fee_credits)),
        o("pf.cancel_deposit_escrow", offset_of!(PortfolioAccountV16Account, cancel_deposit_escrow)),
        o("pf.active_bitmap", offset_of!(PortfolioAccountV16Account, active_bitmap)),
        o("pf.rebalance_lock", offset_of!(PortfolioAccountV16Account, rebalance_lock)),
        o("pf.liquidation_lock", offset_of!(PortfolioAccountV16Account, liquidation_lock)),
        o("pf.resolved_payout_receipt", offset_of!(PortfolioAccountV16Account, resolved_payout_receipt)),
        o("receipt.present", offset_of!(ResolvedPayoutReceiptV16Account, present)),
        o("receipt.finalized", offset_of!(ResolvedPayoutReceiptV16Account, finalized)),
        o("pf.size", size_of::<PortfolioAccountV16Account>()),
        // P3 records
        o("reg.total_lp_shares_outstanding", h + offset_of!(LpVaultRegistryV16, total_lp_shares_outstanding)),
        o("reg.domain", h + offset_of!(LpVaultRegistryV16, domain)),
        o("reg.bound_flag", h + offset_of!(LpVaultRegistryV16, _reserved)),
        o("vs.junior_owner", h + offset_of!(VaultLpStateV18, junior_owner)),
        o("vs.lp_portfolio", h + offset_of!(VaultLpStateV18, lp_portfolio)),
        o("vs.senior_claim_atoms", h + offset_of!(VaultLpStateV18, senior_claim_atoms)),
        o("vs.junior_deposited_atoms", h + offset_of!(VaultLpStateV18, junior_deposited_atoms)),
        o("vs.junior_floor_bps", h + offset_of!(VaultLpStateV18, junior_floor_bps)),
        // d119eebd senior draw
        o("vs.senior_drawn_atoms", h + offset_of!(VaultLpStateV18, senior_drawn_atoms)),
        o("vs.senior_draw_outstanding_atoms", h + offset_of!(VaultLpStateV18, senior_draw_outstanding_atoms)),
        o("vs.senior_fee_share_bps", h + offset_of!(VaultLpStateV18, senior_fee_share_bps)),
        o("vs.account_len", state::vault_lp_state_account_len()),
        o("av.approved_matcher_program", offset_of!(AssetVaultLpV18, approved_matcher_program)),
        o("av.flags", offset_of!(AssetVaultLpV18, flags)),
        o("assetVaultLpOff", c::ASSET_VAULT_LP_OFF),
        o("minJuniorFloorBps", c::VAULT_LP_MIN_JUNIOR_FLOOR_BPS as usize),
        o("maxJuniorFloorBps", c::VAULT_LP_MAX_JUNIOR_FLOOR_BPS as usize),
        // 07a1d0eb auto-pin: the protocol's vAMM pin tag 94 applies (the app shows these read-only)
        o("pin.kind", percolator_prog::vault_lp_v18::PIN_MATCHER_KIND as usize),
        o("pin.tradingFeeBps", percolator_prog::vault_lp_v18::PIN_TRADING_FEE_BPS as usize),
        o("pin.baseSpreadBps", percolator_prog::vault_lp_v18::PIN_BASE_SPREAD_BPS as usize),
        o("pin.maxTotalBps", percolator_prog::vault_lp_v18::PIN_MAX_TOTAL_BPS as usize),
        o("pin.impactKBps", percolator_prog::vault_lp_v18::PIN_IMPACT_K_BPS as usize),
        o("pin.maxFillUsd", percolator_prog::vault_lp_v18::PIN_MAX_FILL_USD as usize),
        o("pin.maxInventoryUsd", percolator_prog::vault_lp_v18::PIN_MAX_INVENTORY_USD as usize),
        o("pin.liquidityUsd", percolator_prog::vault_lp_v18::PIN_LIQUIDITY_USD as usize),
        // ALL-FRESH relaunch (592286b4): the wrapper pins the relaunch matcher EDKKgRaV….
        o("canonicalMatcherIsDevnetEDKK", (c::CANONICAL_VAULT_LP_MATCHER_PROGRAM.to_string() == "EDKKgRaVHna6FCxiY1kgMzegD9rpaN1nwJNSzAzeBUBX") as usize),
    ];
    out.push(format!("\"layout\":{{{}}}", layout.join(",")));

    // Earn worse-of pricing (ede691b6; vault_lp_v18.rs unchanged since 4b1a5d30): the two pure
    // rules 77 / 75 price through. The app's lib/limits/earn-pricing.ts is pinned to these.
    {
        use percolator_prog::vault_lp_v18 as v;
        let mut pc = Vec::new();
        for &(cc, def, sur) in &[(1_000u128, 0u128, 0u128), (1_000, 50, 0), (1_000, 50, 80), (1_000, 150, 80), (1_000, 2_000, 5), (0, 10, 0), (7_000_000, 166_070, 0), (7_000_000, 166_070, 100_000), (u64::MAX as u128, 1, 0)] {
            pc.push(format!("[\"{cc}\",\"{def}\",\"{sur}\",\"{}\"]", v::vault_lp_senior_pricing_claim(cc, def, sur)));
        }
        out.push(format!("\"pricingClaimVectors\":[{}]", pc.join(",")));
        let mut rc = Vec::new();
        for &(cc, drawn, outst, above) in &[(1_000u128, 100u128, 100u128, 0u128), (1_000, 100, 100, 40), (1_000, 100, 100, 400), (1_000, 300, 100, 99), (0, 50, 50, 50), (9_000_000, 635_213, 635_213, 1_000_000)] {
            let (l, to) = v::vault_lp_recover(v::DrawLedger { senior_claim: cc, drawn, outstanding: outst, pending: 0 }, above);
            rc.push(format!("[\"{cc}\",\"{drawn}\",\"{outst}\",\"{above}\",\"{to}\",\"{}\"]", l.senior_claim));
        }
        out.push(format!("\"recoverVectors\":[{}]", rc.join(",")));
    }

    // The app's per-asset offsets (lines `@asset_vault_lp_off_i N` from gen-vectors.ts): plant a
    // record there in a zeroed, correctly-sized market buffer and read it back with the
    // program's own `read_asset_vault_lp`; also plant 1 byte off to prove the check can fail.
    let cap = 4usize;
    let len = state::market_account_len_for_capacity(cap).unwrap();
    let mut rows = Vec::new();
    for (i, app_off) in app_offs.iter().enumerate() {
        let mut rec = AssetVaultLpV18::default();
        rec.vault_lp_portfolio = [0xA0 + i as u8; 32];
        rec.flags = state::ASSET_VAULT_LP_FLAG_BOUND;
        rec.lp_net_q = -1_234_567_890_123 - i as i128;
        rec.vault_lp_max_lev_bps = 20_000;
        rec.approved_matcher_program = [0x5a; 32];
        let bytes = bytemuck::bytes_of(&rec);
        let plant = |off: usize| -> bool {
            let mut data = vec![0u8; len];
            data[0..8].copy_from_slice(&c::MAGIC.to_le_bytes());
            data[8..10].copy_from_slice(&c::VERSION.to_le_bytes());
            data[10] = c::KIND_MARKET;
            data[off..off + bytes.len()].copy_from_slice(bytes);
            state::read_asset_vault_lp(&data, i).map(|b| b == rec).unwrap_or(false)
        };
        rows.push(format!("{{\"asset\":{i},\"appOffset\":{app_off},\"programReadsSame\":{},\"offByOneReadsSame\":{}}}", plant(*app_off), plant(*app_off + 1)));
    }
    out.push(format!("\"assetVaultLpReads\":[{}]", rows.join(",")));

    // registry_vault_lp_bound on planted registries: _reserved[0] = 0 / 1 / 2.
    let mut bound = Vec::new();
    for v in [0u8, 1, 2] {
        let mut reg = LpVaultRegistryV16::default();
        reg._reserved[0] = v;
        let r = state::registry_vault_lp_bound(&reg);
        bound.push(format!("{{\"flag\":{v},\"bound\":{}}}", match r { Ok(true) => "true", Ok(false) => "false", Err(_) => "\"err\"" }));
    }
    out.push(format!("\"registryBound\":[{}]", bound.join(",")));

    println!("{{\"p3Sha\":\"5544302ad689dd94cff300f50a2964c4a1c07ede\",\"p1Sha\":\"3acb34ae83b4038a88a02731d1aa023142ef6c11\",\"engineSha\":\"35ddd692\",{}}}", out.join(","));
}
