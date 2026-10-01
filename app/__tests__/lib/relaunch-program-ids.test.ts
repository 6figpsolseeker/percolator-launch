// @vitest-environment node
/**
 * Cutover prep (2026-10 relaunch, ALL-FRESH devnet program IDs): the app, the pinned SDK 8.0.0
 * and the relaunch wrapper 592286b4 agree on every program, and error 90 is mapped.
 *  - DEVNET_PROGRAM_IDS == the four fresh IDs; the SDK's own devnet defaults are the same;
 *  - no source file outside tests/fixtures still names an abandoned id as a program to call;
 *  - the vault-LP canonical matcher (tag 94 pins it) is the relaunch matcher EDKK (rustc oracle);
 *  - 90 VaultLpBindRequiresFlatAsset has plain copy in every map.
 */
import { describe, expect, it } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { getProgramId, PROGRAM_IDS } from "@percolatorct/sdk";
import { DEVNET_PROGRAM_IDS } from "@/lib/program-ids";
import { CANONICAL_VAULT_LP_MATCHER_PROGRAM_DEVNET, P3_ERR } from "@/lib/limits/constants";
import { WRAPPER_ERR } from "@/lib/wrapper-errors";
import { P3_ERROR_COPY_BY_NAME } from "@/lib/limits/copy";
import { resolveUserMessage } from "@/lib/limits/user-message";
import { parseMarketCreationError } from "@/lib/parseMarketError";

const FRESH = {
  wrapper: "ETDLAdiAyWnEUngspYczTXUceT6X8f92eZQvr8nmSkWB",
  stake: "VmpVUArRnVkrjaPXQ2qaqCQa3ZrZFgsz7rjeALitF5w",
  nft: "EMYT15LZWaP7Mmmm245kQPbrTyVjG16yZiU9kfNTF3GZ",
  matcher: "EDKKgRaVHna6FCxiY1kgMzegD9rpaN1nwJNSzAzeBUBX",
};
const ABANDONED = [
  "GnwdeQrAh4qzChJeVLrM21CXXWC1akjLH3DiijwzEEYZ",
  "GCHhcgwPyrai8SWHEVWw3odedguFXEtJobNnWSfWBCU3",
  "CNGBPZRALk9Xu8BdgWNyrLJ7daQ9eJYFf1GnEEC7YCU3",
  "4seJWjv3R5qfXY8R5ntuPHWsoqcVvaxvfFSnU2AnGMhT",
];

describe("relaunch program IDs", () => {
  it("the app's single source is the four fresh IDs", () => {
    expect({ ...DEVNET_PROGRAM_IDS }).toEqual(FRESH);
    expect(CANONICAL_VAULT_LP_MATCHER_PROGRAM_DEVNET).toBe(FRESH.matcher);
  });
  it("the pinned SDK 8.0.0 defaults to the same devnet programs", () => {
    const sdk = PROGRAM_IDS as unknown as { devnet: Record<string, string> };
    expect(sdk.devnet.percolator).toBe(FRESH.wrapper);
    expect(sdk.devnet.matcher).toBe(FRESH.matcher);
    expect(getProgramId("devnet").toBase58()).toBe(FRESH.wrapper);
    const pkg = JSON.parse(readFileSync(join(process.cwd(), "node_modules/@percolatorct/sdk/package.json"), "utf8")) as { version: string };
    expect(pkg.version).toBe("8.0.0");
  });
  it("the relaunch wrapper (rustc oracle on 5544302a) pins the relaunch matcher", () => {
    const fx = JSON.parse(readFileSync(join(process.cwd(), "__tests__/fixtures/limits/rust-p3-final.json"), "utf8")) as { p3Sha: string; layout: Record<string, number> };
    expect(fx.p3Sha.startsWith("5544302a")).toBe(true);
    expect(fx.layout.canonicalMatcherIsDevnetEDKK).toBe(1);
  });
  it("no app source names an abandoned program id (lib/program-ids.ts may, in its history note)", () => {
    const walk = (d: string, out: string[] = []): string[] => {
      for (const e of readdirSync(d)) {
        const p = join(d, e);
        if (e === "node_modules" || e === "__tests__" || e === ".next" || e === "vendor") continue;
        if (statSync(p).isDirectory()) walk(p, out);
        else if (/\.(ts|tsx|mjs|js)$/.test(e)) out.push(p);
      }
      return out;
    };
    const files = ["lib", "hooks", "components", "app", "scripts"].flatMap((d) => walk(join(process.cwd(), d)));
    expect(files.length).toBeGreaterThan(500);
    const hits = files
      .filter((f) => !f.endsWith("lib/program-ids.ts"))
      .flatMap((f) => ABANDONED.filter((id) => readFileSync(f, "utf8").includes(id)).map((id) => `${f.replace(process.cwd() + "/", "")}: ${id}`));
    expect(hits).toEqual([]);
  });
});

describe("error 90 VaultLpBindRequiresFlatAsset", () => {
  it("is generated at 90 and has plain copy in every map", () => {
    expect(WRAPPER_ERR.VaultLpBindRequiresFlatAsset).toBe(90);
    expect(P3_ERR.VaultLpBindRequiresFlatAsset).toBe(90);
    expect(P3_ERROR_COPY_BY_NAME.VaultLpBindRequiresFlatAsset).toMatch(/already has open positions/);
    const err = new Error(`Transaction simulation failed: {"InstructionError":[3,{"Custom":90}]}\nProgram ${FRESH.wrapper} failed: custom program error: 0x5a`);
    const m = resolveUserMessage(err, { surface: "create" });
    expect(m.kind).toBe("setup-not-allowed");
    expect(m.body).toMatch(/already has open positions/);
    expect(parseMarketCreationError(err, { step: "vault-lp" })).toMatch(/before any trade/);
  });
});
