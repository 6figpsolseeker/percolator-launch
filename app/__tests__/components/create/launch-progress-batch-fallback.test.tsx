/**
 * The market launch has a fast path that signs all seven transactions in ONE
 * wallet approval. When it fails before broadcasting anything, it silently
 * falls back to signing six times.
 *
 * The fallback itself is correct — nothing is on chain, so the sequential path
 * is safe. What was wrong is that it threw the REASON away:
 *
 *     } catch (err) {
 *       if (!broadcastStarted) {
 *         return { status: "fallback" };   // err never used
 *       }
 *
 * The batch has several unrelated ways to throw before broadcast — a non-2xx
 * from the devnet pre-fund, a keeper co-sign failure, an airdrop that did not
 * confirm — and from the outside they are indistinguishable. The only symptom
 * was a user signing six times, on any wallet (reproduced on both Phantom and
 * Solflare), with nothing anywhere saying why.
 *
 * The hook half of this is pinned in
 * __tests__/hooks/useCreateMarket-batch-fallback-wiring.test.ts — without it,
 * reverting the hook left this file green and the feature dead.
 *
 * See #2586.
 */

import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { LaunchProgress } from "@/components/create/LaunchProgress";

type ProgressState = Parameters<typeof LaunchProgress>[0]["state"];

/**
 * A realistic reason, not a short one.
 *
 * Length is load-bearing: the first version of these tests used fixtures of at
 * most 49 characters, so a `reason.slice(0, 60)` mutant — which would gut the
 * feature in production by cutting off the part a user needs to paste — passed
 * every assertion. Real messages look like this.
 */
const LONG_REASON =
  "Keeper co-sign failed (503): upstream request timeout after 30000ms while registering asset 0 at slot 402118773";

const STEP_ERROR = "Deposit failed: custom program error 0x1771";

/** Match a fixture string literally inside a regex matcher. */
function literal(s: string): RegExp {
  return new RegExp(s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));
}

/** The rendered reason line, found by its text rather than by a class hook. */
function reasonLine(reason: string): HTMLElement {
  return screen.getByText(literal(reason.slice(0, 30)));
}

/** Mid-launch on the sequential path: loading, no error, not the batch phase. */
function signingState(over: Partial<ProgressState> = {}): ProgressState {
  return {
    step: 1,
    loading: true,
    error: null,
    slabAddress: null,
    txSigs: [],
    stepLabel: "Oracle setup & pre-LP crank...",
    ...over,
  } as ProgressState;
}

/**
 * `onReset` is a REQUIRED prop. Every render in the first version of this file
 * omitted it — a type error that survived only because tsconfig.json excludes
 * __tests__ from tsc, which also means nothing here is type-checked at all.
 */
function renderProgress(over: Partial<ProgressState> = {}) {
  return render(<LaunchProgress state={signingState(over)} onReset={() => {}} />);
}

describe("a degraded six-prompt launch says so", () => {
  it("shows the reason the one-approval path was unavailable", () => {
    renderProgress({ batchFallbackReason: "Devnet pre-fund failed: Already pre-funded recently" });

    expect(screen.getByText(/Step 2 of 6/)).toBeInTheDocument();
    expect(screen.getByText(/Already pre-funded recently/)).toBeInTheDocument();
    // The reason alone, with no lead-in, is an unexplained error string under a
    // progress bar. The sentence is what makes it legible.
    expect(
      screen.getByText(/Your wallet signs each step separately/),
    ).toBeInTheDocument();
  });

  it("passes through ANY reason, not one family", () => {
    // The batch has five unrelated pre-broadcast failure modes. A mutant that
    // rendered only e.g. reasons starting "Devnet" would satisfy a suite that
    // only ever asserts one fixture is present.
    for (const reason of [
      "Keeper co-sign failed (503)",
      "Airdrop transaction failed on-chain",
      "Invalid fee split: creator 1600 + lp 4800 exceeds cap",
      "you declined the single-approval signature",
    ]) {
      const { unmount } = renderProgress({ batchFallbackReason: reason });
      expect(screen.getByText(literal(reason))).toBeInTheDocument();
      unmount();
    }
  });

  it("does not truncate — the whole message has to be pasteable", () => {
    renderProgress({ batchFallbackReason: LONG_REASON });

    // The tail, which is what a truncating mutant drops.
    expect(screen.getByText(literal(LONG_REASON.slice(-40)))).toBeInTheDocument();
    // Clamped for LAYOUT (3 lines) while the text stays intact, and `title`
    // carries it in full for a reader who needs the rest.
    expect(reasonLine(LONG_REASON)).toHaveAttribute("title", LONG_REASON);
  });

  it("does not present it as an error", () => {
    // Nothing failed from the user's side — the launch is still running, just
    // with more prompts. Rendering it in the error style would tell someone
    // their market broke when it did not.
    //
    // The first version asserted `querySelectorAll('[class*="--short"]').length
    // === 0` on a fixture with `error: null`, where every --short in this
    // component is already gated behind an error. That count was 0 regardless of
    // how the line was styled, and passed even with the feature deleted. Anchor
    // on the element itself.
    renderProgress({ batchFallbackReason: LONG_REASON });

    const line = reasonLine(LONG_REASON);
    expect(line.className).toContain("--text-muted");
    expect(line.className).not.toContain("--short");
    expect(line.closest('[class*="--short"]')).toBeNull();
  });

  it("CONTROL: says nothing when the batch was never attempted", () => {
    // Resume and retry flows deliberately skip the batch, and a successful
    // batch never reaches this view. Neither is degraded, so neither should
    // carry an explanation — otherwise the line appears always and is ignored.
    renderProgress();

    expect(screen.getByText(/Step 2 of 6/)).toBeInTheDocument();
    expect(screen.queryByText(/Your wallet signs each step separately/)).toBeNull();
  });

  it("CONTROL: an explicitly cleared reason renders nothing", () => {
    // create() clears this on EVERY attempt, so a retry that never tried the
    // batch shows no explanation. `null` and `undefined` must behave alike.
    renderProgress({ batchFallbackReason: null });

    expect(screen.getByText(/Step 2 of 6/)).toBeInTheDocument();
    expect(screen.queryByText(/Your wallet signs each step separately/)).toBeNull();
  });

  it("CONTROL: stays out of the batch-phase view", () => {
    // While the batch is still running it has not fallen back to anything, so
    // there is no degraded path to explain. Nothing previously set `phase` at
    // all, so a mutant that also rendered the line in that branch went unseen.
    renderProgress({ phase: "awaiting-signature", batchFallbackReason: LONG_REASON });

    expect(screen.queryByText(/Your wallet signs each step separately/)).toBeNull();
  });
});

describe("the reason survives the failure that makes it worth reporting", () => {
  it("still shows when a later sequential step fails", () => {
    // The whole point is a pasteable bug report, and the launch worth reporting
    // is the one that fell back AND then broke. The line used to live only
    // inside `!state.error`, so setting an error unmounted it and the error
    // panel showed the step failure with no hint that six prompts had even
    // happened.
    renderProgress({ loading: false, error: STEP_ERROR, batchFallbackReason: LONG_REASON });

    expect(screen.getByText(literal(STEP_ERROR))).toBeInTheDocument();
    expect(reasonLine(LONG_REASON)).toBeInTheDocument();
  });

  it("is not itself styled as the failure", () => {
    // It sits inside the error panel but must not read as the error: the
    // fallback is not what broke, and colouring it --short points the reader at
    // the wrong line.
    renderProgress({ loading: false, error: STEP_ERROR, batchFallbackReason: LONG_REASON });

    const line = reasonLine(LONG_REASON);
    expect(line.className).toContain("--text-muted");
    expect(line.className).not.toContain("--short");
  });

  it("CONTROL: a plain failure with no fallback explains nothing extra", () => {
    // A launch that failed on the sequential path WITHOUT a batch fallback must
    // not gain a line about an approval path it never took.
    renderProgress({ loading: false, error: STEP_ERROR });

    expect(screen.getByText(literal(STEP_ERROR))).toBeInTheDocument();
    expect(screen.queryByText(/Your wallet signs each step separately/)).toBeNull();
  });
});
