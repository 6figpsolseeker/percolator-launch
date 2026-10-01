/**
 * UX WP-10 AC5 (audit §4.9, UI-1): an error toast is still present after 10 s (sticky until
 * dismissed); success / info go away on their own; the container is aria-live, errors are
 * role="alert", the ✕ is labelled.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen } from "@testing-library/react";
import { type FC, useEffect } from "react";

vi.mock("gsap", () => ({ default: { fromTo: vi.fn(), to: vi.fn((_el: unknown, o: { onComplete?: () => void }) => o.onComplete?.()) } }));
vi.mock("@/hooks/usePrefersReducedMotion", () => ({ usePrefersReducedMotion: () => true }));
import { ToastProvider, useToast } from "@/hooks/useToast";
import { ToastContainer } from "@/components/ui/Toast";

const Fire: FC<{ items: [string, "success" | "error" | "info" | "warning"][] }> = ({ items }) => {
  const { toast } = useToast();
  useEffect(() => {
    for (const [m, t] of items) toast(m, t);
  }, [items, toast]);
  return null;
};

describe("toasts", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());
  it("error sticky past 10 s; success/info auto-dismiss; a11y", () => {
    render(
      <ToastProvider>
        <Fire items={[["Saved", "success"], ["Heads up", "info"], ["Couldn't reach Solana. Nothing was sent.", "error"]]} />
        <ToastContainer />
      </ToastProvider>,
    );
    expect(screen.getByTestId("toast-container").getAttribute("aria-live")).toBe("polite");
    expect(screen.getAllByTestId("toast")).toHaveLength(3);
    act(() => {
      vi.advanceTimersByTime(10_000);
    });
    const left = screen.getAllByTestId("toast");
    expect(left).toHaveLength(1);
    expect(left[0]!.dataset.type).toBe("error");
    expect(left[0]!.getAttribute("role")).toBe("alert");
    const x = screen.getByRole("button", { name: "Dismiss" });
    fireEvent.click(x);
    expect(screen.queryAllByTestId("toast")).toHaveLength(0);
  });
});
