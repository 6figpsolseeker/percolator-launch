/**
 * GH#2514 — a failed backing-domain seeding must not produce a silent
 * "Market created!".
 *
 * The sequential launch path (retry/resume with startStep <= 3, or the
 * pre-broadcast fallback from fresh batching) wraps the TopUpBackingBucket
 * transaction in a try/catch, warns to the console, and continues. Staying
 * non-fatal is deliberate and correct — a transient RPC error must not strand
 * an otherwise-live market, and a repeat TopUp against an already-Fresh-at-MAX
 * bucket is a harmless no-op.
 *
 * Staying SILENT is the defect. That rationale was written when the seed was
 * dust; it is now `backingSeedPerDomain(lp)` per domain — 100% of LP collateral
 * each at the current policy — so swallowing the failure hands the creator a
 * success screen for a market missing two allocations worth twice their LP.
 *
 * These assertions are against the source, not a rendered component: the
 * property is "the catch records it and the success screen reads it", which is
 * a wiring fact spanning three files. A render test of LaunchSuccess alone
 * would pass even if the hook never set the flag.
 */

import { describe, it, expect } from "vitest";
import * as fs from "fs";
import * as path from "path";

const read = (rel: string) =>
  fs.readFileSync(path.resolve(__dirname, "../..", rel), "utf8");

const HOOK = read("hooks/useCreateMarket.ts");
const SUCCESS = read("components/create/LaunchSuccess.tsx");
const WIZARD = read("components/create/CreateMarketWizard.tsx");

describe("GH#2514: backing-seed failure is recorded, not swallowed", () => {
  it("C-1: the backing seed is no longer a swallowed side-step — it is part of the fatal Earn-vault tx", () => {
    // The non-fatal TopUpBackingBucket try/catch is gone: a direct top-up makes
    // CreateLpVault fail Custom(63). Both domains are now funded by
    // DepositToLpVault atomically with CreateLpVault (lib/earn-vault-seed.ts),
    // and a failure there THROWS (surfaced step-aware), so there is nothing
    // left to swallow. backingSeedFailed stays on the state for the UI wiring
    // below but is no longer set by a swallowed catch.
    expect(HOOK).not.toContain("catch (backingBucketErr)");
    expect(HOOK).toContain("buildEarnVaultSeedInstructions");
    expect(HOOK).toMatch(/throw earnErr;/);
  });

  it("declares backingSeedFailed on the state and initialises it false", () => {
    expect(HOOK).toMatch(/backingSeedFailed:\s*boolean;/);
    // Every initial-state object must carry it, or the success screen reads
    // undefined and silently renders nothing.
    const inits = HOOK.match(/insuranceMintFailed:\s*false,/g) ?? [];
    const flags = HOOK.match(/backingSeedFailed:\s*false,/g) ?? [];
    expect(inits.length).toBeGreaterThan(0);
    expect(flags.length).toBe(inits.length);
  });

  it("the wizard passes it to LaunchSuccess and the screen renders on it", () => {
    expect(WIZARD).toMatch(/backingSeedFailed=\{createState\.backingSeedFailed\}/);
    expect(SUCCESS).toMatch(/backingSeedFailed\?:\s*boolean;/);
    expect(SUCCESS).toMatch(/\{backingSeedFailed\s*&&\s*\(/);
  });

  it("the warning says the market is live AND that backing is missing", () => {
    // Both halves matter: dropping the first turns a soft warning into an
    // apparent failure, dropping the second is the bug this closes.
    const start = SUCCESS.indexOf("{backingSeedFailed && (");
    const banner = SUCCESS.slice(start, start + 900);
    expect(banner).toMatch(/live and tradeable/i);
    expect(banner).toMatch(/not seeded/i);
  });
});
