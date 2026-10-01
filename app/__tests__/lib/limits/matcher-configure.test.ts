// @vitest-environment node
/**
 * Matcher tag 5 (owner-proof Configure) bytes == the REAL Rust encoder
 * (`percolator_match::vamm::encode_configure`, fixture from
 * scripts/limits-parity/bin/configure.rs), and the proof re-derives the SDK's
 * delegate PDA exactly as the matcher does (create_program_address with the bump).
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { Keypair, PublicKey } from "@solana/web3.js";
import { deriveMatcherDelegate } from "@percolatorct/sdk";
import { buildConfigureBackingFeeCapIx, encodeConfigureBackingFeeCapOwnerProof } from "@/lib/limits/matcher-configure";

const fx = JSON.parse(readFileSync(join(__dirname, "..", "..", "fixtures", "limits", "rust-matcher-configure.json"), "utf8"));
const seq = (start: number) => new PublicKey(Uint8Array.from({ length: 32 }, (_, i) => (start + i) & 0xff));

describe("matcher tag 5 Configure (owner proof, SetBackingFeeCap)", () => {
  it("bytes match percolator_match::vamm::encode_configure", () => {
    const got = encodeConfigureBackingFeeCapOwnerProof(seq(0), seq(100), seq(200), fx.bump, fx.cap);
    expect(Buffer.from(got).toString("hex")).toBe(fx.ownerProofBackingFeeCapHex);
  });
  it("refuses out-of-range caps and bumps", () => {
    expect(() => encodeConfigureBackingFeeCapOwnerProof(seq(0), seq(1), seq(2), 1, 10_001)).toThrow();
    expect(() => encodeConfigureBackingFeeCapOwnerProof(seq(0), seq(1), seq(2), 256, 1)).toThrow();
  });
  it("the proof re-derives the delegate PDA (what the matcher checks against ctx.lp_pda)", () => {
    const wrapper = Keypair.generate().publicKey;
    const matcher = Keypair.generate().publicKey;
    const market = Keypair.generate().publicKey;
    const lp = Keypair.generate().publicKey;
    const owner = Keypair.generate().publicKey;
    const ctx = Keypair.generate().publicKey;
    const ix = buildConfigureBackingFeeCapIx({ wrapperProgramId: wrapper, matcherProgramId: matcher, market, lpPortfolio: lp, lpOwner: owner, matcherCtx: ctx, capBps: 50 });
    const d = ix.data;
    const bump = d[98];
    const rederived = PublicKey.createProgramAddressSync(
      [Buffer.from("matcher"), d.subarray(34, 66), d.subarray(66, 98), owner.toBuffer(), matcher.toBuffer(), ctx.toBuffer(), Buffer.from([bump])],
      new PublicKey(d.subarray(2, 34)),
    );
    const [delegate] = deriveMatcherDelegate(wrapper, market, lp, owner, matcher, ctx);
    expect(rederived.equals(delegate)).toBe(true);
    expect(ix.programId.equals(matcher)).toBe(true);
    expect(ix.keys[0]).toEqual({ pubkey: owner, isSigner: true, isWritable: false });
    expect(ix.keys[1]).toEqual({ pubkey: ctx, isSigner: false, isWritable: true });
    expect(d[99]).toBe(0);
    expect(d[100] | (d[101] << 8)).toBe(50);
  });
});
