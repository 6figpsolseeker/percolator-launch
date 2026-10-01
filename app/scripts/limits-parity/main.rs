//! Emits parity vectors (JSON) from the REAL Rust predicates for the TS ports in
//! percolator-launch app/lib/limits. P1 + P3 modules are verbatim copies of branch source;
//! P2 is the percolator-match crate itself (path dep, feat/p2-matcher-v2 worktree).
#[path = "p1_risk_limits.rs"]
mod p1;
#[path = "p3_vault.rs"]
mod p3;
use percolator_match::v2;

struct Rng(u64);
impl Rng {
    fn next(&mut self) -> u64 { self.0 ^= self.0 << 13; self.0 ^= self.0 >> 7; self.0 ^= self.0 << 17; self.0 }
    fn below(&mut self, n: u64) -> u64 { if n == 0 { 0 } else { self.next() % n } }
    fn pick(&mut self, xs: &[u64]) -> u64 { xs[self.below(xs.len() as u64) as usize] }
    fn mag(&mut self) -> u128 {
        // mixed magnitudes: small, mid, big
        match self.below(4) { 0 => self.below(100) as u128, 1 => self.below(1_000_000) as u128,
            2 => (self.next() as u128) % 1_000_000_000_000, _ => (self.next() as u128) * (self.below(1_000_000) as u128) }
    }
    fn signed(&mut self) -> i128 { let m = self.mag() as i128; if self.below(2) == 0 { m } else { -m } }
}
fn b(x: bool) -> &'static str { if x { "true" } else { "false" } }

fn main() {
    let mut r = Rng(0x9E37_79B9_7F4A_7C15);
    let mut out: Vec<String> = Vec::new();
    // ── P1 ──
    for _ in 0..400 {
        let eq = r.mag(); let k = r.below(10_000_001) as u32; let price = { let t = r.below(u64::MAX); r.pick(&[0, 1, 1_000, 150_000_000, t]) };
        let cap = p1::lp_exposure_cap_q(eq, k, price, 1_000_000);
        out.push(format!("{{\"f\":\"lp_exposure_cap_q\",\"eq\":\"{eq}\",\"k\":{k},\"price\":\"{price}\",\"out\":\"{cap}\"}}"));
        let before = r.signed(); let sign: i8 = if r.below(2) == 0 { 1 } else { -1 }; let c = r.mag();
        let h = p1::lp_fill_headroom_q(before, sign, c);
        out.push(format!("{{\"f\":\"lp_fill_headroom_q\",\"before\":\"{before}\",\"sign\":{sign},\"cap\":\"{c}\",\"out\":\"{h}\"}}"));
        let fr = p1::floored_lp_reducing_room_q(before, sign);
        out.push(format!("{{\"f\":\"floored_lp_reducing_room_q\",\"before\":\"{before}\",\"sign\":{sign},\"out\":\"{fr}\"}}"));
        let exec = r.below(u64::MAX); let rf = { let t = r.below(1_000_000); r.pick(&[0, 1_000_000, exec, exec.saturating_add(t)]) }; let band = r.below(10_001) as u16;
        out.push(format!("{{\"f\":\"exec_price_within_band\",\"exec\":\"{exec}\",\"ref\":\"{rf}\",\"band\":{band},\"out\":{}}}", b(p1::exec_price_within_band(exec, rf, band))));
        let stored = r.pick(&[0, 1, 500, 10_000, 20_000]) as u16;
        out.push(format!("{{\"f\":\"effective_exec_band_bps\",\"stored\":{stored},\"out\":{}}}", p1::effective_exec_band_bps(stored)));
        let imr = r.pick(&[0, 1, 5, 100, 500, 1_000, 10_000]); let ks = r.pick(&[0, 1, 20_000_000, 50_000]) as u32;
        out.push(format!("{{\"f\":\"effective_lp_exposure_k_bps\",\"stored\":{ks},\"imr\":\"{imr}\",\"out\":{}}}", p1::effective_lp_exposure_k_bps(ks, imr)));
        let e = r.signed(); let fl = r.mag(); let ri = r.below(2) == 0;
        out.push(format!("{{\"f\":\"lp_floor_halts\",\"eq\":\"{e}\",\"floor\":\"{fl}\",\"ri\":{},\"out\":{}}}", b(ri), b(p1::lp_floor_halts(e, fl, ri))));
        let bf = r.mag(); let af = r.mag(); let cp = r.mag();
        out.push(format!("{{\"f\":\"side_oi_growth_allowed\",\"before\":\"{bf}\",\"after\":\"{af}\",\"cap\":\"{cp}\",\"out\":{}}}", b(p1::side_oi_growth_allowed(bf, af, cp))));
    }
    // ── P2 ──
    for _ in 0..300 {
        let cfg = v2::V2Config { flags: 0, fee_lo_bps: r.below(200) as u16, fee_hi_bps: r.below(1000) as u16, fee_cold_bps: r.below(300) as u16,
            vol_a_milli: r.below(5000) as u16, vol_b_den: r.pick(&[0, 1, 100, 10_000]) as u16, vol_alpha_bps: 1000, vol_warmup: 0,
            vol_move_cap_10bps: 100, vol_ref_slots: 25, thin_rebate_mult_bps: 0, skew_cap_bps: 0, rebate_cap_bps: 0,
            max_mark_age_slots: 0, observed_stale_slots: 0, skew_ref_inventory: 0 };
        let st = v2::V2State { vol_warmup_left: r.pick(&[0, 0, 3]) as u8, vol_var_e4: { let t = r.next(); r.pick(&[0, 1, 10_000, 1_000_000_000, t]) }, ..Default::default() };
        let fee = v2::adaptive_fee_bps(&cfg, &st);
        out.push(format!("{{\"f\":\"adaptive_fee_bps\",\"lo\":{},\"hi\":{},\"cold\":{},\"a\":{},\"bden\":{},\"warm\":{},\"var\":\"{}\",\"out\":\"{fee}\"}}",
            cfg.fee_lo_bps, cfg.fee_hi_bps, cfg.fee_cold_bps, cfg.vol_a_milli, cfg.vol_b_den, st.vol_warmup_left, st.vol_var_e4));
        let n = r.mag(); let d = r.mag(); let kk = r.pick(&[0, 1, 5000, 10_000, 100_000]) as u32;
        let imp = v2::cp_impact_bps(n, d, kk);
        out.push(format!("{{\"f\":\"cp_impact_bps\",\"n\":\"{n}\",\"d\":\"{d}\",\"k\":{kk},\"out\":{}}}", imp.map(|x| format!("\"{x}\"")).unwrap_or("null".into())));
        let inv = (r.signed() % 1_000_000_000_000) as i128; let fill = (r.mag() % 1_000_000_000_000) as u128; let sells = r.below(2) == 0;
        let sm = r.below(2000) as u16; let rm = r.below((sm as u64) + 1) as u16; let sc = r.below(5001) as u16; let rc = r.below((sc as u64) + 1) as u16; let rf = r.pick(&[0, 1, 1_000_000, 100_000_000_000]);
        let sk = v2::skew_net_bps(inv, fill, sells, sm, rm, sc, rc, rf);
        out.push(format!("{{\"f\":\"skew_net_bps\",\"inv\":\"{inv}\",\"fill\":\"{fill}\",\"sells\":{},\"sm\":{sm},\"rm\":{rm},\"sc\":{sc},\"rc\":{rc},\"ref\":\"{rf}\",\"out\":{}}}", b(sells), sk.map(|x| format!("\"{x}\"")).unwrap_or("null".into())));
        let q = v2::AdaptiveQuoteIn { oracle_e6: r.pick(&[1, 1_000, 150_000_000, 3_000_000_000]), fill: (r.mag() % 10_000_000_000) as u128,
            taker_buys: r.below(2) == 0, inv_pre: (r.signed() % 10_000_000_000) as i128, base_spread_bps: r.below(50) as u32,
            max_total_bps: r.pick(&[0, 50, 100, 200, 500, 10_000]) as u32, fee_bps: r.below(100) as u128, impact_k_bps: r.pick(&[0, 5000, 10_000]) as u32,
            depth_e6: r.pick(&[1, 1_000_000, 10_000_000_000, 1_000_000_000_000]) as u128, s_mult_bps: sm, r_mult_bps: rm, skew_cap_bps: sc, rebate_cap_bps: rc,
            ref_inv: r.pick(&[0, 1_000_000, 1_000_000_000]) };
        let res = v2::quote_adaptive(&q);
        out.push(format!("{{\"f\":\"quote_adaptive\",\"oracle\":\"{}\",\"fill\":\"{}\",\"buys\":{},\"inv\":\"{}\",\"base\":{},\"maxt\":{},\"fee\":\"{}\",\"k\":{},\"depth\":\"{}\",\"sm\":{},\"rm\":{},\"sc\":{},\"rc\":{},\"ref\":\"{}\",\"out\":{}}}",
            q.oracle_e6, q.fill, b(q.taker_buys), q.inv_pre, q.base_spread_bps, q.max_total_bps, q.fee_bps, q.impact_k_bps, q.depth_e6, q.s_mult_bps, q.r_mult_bps, q.skew_cap_bps, q.rebate_cap_bps, q.ref_inv,
            res.map(|(f, p, t)| format!("[\"{f}\",\"{p}\",\"{t}\"]")).unwrap_or("null".into())));
    }
    // ── P3 ──
    for _ in 0..300 {
        let v = r.mag(); let c = r.mag(); let s = p3::tranche_split(v, c);
        out.push(format!("{{\"f\":\"tranche_split\",\"v\":\"{v}\",\"c\":\"{c}\",\"out\":[\"{}\",\"{}\"]}}", s.senior, s.junior));
        let amt = r.mag(); let sh = { let t = r.below(u64::MAX); r.pick(&[0, 1, 1_000, t]) } as u128; let sv = r.mag();
        let o = p3::senior_shares_for_deposit(amt, sh, sv);
        out.push(format!("{{\"f\":\"senior_shares_for_deposit\",\"amt\":\"{amt}\",\"s\":\"{sh}\",\"sv\":\"{sv}\",\"out\":{}}}", o.map(|x| format!("\"{x}\"")).unwrap_or("null".into())));
        let red = r.below(sh as u64 + 2) as u128;
        let o = p3::senior_atoms_for_redemption(red, sh, sv);
        out.push(format!("{{\"f\":\"senior_atoms_for_redemption\",\"sh\":\"{red}\",\"s\":\"{sh}\",\"sv\":\"{sv}\",\"out\":{}}}", o.map(|x| format!("\"{x}\"")).unwrap_or("null".into())));
        let bc = r.mag(); let fb = r.pick(&[0, 1_000, 2_500, 10_000, 10_001]) as u16;
        out.push(format!("{{\"f\":\"junior_withdraw_allowed\",\"v\":\"{v}\",\"c\":\"{c}\",\"bc\":\"{bc}\",\"amt\":\"{amt}\",\"fb\":{fb},\"out\":{}}}", b(p3::junior_withdraw_allowed(v, c, bc, amt, fb))));
        let lp = r.signed() % 100_000_000_000_000; let oi = (r.mag() % 100_000_000_000_000) as u128; let sl = { let t = r.next(); r.pick(&[0, 1, 1_000, t]) }; let mx = { let t = r.next(); r.pick(&[0, 1, 500, t]) };
        out.push(format!("{{\"f\":\"skew_funding_rate_e9\",\"lp\":\"{lp}\",\"oi\":\"{oi}\",\"sl\":\"{sl}\",\"mx\":\"{mx}\",\"out\":\"{}\"}}", p3::skew_funding_rate_e9(lp, oi, sl, mx)));
        let la = r.mag(); let cq = { let t = r.below(u64::MAX); r.pick(&[0, 1, 1_000_000, t]) } as u128; let base = r.pick(&[0, 100, 500, 1000]); let mi = r.pick(&[0, 200, 1000, 5000, 10_000]) as u16;
        out.push(format!("{{\"f\":\"step_imr_bps\",\"la\":\"{la}\",\"cap\":\"{cq}\",\"base\":\"{base}\",\"mi\":{mi},\"out\":\"{}\"}}", p3::step_imr_bps(la, cq, base, mi)));
        let e = r.mag(); let nt = r.mag(); let im = r.pick(&[0, 100, 5000, 10_000, 10_001]);
        out.push(format!("{{\"f\":\"leverage_gate_ok\",\"e\":\"{e}\",\"n\":\"{nt}\",\"imr\":\"{im}\",\"out\":{}}}", b(p3::leverage_gate_ok(e, nt, im))));
    }
    // ── P1 (e74809b1 additions) ──
    for _ in 0..400 {
        let b0 = r.signed() % 1_000_000_000; let a0 = if r.below(4) == 0 { 0 } else { r.signed() % 1_000_000_000 };
        out.push(format!("{{\"f\":\"position_change_reduce_only\",\"b\":\"{b0}\",\"a\":\"{a0}\",\"out\":{}}}", b(p1::position_change_reduce_only(b0, a0))));
        out.push(format!("{{\"f\":\"floored_lp_move_allowed\",\"b\":\"{b0}\",\"a\":\"{a0}\",\"out\":{}}}", b(p1::floored_lp_move_allowed(b0, a0))));
        let cb = r.signed() % 1_000_000; let ca = if r.below(3) == 0 { 0 } else { r.signed() % 1_000_000 };
        let lb = r.signed() % 1_000_000; let la = r.signed() % 1_000_000; let cap = (r.mag() % 1_000_000) as u128; let fl = r.below(2) == 0;
        let g = match p1::lp_fill_gate(cb, ca, lb, la, cap, fl) { p1::LpGate::Allow => "allow", p1::LpGate::FloorHalt => "floor-halt", p1::LpGate::CapExceeded => "cap-exceeded" };
        out.push(format!("{{\"f\":\"lp_fill_gate\",\"cb\":\"{cb}\",\"ca\":\"{ca}\",\"lb\":\"{lb}\",\"la\":\"{la}\",\"cap\":\"{cap}\",\"fl\":{},\"out\":\"{g}\"}}", b(fl)));
        let req = r.pick(&[0, 1, 5, 50, 500, 1023, 2000]); let base = r.pick(&[0, 5, 10, 30]); let signed_ = { let t = r.below(3000); r.pick(&[0, 10, 60, 1100, t]) }; let pm = r.pick(&[0, 1, 50, 500, 1023]) as u16; let mm = r.pick(&[0, 50, 100, 1000, 10_000]);
        out.push(format!("{{\"f\":\"requested_fee_permitted\",\"req\":\"{req}\",\"base\":\"{base}\",\"signed\":\"{signed_}\",\"pm\":{pm},\"mm\":\"{mm}\",\"out\":{}}}", b(p1::requested_fee_permitted(req, base, signed_, pm, mm))));
    }
    // ── P2 requested_fee_bps ──
    for _ in 0..200 {
        let o = r.pick(&[0, 1, 1_000, 1_000_000, 150_000_000]); let ex = { let t = r.below(300_000_000); r.pick(&[0, o, o.saturating_add(1), o / 2, t]) };
        out.push(format!("{{\"f\":\"requested_fee_bps\",\"o\":\"{o}\",\"ex\":\"{ex}\",\"out\":{}}}", v2::requested_fee_bps(o, ex)));
    }
    // ── P3 (0be66041 additions) ──
    for _ in 0..300 {
        let cap = r.mag(); let pnl = r.signed(); let fee = r.signed();
        let ce = p3::conservative_equity(cap, pnl, fee);
        out.push(format!("{{\"f\":\"conservative_equity\",\"c\":\"{cap}\",\"p\":\"{pnl}\",\"fc\":\"{fee}\",\"out\":{}}}", ce.map(|x| format!("\"{x}\"")).unwrap_or("null".into())));
        let lb = r.signed() % 100_000_000_000; let la = r.signed() % 100_000_000_000; let eq = r.mag(); let lev = r.pick(&[0, 1, 10_000, 50_000]) as u32; let pr = r.pick(&[0, 1, 1_000_000, 150_000_000]);
        out.push(format!("{{\"f\":\"vault_lp_exposure_allowed\",\"lb\":\"{lb}\",\"la\":\"{la}\",\"eq\":\"{eq}\",\"lev\":{lev},\"pr\":\"{pr}\",\"out\":{}}}", b(p3::vault_lp_exposure_allowed(lb, la, eq, lev, pr, 1_000_000))));
    }
    // ── P1 71da9917: band edge rounds out one atom; division-free cap check ──
    for _ in 0..300 {
        let rf = r.pick(&[1, 3, 7, 999_999, 1_000_000, 150_000_001, 3_000_000_003]); let band = r.pick(&[0, 1, 3, 500, 777, 10_000]) as u16;
        let d = ((rf as u128) * (band as u128) + 9_999) / 10_000; // ceil
        for ex in [rf.saturating_add(d as u64), rf.saturating_add(d as u64 + 1), rf.saturating_sub(d as u64), rf.saturating_sub(d as u64 + 1)] {
            out.push(format!("{{\"f\":\"exec_price_within_band\",\"exec\":\"{ex}\",\"ref\":\"{rf}\",\"band\":{band},\"out\":{}}}", b(p1::exec_price_within_band(ex, rf, band))));
        }
        let a = r.mag(); let eq = r.mag(); let k = r.below(10_000_001) as u32; let t = r.next(); let pr = r.pick(&[0, 1, 1_000_000, 150_000_000, t]);
        let fast = p1::exposure_within_cap_fast(a, eq, k, pr, 1_000_000);
        out.push(format!("{{\"f\":\"exposure_within_cap_fast\",\"a\":\"{a}\",\"eq\":\"{eq}\",\"k\":{k},\"pr\":\"{pr}\",\"out\":{}}}", fast.map(|x| b(x).to_string()).unwrap_or("null".into())));
    }
    // exact boundary (lhs == rhs) and one atom either side, so `<=` vs `<` is observable
    for (eq, k, pr) in [(1_000_000u128, 10_000u32, 1_000_000u64), (3_000_000, 50_000, 7_500_000), (123_000_000, 20_000, 150_000_000), (7, 10_000, 7)] {
        let rhs = eq * (k as u128) * 1_000_000;
        let den = 10_000u128 * (pr as u128);
        let a = rhs / den;
        for aa in [a.saturating_sub(1), a, a + 1] {
            let fast = p1::exposure_within_cap_fast(aa, eq, k, pr, 1_000_000);
            out.push(format!("{{\"f\":\"exposure_within_cap_fast\",\"a\":\"{aa}\",\"eq\":\"{eq}\",\"k\":{k},\"pr\":\"{pr}\",\"out\":{}}}", fast.map(|x| b(x).to_string()).unwrap_or("null".into())));
        }
    }
    println!("[\n{}\n]", out.join(",\n"));
}
