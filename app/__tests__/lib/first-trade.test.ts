// @vitest-environment node
/**
 * UX WP-6 (audit §3.2): the first trade in one approval. The BPF half is
 * `limits_app_first_trade_one_signature_and_race` (scripts/limits-parity/p3-sim): A then B at the
 * predicted id lands; a racing init makes B fail 16 and the rebuilt B lands.
 *  AC4: the next_portfolio_id offset comes from rustc's offset_of! (fixture), not the SDK.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { Keypair } from "@solana/web3.js";
import {
  FirstTradeDepositError,
  NEXT_PORTFOLIO_ID_OFF,
  OP_NEXT_PORTFOLIO_ID,
  buildFirstTradeInitIxs,
  buildFundAndTradeIxs,
  failedFirstTradeLeg,
  firstTradeDepositAtoms,
  isPortfolioIdRace,
  predictPortfolioId,
  readNextPortfolioId,
} from "@/lib/first-trade";
import { assetWrapperOff } from "@/lib/limits/constants";
import { WRAPPER_ERR } from "@/lib/wrapper-errors";

const RUST = JSON.parse(readFileSync(join(process.cwd(), "__tests__/fixtures/limits/rust-p3-final.json"), "utf8")) as { layout: Record<string, number> };
const LIVE = JSON.parse(readFileSync(join(process.cwd(), "__tests__/fixtures/CdN8r7FB.freshness.market.json"), "utf8")) as { dataBase64: string };

describe("AC4: the predicted id is read where the DEPLOYED handler allocates it", () => {
  it("offset = rustc offset_of!(AssetOracleProfileV16, next_portfolio_id) inside asset 0's wrapper", () => {
    expect(OP_NEXT_PORTFOLIO_ID).toBe(RUST.layout["op.next_portfolio_id"]);
    expect(RUST.layout["op.next_portfolio_id"] + 8).toBeLessThanOrEqual(RUST.layout["op.len"]);
    expect(NEXT_PORTFOLIO_ID_OFF).toBe(assetWrapperOff(0) + RUST.layout["op.next_portfolio_id"]);
  });
  it("on a live market image the counter is a small positive id (the market's portfolios + 1)", () => {
    const next = readNextPortfolioId(new Uint8Array(Buffer.from(LIVE.dataBase64, "base64")))!;
    expect(next).toBeGreaterThan(1n);
    expect(next).toBeLessThan(100_000n);
  });
  it("allocate_portfolio_id: 0 is the pre-counter sentinel and becomes 1", () => {
    expect(predictPortfolioId(0n)).toBe(1n);
    expect(predictPortfolioId(7n)).toBe(7n);
    expect(readNextPortfolioId(new Uint8Array(10))).toBeNull();
  });
});

describe("the deposit that rides with the first trade", () => {
  it("margin + fee + 10%, rounded up to a cent", () => {
    expect(firstTradeDepositAtoms(100_000_000n, 300_000n)).toBe(110_330_000n);
    expect(firstTradeDepositAtoms(1n, 0n)).toBe(10_000n);
    expect(firstTradeDepositAtoms(0n, 0n)).toBe(0n);
  });
});

describe("tx shapes", () => {
  const k = () => Keypair.generate().publicKey;
  const base = () => ({
    programId: k(), owner: k(), market: k(), portfolio: k(), userAta: k(), vaultTokenAta: k(), depositAtoms: 5n,
    lp: { accountB: k(), matcherProg: k(), matcherCtx: k(), matcherDelegate: k() },
    lpId: { portfolioId: 1n, positionEpoch: 0n, matcherSequence: 3n }, marketId: 1n, size: 10n, limitPriceE6: 2_000_000n,
  });
  it("A = [CreateAccount, InitPortfolio] (the portfolio co-signs); B = [Deposit, TradeCpi]", () => {
    const p = base();
    const a = buildFirstTradeInitIxs(p, 123);
    expect(a).toHaveLength(2);
    expect(a[0].keys.find((x) => x.pubkey.equals(p.portfolio))?.isSigner).toBe(true);
    expect(a[1].programId.equals(p.programId)).toBe(true);
    const b = buildFundAndTradeIxs(p, { portfolioId: 9n, sequence: 0n, positionEpoch: 0n });
    expect(b).toHaveLength(2);
    expect(b.every((ix) => ix.programId.equals(p.programId))).toBe(true);
    expect(b[1].keys[2].pubkey.equals(p.portfolio)).toBe(true);
  });
});

describe("classifying B's failure", () => {
  const W = WRAPPER_ERR.EngineProvenanceMismatch;
  it("the race = EngineProvenanceMismatch (16), in every error shape", () => {
    expect(W).toBe(16);
    expect(isPortfolioIdRace({ code: 16 })).toBe(true);
    expect(isPortfolioIdRace(new Error(`{"InstructionError":[3,{"Custom":16}]}`))).toBe(true);
    expect(isPortfolioIdRace(new Error("Error processing Instruction 3: custom program error: 0x10"))).toBe(true);
    expect(isPortfolioIdRace({ code: 19 })).toBe(false);
    expect(isPortfolioIdRace(new Error("custom program error: 0x100"))).toBe(false);
  });
  it("which leg failed (deposit at index 3 after the budget prefix, else the trade)", () => {
    expect(failedFirstTradeLeg(new Error(`{"InstructionError":[3,{"Custom":13}]}`), 3)).toBe("deposit");
    expect(failedFirstTradeLeg(new Error("InstructionError(4, Custom(66))"), 3)).toBe("trade");
    expect(failedFirstTradeLeg(new Error("Error processing Instruction 3: insufficient funds"), 3)).toBe("deposit");
    expect(failedFirstTradeLeg(new Error("blockhash not found"), 3)).toBeNull();
  });
  it("a failed deposit leg is never swallowed: the copy says the account exists and asks for the deposit", () => {
    const e = new FirstTradeDepositError("12.50 USDC");
    expect(e.message).toBe("Your trading account is set up but the deposit didn't go through. Deposit 12.50 USDC to trade.");
  });
});
