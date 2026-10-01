//! offset_of! for the fields the Earn NAV (P3) reads, on the DEPLOYED v18.2 tree (6377376a + engine 35ddd692).
use core::mem::{offset_of, size_of};
use percolator::{AssetStateV16Account, HealthCertV16Account, MarketGroupV16HeaderAccount, PortfolioAccountV16Account};
use percolator_prog::state::WrapperConfigV16;
fn main() {
    println!("{{");
    println!("\"wcfg.lp_fee_accrued_atoms\":{},", offset_of!(WrapperConfigV16, lp_fee_accrued_atoms));
    println!("\"wcfg.lp_fee_withdrawn_atoms\":{},", offset_of!(WrapperConfigV16, lp_fee_withdrawn_atoms));
    println!("\"hdr.vault\":{},", offset_of!(MarketGroupV16HeaderAccount, vault));
    println!("\"hdr.insurance\":{},", offset_of!(MarketGroupV16HeaderAccount, insurance));
    println!("\"hdr.source_insurance_credit_reserved_total_atoms\":{},", offset_of!(MarketGroupV16HeaderAccount, source_insurance_credit_reserved_total_atoms));
    println!("\"hdr.insurance_domain_budget_remaining_total\":{},", offset_of!(MarketGroupV16HeaderAccount, insurance_domain_budget_remaining_total));
    println!("\"hdr.risk_epoch\":{},", offset_of!(MarketGroupV16HeaderAccount, risk_epoch));
    println!("\"hdr.asset_set_epoch\":{},", offset_of!(MarketGroupV16HeaderAccount, asset_set_epoch));
    println!("\"hdr.oracle_epoch\":{},", offset_of!(MarketGroupV16HeaderAccount, oracle_epoch));
    println!("\"hdr.funding_epoch\":{},", offset_of!(MarketGroupV16HeaderAccount, funding_epoch));
    println!("\"pf.active_bitmap\":{},", offset_of!(PortfolioAccountV16Account, active_bitmap));
    println!("\"pf.health_cert\":{},", offset_of!(PortfolioAccountV16Account, health_cert));
    println!("\"pf.stale_state\":{},", offset_of!(PortfolioAccountV16Account, stale_state));
    println!("\"pf.b_stale_state\":{},", offset_of!(PortfolioAccountV16Account, b_stale_state));
    println!("\"cert.certified_equity\":{},", offset_of!(HealthCertV16Account, certified_equity));
    println!("\"cert.cert_oracle_epoch\":{},", offset_of!(HealthCertV16Account, cert_oracle_epoch));
    println!("\"cert.cert_funding_epoch\":{},", offset_of!(HealthCertV16Account, cert_funding_epoch));
    println!("\"cert.cert_risk_epoch\":{},", offset_of!(HealthCertV16Account, cert_risk_epoch));
    println!("\"cert.cert_asset_set_epoch\":{},", offset_of!(HealthCertV16Account, cert_asset_set_epoch));
    println!("\"cert.active_bitmap_at_cert\":{},", offset_of!(HealthCertV16Account, active_bitmap_at_cert));
    println!("\"cert.valid\":{},", offset_of!(HealthCertV16Account, valid));
    println!("\"cert.size\":{},", size_of::<HealthCertV16Account>());
    println!("\"asset.a_long\":{},", offset_of!(AssetStateV16Account, a_long));
    println!("\"asset.a_short\":{},", offset_of!(AssetStateV16Account, a_short));
    println!("\"adl_one\":\"{}\",", percolator::ADL_ONE);
    println!("\"bitmap.size\":{}", offset_of!(HealthCertV16Account, valid) - offset_of!(HealthCertV16Account, active_bitmap_at_cert));
    println!("}}");
}
