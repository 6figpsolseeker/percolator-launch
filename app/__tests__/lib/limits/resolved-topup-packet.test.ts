// @vitest-environment node
/**
 * Review of #2721: 4 prepended empty closes + 46 top-up + 78 + 77 reached 1,242 B; the gate sim
 * (2 compute-budget ixs) passed at 1,230 B, the wallet opened and signing failed "Transaction too
 * large", with no bare fallback. sendWithTopup now drops trailing closes until the FINAL tx fits.
 */
import { describe, it, expect, vi } from "vitest";
import { Keypair, PublicKey, TransactionInstruction } from "@solana/web3.js";
import { sendWithTopup, finalTxWireSize, PACKET_DATA_SIZE } from "@/lib/limits/resolved-topup";

const prog = Keypair.generate().publicKey;
const payer = Keypair.generate().publicKey;
const market = Keypair.generate().publicKey;
/** A tag-8-shaped close: [closer s/w, market w, portfolio w, owner w] + 25 B data. */
const close = () =>
  new TransactionInstruction({ programId: prog, data: Buffer.alloc(25, 8), keys: [
    { pubkey: payer, isSigner: true, isWritable: true },
    { pubkey: market, isSigner: false, isWritable: true },
    { pubkey: Keypair.generate().publicKey, isSigner: false, isWritable: true },
    { pubkey: Keypair.generate().publicKey, isSigner: false, isWritable: true },
  ] });
/** A user ix with many accounts (77-like payout). */
const big = (nAccts: number) =>
  new TransactionInstruction({ programId: prog, data: Buffer.alloc(40, 77), keys: Array.from({ length: nAccts }, (_, i) => ({ pubkey: i === 0 ? payer : Keypair.generate().publicKey, isSigner: i === 0, isWritable: true })) });

describe("sendWithTopup packet gate", () => {
  const base = [big(12), big(6)];
  const closes = [close(), close(), close(), close()];
  it("the unbounded bundle would not fit (the reviewed failure)", () => {
    expect(finalTxWireSize([...closes, ...base], payer)).toBeGreaterThan(PACKET_DATA_SIZE);
  });
  it("drops trailing closes until the final tx fits, and still bundles", async () => {
    const send = vi.fn(async (ixs: TransactionInstruction[], bundled: boolean) => ({ ixs, bundled }));
    const r = await sendWithTopup({ topup: closes, base, send, isPreSignRefusal: () => false, packet: { feePayer: payer, droppable: closes.length } });
    expect(r.bundled).toBe(true);
    expect(r.ixs.length).toBeLessThan(closes.length + base.length);
    expect(r.ixs.length).toBeGreaterThan(base.length);
    expect(finalTxWireSize(r.ixs, payer)).toBeLessThanOrEqual(PACKET_DATA_SIZE);
  });
  it("non-droppable topup that cannot fit => the user's tx alone", async () => {
    const send = vi.fn(async (ixs: TransactionInstruction[], bundled: boolean) => ({ ixs, bundled }));
    const r = await sendWithTopup({ topup: [big(20), big(20)], base, send, isPreSignRefusal: () => false, packet: { feePayer: payer, droppable: 0 } });
    expect(r).toEqual({ ixs: base, bundled: false });
  });
  it("an empty topup never runs the size estimator; an estimator error sends the user's tx alone", async () => {
    const send = vi.fn(async (ixs: TransactionInstruction[], bundled: boolean) => ({ ixs, bundled }));
    const broken = { feePayer: {} as PublicKey, droppable: 1 }; // makes serialization throw
    expect(await sendWithTopup({ topup: [], base, send, isPreSignRefusal: () => false, packet: broken })).toEqual({ ixs: base, bundled: false });
    expect(await sendWithTopup({ topup: [close()], base, send, isPreSignRefusal: () => false, packet: broken })).toEqual({ ixs: base, bundled: false });
  });
  it("small bundles are untouched", async () => {
    const send = vi.fn(async (ixs: TransactionInstruction[], bundled: boolean) => ({ ixs, bundled }));
    const r = await sendWithTopup({ topup: [close()], base: [big(4)], send, isPreSignRefusal: () => false, packet: { feePayer: payer, droppable: 1 } });
    expect(r.ixs).toHaveLength(2);
  });
});
void PublicKey;
