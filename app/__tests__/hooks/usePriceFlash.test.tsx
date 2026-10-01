/**
 * usePriceFlash: the shared green-up / red-down tick flash used by the trade
 * header, the positions dock, the landing rail and the /markets list.
 *
 * The flash must stay up long enough to be SEEN: every caller pairs it with
 * `transition-colors duration-300`, so a 300ms hold cleared the tint just as
 * it reached full colour (a ~100ms blip on the live site, read as "no flash").
 */
import { renderHook, act } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { usePriceFlash, FLASH_HOLD_MS } from "@/hooks/usePriceFlash";

describe("usePriceFlash", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  const mount = (initial: bigint | null) =>
    renderHook(({ v }: { v: bigint | null }) => usePriceFlash(v), { initialProps: { v: initial } });

  it("does not flash on the first value", () => {
    const { result } = mount(3166n);
    expect(result.current).toBeNull();
  });

  it("flashes up on an up-tick and down on a down-tick", () => {
    const { result, rerender } = mount(3166n);
    rerender({ v: 3167n });
    expect(result.current).toBe("up");
    rerender({ v: 3165n });
    expect(result.current).toBe("down");
  });

  it("does not flash when the value is unchanged or null", () => {
    const { result, rerender } = mount(3166n);
    rerender({ v: 3166n });
    expect(result.current).toBeNull();
    rerender({ v: null });
    expect(result.current).toBeNull();
  });

  it("holds the flash past the 300ms colour transition, then clears", () => {
    expect(FLASH_HOLD_MS).toBeGreaterThanOrEqual(600);
    const { result, rerender } = mount(3166n);
    rerender({ v: 3167n });
    act(() => { vi.advanceTimersByTime(500); });
    expect(result.current).toBe("up");
    act(() => { vi.advanceTimersByTime(FLASH_HOLD_MS); });
    expect(result.current).toBeNull();
  });

  it("restarts the hold on every new tick", () => {
    const { result, rerender } = mount(3166n);
    rerender({ v: 3167n });
    act(() => { vi.advanceTimersByTime(FLASH_HOLD_MS - 100); });
    rerender({ v: 3168n });
    act(() => { vi.advanceTimersByTime(FLASH_HOLD_MS - 100); });
    expect(result.current).toBe("up");
  });
});
