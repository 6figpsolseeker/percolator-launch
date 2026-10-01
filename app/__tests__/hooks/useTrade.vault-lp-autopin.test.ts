// @vitest-environment node
/**
 * P3 auto-pin (07a1d0eb, bytes regenerated on FINAL 4b1a5d30): a market bound by the APP's wizard (createAccount(ctx) + 94 + 96) trades
 * immediately. Fixture = the vault-LP portfolio bytes right after that app-built bind in the P3
 * LiteSVM sim (scripts/limits-parity/p3-sim, LIMITS_DUMP_VAULT_LP), where a trade through
 * exactly these accounts LANDED. The app's own trade-account resolution must produce the same
 * LP, matcher ctx and delegate (delegate seeds use the LP's owner = the registry PDA).
 */
import { describe, it, expect, vi } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { Keypair, PublicKey } from "@solana/web3.js";

vi.mock("@/lib/config", async (orig) => {
  const real = (await orig()) as Record<string, unknown>;
  return { ...real, getConfig: () => ({ ...(real.getConfig as () => Record<string, unknown>)(), matcherProgramId: "4seJWjv3R5qfXY8R5ntuPHWsoqcVvaxvfFSnU2AnGMhT" }) };
});

// The taker's own portfolio comes from the shared scan store (not under test here).
const takerPortfolio = Keypair.generate().publicKey;
let takerKey: PublicKey | null = null;
vi.mock("@/lib/userAccountScan", async (orig) => {
  const real = (await orig()) as Record<string, unknown>;
  return { ...real, getPortfolioRawSnapshot: () => (takerKey ? { pubkey: takerPortfolio, portfolio: { owner: takerKey } } : null) };
});

const f = JSON.parse(readFileSync(join(__dirname, "../fixtures/limits/sim-vault-lp-4b1a5d30.json"), "utf8")) as {
  programId: string; market: string; registry: string; vaultLp: string; ctx: string; delegate: string; matcher: string; dataB64: string; headP3: string;
};

describe("trade resolution against an auto-pinned vault LP", () => {
  it("finds the vault LP and derives the delegate the program accepted", async () => {
    const { resolveV17TradeAccounts } = await import("@/hooks/useTrade");
    const taker = Keypair.generate().publicKey;
    takerKey = taker;
    const data = Buffer.from(f.dataB64, "base64");
    const connection = {
      getAccountInfo: vi.fn(async () => null),
      getProgramAccounts: vi.fn(async (_p: PublicKey, cfg: { filters: { memcmp: { offset: number; bytes: string } }[] }) => {
        const ownerFilter = cfg.filters.find((x) => x.memcmp && x.memcmp.offset === 80);
        if (ownerFilter) return [{ pubkey: takerPortfolio, account: { data: Buffer.alloc(9500), owner: new PublicKey(f.programId) } }];
        return [{ pubkey: new PublicKey(f.vaultLp), account: { data, owner: new PublicKey(f.programId) } }];
      }),
    };
    const r = await resolveV17TradeAccounts(connection as never, new PublicKey(f.programId), new PublicKey(f.market), taker);
    expect(f.headP3).toBe("4b1a5d30");
    expect(r.accountB.toBase58()).toBe(f.vaultLp);
    expect(r.matcherProg.toBase58()).toBe(f.matcher);
    expect(r.matcherCtx.toBase58()).toBe(f.ctx);
    expect(r.matcherDelegate.toBase58()).toBe(f.delegate);
    // the LP's recorded owner is the registry PDA (no creator key anywhere in the pin)
    expect(new PublicKey(data.subarray(80, 112)).toBase58()).toBe(f.registry);
  });
});
