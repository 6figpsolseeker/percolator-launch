//! Tag-44 RebalanceReduce vectors from the DEPLOYED wrapper's own encoder
//! (`percolator_prog::ix::Instruction::encode`, 6377376a) — and a decode round-trip through
//! its decode arm — for the app's `encodeRebalanceReduceData`.
use percolator_prog::ix::Instruction;
fn hex(b: &[u8]) -> String { b.iter().map(|x| format!("{x:02x}")).collect() }
fn main() {
    let mut s: u64 = 0x2545_F491_4F6C_DD1D;
    let mut next = || { s ^= s << 13; s ^= s >> 7; s ^= s << 17; s };
    let mut out = Vec::new();
    let fixed: [(u64, u64, u16, u128); 4] = [(1, 0, 0, 1), (7, 3, 0, u128::MAX / 4), (u64::MAX, u64::MAX, u16::MAX, u128::MAX), (42, 9, 1, 16_511_677_058)];
    let mut cases: Vec<(u64, u64, u16, u128)> = fixed.to_vec();
    for _ in 0..60 { let a = next(); let b = next(); let c = (next() % 4) as u16; let d = ((next() as u128) << 64) | next() as u128; cases.push((a, b, c, d.max(1))); }
    for (pid, pep, asset, q) in cases {
        let ix = Instruction::RebalanceReduce { portfolio_id: pid, position_epoch: pep, asset_index: asset, reduce_q: q };
        let bytes = ix.encode();
        match Instruction::decode(&bytes).expect("decode") {
            Instruction::RebalanceReduce { portfolio_id, position_epoch, asset_index, reduce_q } => {
                assert_eq!((portfolio_id, position_epoch, asset_index, reduce_q), (pid, pep, asset, q));
            }
            _ => panic!("decoded to another instruction"),
        }
        out.push(format!("{{\"pid\":\"{pid}\",\"pep\":\"{pep}\",\"asset\":{asset},\"q\":\"{q}\",\"hex\":\"{}\"}}", hex(&bytes)));
    }
    println!("[{}]", out.join(","));
}
