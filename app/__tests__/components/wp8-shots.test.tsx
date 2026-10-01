/**
 * UX WP-8 screenshots from the REAL ResolvedExitPanelView: settled with the payout time (owners'
 * window), settled with "Finish now" (sweep, with the viewer's request), blockers, finished (ready)
 * with the result line. With UX_SHOTS_OUT set the markup is written for
 * scripts/ux-shots/shoot-html.mjs; the assertions run either way.
 */
import { describe, expect, it, vi } from "vitest";
import { render } from "@testing-library/react";

vi.mock("@/hooks/useResolvedExit", () => ({ useResolvedExit: () => ({}) }));
import { ResolvedExitPanelView } from "@/components/limits/ResolvedExitPanel";

async function snap(name: string, el: HTMLElement) {
  const out = process.env.UX_SHOTS_OUT;
  if (!out) return;
  const fs = await import("node:fs");
  fs.mkdirSync(out, { recursive: true });
  fs.writeFileSync(`${out}/${name}.html`, el.outerHTML);
}
const base = {
  nowSlot: 1_000n,
  estimate: null,
  running: false,
  lastFinish: null,
  error: null,
  canRun: true,
  earnAmount: "1,250.00 USDC",
  canRequest: false,
  onFinish: () => undefined,
  now: new Date("2026-09-30T12:00:00Z"),
  locale: "en-GB",
  timeZone: "UTC",
};

describe("WP-8 screens", () => {
  it("settled, owners' window: a time, never a slot", async () => {
    const r = render(<ResolvedExitPanelView {...base} plan={{ phase: "owner-window", untilSlot: 217_000n, steps: [], blockers: [] }} />);
    expect(r.container.textContent).not.toMatch(/slot/i);
    await snap("settled-eta", r.container.firstElementChild as HTMLElement);
  });
  it("settled, Finish now (secondary link) with the viewer's request", async () => {
    const r = render(
      <ResolvedExitPanelView {...base} canRequest estimate={{ steps: 6, sol: "0.004" }} plan={{ phase: "sweep", steps: [{ kind: "close-resolved", portfolio: "T" }], blockers: [] }} />,
    );
    expect(r.getByTestId("earn-resolved-exit").textContent).toBe("Finish now and request my withdrawal");
    await snap("finish-now", r.container.firstElementChild as HTMLElement);
  });
  it("blockers in plain words", async () => {
    const r = render(
      <ResolvedExitPanelView
        {...base}
        estimate={{ steps: 2, sol: "0.001" }}
        plan={{
          phase: "sweep",
          steps: [{ kind: "close-empty", portfolio: "E", isVaultLp: false }],
          blockers: [
            { kind: "escrowed", portfolio: "N" },
            { kind: "locked", portfolio: "L" },
          ],
        }}
      />,
    );
    expect(r.getAllByTestId("earn-resolved-exit-blocker")).toHaveLength(2);
    await snap("blockers", r.container.firstElementChild as HTMLElement);
  });
  it("finished: ready, with the request landed", async () => {
    const r = render(
      <ResolvedExitPanelView
        {...base}
        plan={{ phase: "ready", blockers: [] }}
        lastFinish={{ broadcast: 8, skipped: 9, failed: 0, signatures: [], final: { phase: "ready", blockers: [] }, stale: false, requested: true }}
      />,
    );
    expect(r.getByTestId("earn-resolved-exit-result").textContent).toContain("Your withdrawal is requested");
    await snap("finished", r.container.firstElementChild as HTMLElement);
  });
  it("partial payout receipt: one calm line; NEGATIVE CONTROL none without a partial receipt", async () => {
    const plan = { phase: "sweep" as const, steps: [{ kind: "settle-vault-lp" as const, topup: 0 as const, portfolio: "V" }], blockers: [] };
    const r = render(<ResolvedExitPanelView {...base} plan={plan} viewerReceipt="partial-waiting" />);
    const line = r.getByTestId("earn-resolved-exit-partial");
    expect(line.textContent).toBe("Part of your payout is on its way — it completes automatically once the market finishes settling.");
    expect(r.container.querySelectorAll('[data-testid="earn-resolved-exit-partial"]').length).toBe(1);
    await snap("partial-receipt", r.container.firstElementChild as HTMLElement);
    r.unmount();
    const n = render(<ResolvedExitPanelView {...base} plan={plan} />);
    expect(n.queryByTestId("earn-resolved-exit-partial")).toBeNull();
  });
});
