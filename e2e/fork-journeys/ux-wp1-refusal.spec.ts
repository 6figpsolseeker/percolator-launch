/**
 * UX WP-1 AC1, for the #2701 fork harness (copy to e2e-fork/journeys/ui/; it imports that
 * harness's wallet + perc libs). UF4 recipe: tag 93 narrows PENGU's exec band to 1 bps, then an
 * out-of-band open is submitted from the UI. The app's pre-sign simulation (sendTx gate,
 * lib/tx.ts SimulationRefusal) must refuse it with ZERO wallet prompts, and the ticket must show
 * ONE status-line[data-kind=price-moved] with an inline "Use {max}" action. No raw error text.
 * P1 bytes only (the band does not exist on v18.3); the journey records N/A there, like UF4.
 */
import { test, expect } from "@playwright/test";
import { PublicKey, TransactionInstruction } from "@solana/web3.js";
import { installTestWallet } from "../../wallet/inject.ts";
import * as P from "../../lib/perc.ts";
import { check, record } from "../../lib/results.ts";

test("UX WP-1: a band refusal opens no wallet prompt; one StatusLine with Use {max}", async ({ page }) => {
  const J = "UX-WP1-sim-gate";
  const fs = await import("node:fs");
  const wrapperSha = JSON.parse(fs.readFileSync(`${P.RUN}/programs.json`, "utf8")).wrapper.soSha256 as string;
  if (wrapperSha.startsWith("4472b383")) {
    record({ journey: J, market: "-", step: "sim gate on a band refusal", ok: true, actual: "N/A on v18.3 (no band in P0 bytes)" });
    return;
  }
  const sym = "PENGU";
  const m = P.markets()[sym];
  const { deriveProgramDataAddressP3 } = await import("@percolatorct/sdk");
  const [programData] = deriveProgramDataAddressP3(P.WRAPPER);
  const t93 = (bandBps: number, L?: { k: number; floor: bigint; cap: bigint; ext: number; fee: number }) => {
    const d = Buffer.alloc(44);
    let o = 0;
    d[o++] = 93;
    d.writeUInt16LE(0, o); o += 2;
    d.writeUInt16LE(bandBps, o); o += 2;
    d.writeUInt32LE(L?.k ?? 0, o); o += 4;
    const w = (v: bigint) => { d.writeBigUInt64LE(v & 0xffffffffffffffffn, o); d.writeBigUInt64LE(v >> 64n, o + 8); o += 16; };
    w(L?.floor ?? 1_000_000_000n);
    w(L?.cap ?? 100_000_000_000_000n);
    d[o++] = L?.ext ?? 0;
    d.writeUInt16LE(L?.fee ?? 0, o);
    return new TransactionInstruction({
      programId: P.WRAPPER,
      data: d,
      keys: [
        { pubkey: P.admin.publicKey, isSigner: true, isWritable: false },
        { pubkey: programData, isSigner: false, isWritable: false },
        { pubkey: new PublicKey(m.slab), isSigner: false, isWritable: true },
      ],
    });
  };
  const n = await P.send([t93(1)], [P.admin]);
  check(J, sym, "tag 93: exec band 1 bps", n.ok, "ok", n.ok ? "ok" : `${n.err}`, n.sig ? [n.sig] : []);
  try {
    const kp = await P.newWallet({ usdc: 3_000_000_000n });
    const port = await P.createPortfolio(kp, m);
    await P.mustSend("deposit", [await P.depositIx(kp.publicKey, m, port, 1_000_000_000n)], [kp]);
    const log = await installTestWallet(page, kp);
    await page.goto(`/trade/${m.slab}`);
    await page.getByTestId("trade-side-long").click({ timeout: 60_000 });
    await page.getByTestId("trade-size-input").fill("2000");
    const before = log.filter((e) => e.kind === "tx").length;
    await page.getByTestId("trade-submit").click();
    if (await page.getByTestId("trade-confirm").isVisible({ timeout: 4000 }).catch(() => false)) await page.getByTestId("trade-confirm").click();
    const line = page.getByTestId("status-line");
    await expect(line).toHaveCount(1, { timeout: 30_000 });
    await expect(line).toHaveAttribute("data-kind", "price-moved");
    const prompts = log.filter((e) => e.kind === "tx").length - before;
    const body = await page.getByTestId("status-line-body").innerText();
    const action = page.getByTestId("status-line-action");
    const hasAction = await action.isVisible().catch(() => false);
    const raw = /custom program error|Custom\(\d+\)|0x[0-9a-f]+|Program error/i.test(await page.locator("body").innerText());
    const legs = (await P.readPortfolio(port)).legs.length;
    await page.screenshot({ path: `.run/shots/UX-WP1-sim-gate-1440.png`, fullPage: true }).catch(() => undefined);
    await page.setViewportSize({ width: 375, height: 812 });
    await page.screenshot({ path: `.run/shots/UX-WP1-sim-gate-375.png`, fullPage: true }).catch(() => undefined);
    check(J, sym, "0 wallet prompts, one price-moved StatusLine with Use {max}, no raw error, no position",
      prompts === 0 && hasAction && !raw && legs === 0, "prompts=0 action=Use max raw=false legs=0",
      `prompts=${prompts} action=${hasAction ? await action.innerText() : "none"} raw=${raw} legs=${legs} body=${body}`);
    expect(prompts).toBe(0);
    expect(hasAction).toBe(true);
    expect(raw).toBe(false);
  } finally {
    const L = JSON.parse(fs.readFileSync(`${P.RUN}/seed-state.json`, "utf8")).markets[sym].p1RiskLimits;
    await P.send([t93(Number(L.exec_band_bps), { k: Number(L.lp_exposure_k_bps), floor: BigInt(L.lp_floor_atoms), cap: BigInt(L.side_oi_cap_q), ext: Number(L.matcher_ext_mode), fee: Number(L.max_requested_fee_bps) })], [P.admin]);
  }
});
