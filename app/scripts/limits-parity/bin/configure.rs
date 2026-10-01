//! Emits matcher tag-5 Configure bytes from the REAL `percolator_match::vamm::encode_configure`.
use percolator_match::vamm::{encode_configure, OwnerProof};
fn hex(b: &[u8]) -> String { b.iter().map(|x| format!("{x:02x}")).collect() }
fn main() {
    let mut w = [0u8; 32]; for (i, x) in w.iter_mut().enumerate() { *x = i as u8; }
    let mut m = [0u8; 32]; for (i, x) in m.iter_mut().enumerate() { *x = 100 + i as u8; }
    let mut p = [0u8; 32]; for (i, x) in p.iter_mut().enumerate() { *x = 200u8.wrapping_add(i as u8); }
    let proof = OwnerProof { wrapper_program_id: w, market: m, lp_portfolio: p, bump: 253 };
    let cap: u16 = 1234;
    let mut op = vec![0u8]; op.extend_from_slice(&cap.to_le_bytes());
    println!("{{\"ownerProofBackingFeeCapHex\":\"{}\",\"bump\":253,\"cap\":1234}}", hex(&encode_configure(Some(&proof), &op)));
}
