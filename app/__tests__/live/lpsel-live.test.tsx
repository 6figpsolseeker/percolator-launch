// @vitest-environment happy-dom
/**
 * LIVE devnet harness (skipped unless LIVE_RPC is set): renders the REAL SlabProvider +
 * useFirstTrade / useTrade / useClosePosition with a Keypair-backed wallet and a real
 * Connection, then runs first trade -> add -> close on each market from a fresh wallet.
 *   LIVE_RPC=... LIVE_WALLET=/path/kp.json npx vitest run __tests__/live/lpsel-live.test.tsx
 */
import React from "react";
import fs from "node:fs";
import { describe, it, expect, vi } from "vitest";
import { renderHook, waitFor, act } from "@testing-library/react";
import { Connection, Keypair, PublicKey, type Transaction } from "@solana/web3.js";
import { parseWrapperConfigV17, V17_HEADER_LEN, parsePortfolioV17 } from "@percolatorct/sdk";

const RPC = process.env.LIVE_RPC ?? "";
const LOG = (m: string) => fs.appendFileSync(process.env.LIVE_LOG ?? "/dev/null", m + "\n");
const conn = RPC ? new Connection(RPC, "confirmed") : (null as unknown as Connection);

vi.mock("@/hooks/useWalletCompat", async (orig) => {
  const real = await orig<typeof import("@/hooks/useWalletCompat")>();
  return { ...real, useConnectionCompat: () => ({ connection: conn }) };
});

import { WalletApiContext, type WalletApi } from "@/hooks/walletApiContext";
import { SlabProvider, useSlabState } from "@/components/providers/SlabProvider";
import { useFirstTrade } from "@/hooks/useFirstTrade";
import { useTrade, findV17Portfolio } from "@/hooks/useTrade";
import { useClosePosition } from "@/hooks/useClosePosition";
import { seedFromOnChain } from "@/lib/priceStore/priceStore";
import { computeLimitPriceE6 } from "@/lib/slippage";
import { firstTradeDepositAtoms } from "@/lib/first-trade";

const MARKETS: Record<string, string> = {
  PERC: "9EPm8nB8Fs7WcEZgE1WGFPTGc6rAzD6GhFJyMm4dEFHn",
  SI: "8WC8vALsDJhNCUVRmqZBDSg5xgFAhDrgy7zWqF512pDx",
  TRENDS: "Fz5JfUcbEdt5DNSNwZpBn2dZ7NpN8MnvJMiYjnqMacMh",
};
const only = process.env.LIVE_MARKETS?.split(",");

function walletFor(kp: Keypair): WalletApi {
  const sign = async (tx: Transaction) => { tx.partialSign(kp); return tx; };
  return {
    publicKey: kp.publicKey, connected: true, connecting: false, wallet: null,
    signTransaction: sign,
    signAndSendTransaction: undefined,
    signMessage: undefined,
    signAllTransactions: async (txs: Transaction[]) => Promise.all(txs.map(sign)),
    disconnect: async () => {},
  };
}

describe.skipIf(!RPC)("LIVE: app hooks trade from a fresh non-creator wallet", () => {
  for (const [name, slab] of Object.entries(MARKETS)) {
    if (only && !only.includes(name)) continue;
    it(`${name}: first trade, add, close`, async () => {
      const kp = Keypair.fromSecretKey(Uint8Array.from(JSON.parse(fs.readFileSync(process.env.LIVE_WALLET ?? "", "utf8"))));
      const w = walletFor(kp);
      const wrapper = ({ children }: { children: React.ReactNode }) => (
        <WalletApiContext.Provider value={w}>
          <SlabProvider slabAddress={slab}>{children}</SlabProvider>
        </WalletApiContext.Provider>
      );
      const { result } = renderHook(
        () => ({ slab: useSlabState(), ft: useFirstTrade(slab), tr: useTrade(slab), cl: useClosePosition(slab) }),
        { wrapper },
      );
      await waitFor(() => expect(result.current.slab.config).toBeTruthy(), { timeout: 30_000 });
      const info = await conn.getAccountInfo(new PublicKey(slab));
      const wc = parseWrapperConfigV17(new Uint8Array(info!.data), V17_HEADER_LEN);
      const markE6 = BigInt(wc.markEwmaE6);
      seedFromOnChain(slab, markE6);
      const fee = BigInt(wc.tradeFeeBps);
      // OrderTicket math: $10 margin at 2x = $20 notional.
      const margin = 10_000_000n;
      const size = (margin * 2n * 1_000_000n) / markE6;
      const feeAtoms = (margin * 2n * fee) / 10_000n;
      const existing = await findV17Portfolio(conn, result.current.slab.programId as PublicKey, new PublicKey(slab), kp.publicKey);
      LOG(`[${name}] mark=${markE6} fee=${fee} size=${size} existingPortfolio=${existing?.toBase58() ?? "none"}`);

      let sig1: string;
      try {
        await act(async () => {
          const r = await result.current.ft.fundAndTrade({
            size, depositAtoms: firstTradeDepositAtoms(margin, feeAtoms), limitPriceE6: computeLimitPriceE6({ markE6, size }),
            amountLabel: "test",
          });
          sig1 = r.signature;
          LOG(`[${name}] FIRST TRADE ok sig=${r.signature} portfolio=${r.portfolio.toBase58()} created=${r.created}`);
        });
      } catch (e) {
        const err = e as Error & { logs?: string[]; code?: number | null };
        LOG(`[${name}] FIRST TRADE REFUSED: ${err.name}: ${err.message}\n code=${err.code} logs:\n${(err.logs ?? []).slice(-15).join("\n")}`);
        throw e;
      }

      // ADD: the repeat-trade path (useTrade) on the now-existing portfolio.
      await new Promise((r) => setTimeout(r, 3000));
      try {
        await act(async () => {
          const sig = await result.current.tr.trade({ lpIdx: 0, userIdx: 0, size, limitPriceE6: computeLimitPriceE6({ markE6, size }) });
          LOG(`[${name}] ADD ok sig=${sig}`);
        });
      } catch (e) {
        const err = e as Error & { logs?: string[] };
        LOG(`[${name}] ADD REFUSED: ${err.message}\n${(err.logs ?? []).slice(-15).join("\n")}`);
        throw e;
      }

      // CLOSE 100% via useClosePosition (needs useUserAccount to see the position).
      await new Promise((r) => setTimeout(r, 3000));
      await waitFor(() => expect(result.current.cl).toBeTruthy());
      try {
        let done = false;
        for (let i = 0; i < 20 && !done; i++) {
          try {
            await act(async () => {
              const r = await result.current.cl.closePosition(100);
              LOG(`[${name}] CLOSE ok sig=${r.signature}`);
            });
            done = true;
          } catch (e) {
            if ((e as Error).message === "No user account") { await new Promise((r) => setTimeout(r, 1500)); continue; }
            throw e;
          }
        }
        expect(done).toBe(true);
      } catch (e) {
        const err = e as Error & { logs?: string[] };
        LOG(`[${name}] CLOSE REFUSED: ${err.message}\n${(err.logs ?? []).slice(-15).join("\n")}`);
        throw e;
      }
      const pf = await findV17Portfolio(conn, result.current.slab.programId as PublicKey, new PublicKey(slab), kp.publicKey);
      const p = parsePortfolioV17(new Uint8Array((await conn.getAccountInfo(pf!))!.data));
      LOG(`[${name}] after close legs=${JSON.stringify(p.legs?.map((l) => String((l as { sizeQ?: bigint }).sizeQ ?? "")))} capital=${p.capital}`);
      void sig1!;
    }, 240_000);
  }
});
